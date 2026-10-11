// app/api/reconcile/match-classify/route.ts
// Step A (match) + B (transfer filter) + C (classify) for a month or range.
// GET ?month=2026-10            -> matches+classifications for that month
// GET ?from=2026-01&to=2026-10  -> whole range (used by the projections summary)
// Response: { matches: [{ id, status, classification, ruleId, occurrenceDate }], autoTransfers: [{ fromId, toId }] }
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import {
  detectTransfers,
  expandOccurrences,
  matchOne,
  classifyOne,
  type ProjRule,
  type RealTx,
} from '@/lib/reconcile-engine'

function monthsBetween(from: string, to: string) {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ey, em] = to.split('-').map(Number)
  let guard = 0
  while ((y < ey || (y === ey && m <= em)) && guard++ < 24) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` }
}

export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams
    const single = q.get('month') || ''
    const from = q.get('from') || single
    const to = q.get('to') || single
    if (!from) return NextResponse.json({ error: 'Falta month o from/to' }, { status: 400 })

    const sb = supabaseServer()
    const { start, end } = (() => {
      const a = monthRange(from)
      const b = monthRange(to)
      return { start: a.start, end: b.end }
    })()

    const [{ data: txs }, { data: rules }, { data: links }] = await Promise.all([
      sb.from('bank_transactions').select('*').eq('entry_type', 'real').gte('date', start).lte('date', end),
      sb.from('recurring_projections').select('*'),
      sb.from('transfer_links').select('from_tx,to_tx'),
    ])

    const linked = new Set<string>()
    for (const l of links || []) {
      linked.add(String(l.from_tx))
      linked.add(String(l.to_tx))
    }

    const ruleList: ProjRule[] = (rules || []).map((r: any) => ({
      id: String(r.id),
      concept: r.concept || '',
      amount: Number(r.amount) || 0,
      type: r.type === 'ingreso' ? 'ingreso' : 'gasto',
      frequency: r.frequency || '',
      pay_day: String(r.pay_day ?? ''),
    }))
    const rulesById = new Map(ruleList.map((r) => [r.id, r]))
    const occurrences = expandOccurrences(ruleList, start, end)

    const real: RealTx[] = (txs || []).map((t: any) => ({
      id: String(t.id),
      date: t.date,
      bank_account: t.bank_account || '',
      detail: t.detail || '',
      debit: t.debit,
      credit: t.credit,
      category: t.category || 'Otro',
    }))

    const auto = detectTransfers(real, linked)
    const autoIds = new Set<string>()
    for (const p of auto) {
      autoIds.add(p.fromId)
      autoIds.add(p.toId)
    }

    const matches = real.map((t) => {
      const tid = String(t.id)
      const isTransfer = linked.has(tid) || autoIds.has(tid)
      const match = matchOne(t, occurrences)
      const cls = classifyOne({
        t,
        isTransfer,
        match,
        ruleFrequency: match.ruleId ? rulesById.get(match.ruleId)?.frequency ?? null : null,
      })
      return { id: tid, status: match.status, classification: cls, ruleId: match.ruleId, occurrenceDate: match.occurrenceDate }
    })

    return NextResponse.json({ matches, autoTransfers: auto })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
