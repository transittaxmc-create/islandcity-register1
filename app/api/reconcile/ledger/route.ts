// app/api/reconcile/ledger/route.ts
// Comparative Ledger — final blueprint endpoint (READ-ONLY, no schema change).
// GET ?month=2026-10 -> { rows, buckets, totals, alert }
// Row order per tx: (A) transfer noise filter -> (B) 1-to-1 match -> (C) variable buckets.
// Columns: Date | Entity | Category | Account | Actual (USD) | Projected (USD) | Variance | Status
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import {
  buildLedger,
  liquidityGuard,
  type ProjRule,
} from '@/lib/reconcile-engine'

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` }
}

export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams
    const ym = q.get('month') || new Date().toISOString().slice(0, 7)
    const savingGoal = Number(q.get('savingGoal') || 0)
    const safetyBuffer = Number(q.get('safetyBuffer') || 0)
    const { start, end } = monthRange(ym)

    const sb = supabaseServer()
    const [{ data: txs }, { data: rules }, { data: links }, { data: accs }] = await Promise.all([
      sb.from('bank_transactions').select('*').eq('entry_type', 'real').gte('date', start).lte('date', end).order('date', { ascending: true }),
      sb.from('recurring_projections').select('*'),
      sb.from('transfer_links').select('from_tx,to_tx'),
      sb.from('bank_accounts').select('name,current_balance'),
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

    const ledger = buildLedger({
      txs: (txs || []).map((t: any) => ({
        id: String(t.id),
        date: t.date,
        bank_account: t.bank_account || '',
        detail: t.detail || '',
        debit: t.debit,
        credit: t.credit,
        category: t.category || 'Otro',
      })),
      rules: ruleList,
      linked,
      monthStart: start,
      monthEnd: end,
    })

    const currentBalance = (accs || []).reduce((s: number, a: any) => s + (Number(a.current_balance) || 0), 0)
    const alert = liquidityGuard({
      currentBalance,
      projectedIncome: Math.max(0, ledger.totals.projectedNet),
      projectedExpenses: Math.max(0, -Math.min(0, ledger.totals.projectedNet)),
      savingGoal,
      safetyBuffer,
    })

    const res = NextResponse.json({ month: ym, ...ledger, currentBalance, alert })
    res.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
