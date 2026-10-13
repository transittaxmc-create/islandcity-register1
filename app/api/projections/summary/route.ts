// app/api/projections/summary/route.ts
// Perf ticket B: ONE request renders the whole Projection page.
// Aggregates server-side: accounts + 10-month engine summary + rule totals + liquidity inputs.
// GET -> { accounts, monthly: [{ ym, inc, exp, byCat, matched, suggested, unlinked, transfers }],
//          matches, rules: { income, expenses, items }, autoTransfers, generatedAt }
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import {
  expandOccurrences,
  summarize,
  type ProjRule,
  type RealTx,
} from '@/lib/reconcile-engine'

const YMS = Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` }
}

export async function GET() {
  try {
    const sb = supabaseServer()
    const first = monthRange(YMS[0])
    const lastM = monthRange(YMS[YMS.length - 1])

    // Paginado: PostgREST recorta a ~1000 filas por defecto; ene–oct 2026 supera las 3,300.
    const txs: any[] = []
    {
      const PAGE = 1000
      let from = 0
      for (;;) {
        const { data, error } = await sb.from('bank_transactions')
          .select('*')
          .eq('entry_type', 'real')
          .gte('date', first.start)
          .lte('date', lastM.end)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) throw error
        txs.push(...(data || []))
        if (!data || data.length < PAGE) break
        from += PAGE
      }
    }

    const [{ data: accs }, { data: rules }, { data: links }] = await Promise.all([
      sb.from('bank_accounts').select('name,current_balance,institution,display_order').order('display_order').order('name'),
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
      end_date: r.end_date ? String(r.end_date) : undefined,
      category: r.category ? String(r.category) : undefined,
    }))
    const rulesById = new Map(ruleList.map((r) => [r.id, r]))

    // Rule totals for the current month window (KPIs + Liquidity Guard inputs)
    const cur = monthRange(new Date().toISOString().slice(0, 7))
    const curOcc = expandOccurrences(ruleList, cur.start, cur.end)
    let ruleIncome = 0
    let ruleExpenses = 0
    for (const o of curOcc) {
      if (o.type === 'ingreso') ruleIncome += Number(o.amount) || 0
      else ruleExpenses += Number(o.amount) || 0
    }

    const months = YMS.map((ym) => {
      const { start, end } = monthRange(ym)
      const mtxs: RealTx[] = (txs || [])
        .filter((t: any) => t.date >= start && t.date <= end)
        .map((t: any) => ({
          id: String(t.id),
          date: t.date,
          bank_account: t.bank_account || '',
          detail: t.detail || '',
          debit: t.debit,
          credit: t.credit,
          category: t.category || 'Otro',
        }))
      return { ym, txs: mtxs, occurrences: expandOccurrences(ruleList, start, end) }
    })

    const { monthly, matches } = summarize(months, linked, rulesById)

    // Full projected item list for the (virtualized) register + server-side KPI totals.
    const allOcc = expandOccurrences(ruleList, first.start, lastM.end)
    let projIncome = 0
    let projExpenses = 0
    const projected = allOcc.map((o) => {
      const isInc = o.type === 'ingreso'
      const amt = Number(o.amount) || 0
      if (isInc) projIncome += amt
      else projExpenses += amt
      return {
        id: `${o.id}::${o.occurrence_date}`,
        rule_id: o.id,
        date: o.occurrence_date,
        detail: o.concept,
        frequency: o.frequency,
        category: (o as any).category || 'Proyección',
        debit: isInc ? 0 : amt,
        credit: isInc ? amt : 0,
      }
    })

    const res = NextResponse.json({
      accounts: (accs || []).map((a: any) => ({
        name: a.name,
        current_balance: a.current_balance ?? null,
        institution: a.institution || null,
        display_order: a.display_order ?? 100,
      })),
      monthly,
      matches,
      rules: { income: ruleIncome, expenses: ruleExpenses, count: ruleList.length },
      ruleItems: ruleList.map((r) => ({
        id: r.id,
        concept: r.concept,
        amount: r.amount,
        type: r.type,
        frequency: r.frequency,
        pay_day: r.pay_day,
        end_date: (r as any).end_date || null,
        category: (r as any).category || '',
      })),
      projected,
      projTotals: { income: projIncome, expenses: projExpenses },
      generatedAt: new Date().toISOString(),
    })
    res.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
