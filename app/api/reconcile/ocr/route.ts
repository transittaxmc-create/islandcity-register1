// app/api/reconcile/ocr/route.ts
// Recibe la foto del comprobante (FormData: file).
// 1) La sube al bucket 'reconciliation-receipts'.
// 2) Gemini 2.0 Flash la lee y devuelve vendor / amount / date / category.
// 3) Guarda el recibo en 'receipts' y crea el movimiento real en 'bank_transactions'.
// Responde con el movimiento creado para pintarlo al instante.
import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Sin archivo' }, { status: 400 })

    const sb = supabaseServer()
    const buf = Buffer.from(await file.arrayBuffer())
    const path = `receipts/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

    const { error: upErr } = await sb.storage
      .from('reconciliation-receipts')
      .upload(path, buf, { contentType: file.type || 'image/jpeg', upsert: true })
    if (upErr) throw upErr

    const { data: pub } = sb.storage.from('reconciliation-receipts').getPublicUrl(path)
    const image_url = pub.publicUrl

    // --- OCR con Gemini ---
    let vendor = '', amount = 0, receipt_date = new Date().toISOString().slice(0, 10), category = 'Otro'
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
      const base64 = buf.toString('base64')
      const prompt = `Lee este comprobante o factura y devuelve SOLO un JSON válido con estas claves, sin texto extra:
{"vendor": "nombre del comercio o proveedor", "amount": 0.00, "date": "YYYY-MM-DD", "category": "una de: Gasolina, Peajes E-ZPass, Mantenimiento, Llantas, Seguro comercial, Pago del vehículo, Comida, Otro"}`
      const res = await model.generateContent([
        prompt,
        { inlineData: { data: base64, mimeType: file.type || 'image/jpeg' } },
      ])
      const txt = res.response.text().replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(txt)
      vendor = parsed.vendor || ''
      amount = Math.abs(Number(parsed.amount) || 0)
      if (parsed.date) receipt_date = parsed.date
      if (parsed.category) category = parsed.category
    } catch {
      // Si Gemini falla, se guarda el recibo con lo mínimo y Miguel lo completa a mano.
    }

    const { data: receipt, error: rErr } = await sb.from('receipts').insert({
      vendor, amount, receipt_date, image_url, category, status: 'pending',
    }).select().single()
    if (rErr) throw rErr

    // Crea el movimiento real (gasto) con el comprobante adjunto.
    const { data: prev } = await sb.from('bank_transactions')
      .select('daily_balance').lte('date', receipt_date)
      .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(1)
    const prevBal = prev?.[0]?.daily_balance ? Number(prev[0].daily_balance) : 0

    const { data: tx, error: tErr } = await sb.from('bank_transactions').insert({
      date: receipt_date,
      bank_account: 'Cuenta principal',
      detail: vendor || 'Comprobante escaneado',
      category,
      frequency: 'Un solo pago',
      entry_type: 'real',
      debit: amount,
      credit: 0,
      daily_balance: prevBal - amount,
      has_receipt: true,
      receipt_url: image_url,
      receipt_name: file.name,
      source: 'ocr',
      reconciled: false,
    }).select().single()
    if (tErr) throw tErr

    await sb.from('receipts').update({ matched_transaction_id: tx.id, status: 'matched' }).eq('id', receipt.id)

    return NextResponse.json({ transaction: tx, receipt })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
