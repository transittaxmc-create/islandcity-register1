// app/api/reconcile/transfers/route.ts
// Vincula transferencias entre cuentas propias para no duplicar ingresos/gastos.
// GET ?month=2026-10            -> candidatos heuristicos (mismo monto, lados opuestos, cuentas distintas, ±3 dias)
// GET ?links=1&month=2026-10    -> vinculos existentes con detalle de ambos movimientos
// POST { from_tx, to_tx }       -> crea el vinculo y marca ambos como categoria 'Transfer'
// DELETE ?id=                   -> elimina el vinculo
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const endD = new Date(y, m, 0).getDate()
  const end = `${y}-${String(m).padStart(2, '0')}-${String(endD).padStart(2, '0')}`
  return { start, end }
}

export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams
    const month = q.get('month') || ''
    const sb = supabaseServer()
    const { start, end } = monthRange(month)

    if (q.get('links')) {
      const { data: links } = await sb.from('transfer_links').select('id,from_tx,to_tx,created_at').order('created_at', { ascending: false }).limit(200)
      const ids = new Set<string>()
      for (const l of links || []) { ids.add(l.from_tx); ids.add(l.to_tx) }
      const { data: txs } = ids.size
        ? await sb.from('bank_transactions').select('id,date,bank_account,detail,debit,credit').in('id', [...ids])
        : { data: [] }
      const byId = new Map((txs || []).map((t: any) => [String(t.id), t]))
      return NextResponse.json({
        links: (links || []).map((l: any) => ({ ...l, from: byId.get(String(l.from_tx)) || null, to: byId.get(String(l.to_tx)) || null })),
      })
    }

    const { data: txs } = await sb.from('bank_transactions')
      .select('id,date,bank_account,detail,debit,credit')
      .eq('entry_type', 'real').gte('date', start).lte('date', end)
    const { data: links } = await sb.from('transfer_links').select('from_tx,to_tx')
    const linked = new Set<string>()
    for (const l of links || []) { linked.add(String(l.from_tx)); linked.add(String(l.to_tx)) }

    const debits = (txs || []).filter((t: any) => Number(t.debit) > 0 && !linked.has(String(t.id)))
    const creditsByAmt = new Map<string, any[]>()
    for (const t of txs || []) {
      const c = Number(t.credit) || 0
      if (c <= 0 || linked.has(String(t.id))) continue
      const k = c.toFixed(2)
      if (!creditsByAmt.has(k)) creditsByAmt.set(k, [])
      creditsByAmt.get(k)!.push(t)
    }
    const cands: any[] = []
    for (const d of debits) {
      const k = Number(d.debit).toFixed(2)
      const dd = new Date(d.date + 'T12:00:00').getTime()
      for (const c of creditsByAmt.get(k) || []) {
        if (c.bank_account === d.bank_account) continue
        if (String(c.id) === String(d.id)) continue
        const cd = new Date(c.date + 'T12:00:00').getTime()
        if (Math.abs(cd - dd) > 3 * 86400000) continue
        cands.push({ from: d, to: c })
      }
    }
    return NextResponse.json({ candidates: cands.slice(0, 50) })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { from_tx, to_tx } = await req.json()
    if (!from_tx || !to_tx) return NextResponse.json({ error: 'Faltan ids' }, { status: 400 })
    const sb = supabaseServer()
    const { data, error } = await sb.from('transfer_links').insert({ from_tx, to_tx }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await sb.from('bank_transactions').update({ category: 'Transfer', updated_at: new Date().toISOString() }).in('id', [from_tx, to_tx])
    return NextResponse.json({ link: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })
    const sb = supabaseServer()
    const { error } = await sb.from('transfer_links').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
