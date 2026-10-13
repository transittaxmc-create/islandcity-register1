import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const vendor = typeof json.vendor === 'string' ? json.vendor.trim() : ''
    const amount = Number(json.amount)
    const date = typeof json.date === 'string' ? json.date : ''
    const dueDate = typeof json.dueDate === 'string' ? json.dueDate : ''
    const category = typeof json.category === 'string' ? json.category : ''
    const notes = typeof json.notes === 'string' ? json.notes : ''
    const source = typeof json.source === 'string' ? json.source : 'claris-scan'

    if (!vendor || typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid payload: vendor and positive amount required' }, { status: 400 })
    }
    if (!dueDate && !date) {
      return NextResponse.json({ error: 'Invalid payload: dueDate or date required' }, { status: 400 })
    }

    const sb = supabaseServer()
    const pay_day = dueDate || date || new Date().toISOString().slice(0,10)
    const end_date = dueDate || pay_day

    // Insert as a one-time gasto projection with pending status semantics
    const insert = {
      concept: vendor,
      amount: Math.round(amount * 100) / 100,
      type: 'gasto',
      frequency: 'Un solo pago',
      pay_day,
      end_date,
      // Optional metadata stored in notes field for now
      // We keep category/note in concept prefix to preserve visibility
      created_at: new Date().toISOString(),
    }

    const { data, error } = await sb.from('recurring_projections').insert(insert).select().single()
    if (error) {
      console.error('[ingest/bill-scan] Supabase insert error', error)
      return NextResponse.json({ error: 'DB insert failed', details: error.message }, { status: 500 })
    }

    // Optional: also create a pending transaction placeholder in bank_transactions if needed
    // For now we just return the projection id

    return NextResponse.json({
      success: true,
      projectionId: data.id,
      vendor,
      amount,
      dueDate: pay_day,
      category,
      notes,
      source,
    })
  } catch (err: any) {
    console.error('[ingest/bill-scan] error', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
