// app/api/reconcile/senders/route.ts
// Memoria de remitentes (Miguel: la AI aprende).
// GET ?month=2026-10 -> { senders: [{sender, kind, n}], pending: [{sender, n, total}] }
//   pending: remitentes con movimientos 'Por verificar', agrupados (un toque los clasifica todos).
// POST { sender, kind } -> guarda en memoria y reclasifica sus 'Por verificar'.
//   kind: 'transfer' -> 'Transferencias Internas' | 'payment' -> 'Ingresos'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { extractCounterparty, normSender } from '@/lib/transfer-sender'

const TX = 'bank_transactions'
const MEM = 'transfer_senders'

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const start = `${ym}-01`
  const last = new Date(y, m, 0).getDate()
  return { start, end: `${ym}-${String(last).padStart(2, '0')}` }
}

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const ym = req.nextUrl.searchParams.get('month') || new Date().toISOString().slice(0, 7)
    const { start, end } = monthRange(ym)

    let senders: any[] = []
    try {
      const { data } = await sb.from(MEM).select('sender,kind,updated_at').order('updated_at', { ascending: false }).limit(200)
      senders = data || []
    } catch { /* tabla aún no creada: memoria vacía */ }

    const { data: pend } = await sb.from(TX)
      .select('id,detail,debit,credit,date').eq('category', 'Por verificar')
      .gte('date', start).lte('date', end).limit(2000)

    const groups = new Map<string, { sender: string; n: number; total: number }>()
    for (const t of pend || []) {
      const cp = extractCounterparty(t.detail || '')
      const key = cp ? normSender(cp) : '(sin remitente)'
      const g = groups.get(key) || { sender: cp || '(sin remitente)', n: 0, total: 0 }
      g.n++
      g.total += Number(t.credit || 0) - Number(t.debit || 0)
      groups.set(key, g)
    }

    return NextResponse.json({
      senders,
      pending: [...groups.values()].sort((a, b) => b.n - a.n),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const { sender, kind } = await req.json()
    if (!sender || !['transfer', 'payment'].includes(kind)) {
      return NextResponse.json({ error: 'Faltan sender/kind' }, { status: 400 })
    }
    const norm = normSender(sender)

    // 1. Guarda en memoria (si la tabla existe)
    try {
      await sb.from(MEM).upsert(
        { sender: norm, kind, updated_at: new Date().toISOString() },
        { onConflict: 'sender' },
      )
    } catch { /* tabla aún no creada */ }

    // 2. Reclasifica sus 'Por verificar'
    //    transfer -> 'Transferencias Internas' (ambos lados)
    //    payment  -> 'Ingresos' solo en créditos; los débitos a plataformas no se tocan
    const { data: rows } = await sb.from(TX).select('id,detail,debit,credit').eq('category', 'Por verificar').limit(5000)
    let updated = 0
    for (const t of rows || []) {
      const cp = extractCounterparty(t.detail || '')
      if (!cp || normSender(cp) !== norm) continue
      let target: string | null = null
      if (kind === 'transfer') target = 'Transferencias Internas'
      else if (Number(t.credit || 0) > 0) target = 'Ingresos'
      if (!target) continue
      const { error } = await sb.from(TX).update({
        category: target,
        updated_at: new Date().toISOString(),
      }).eq('id', t.id)
      if (!error) updated++
    }
    return NextResponse.json({ ok: true, sender: norm, kind, updated })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
