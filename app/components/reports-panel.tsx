// app/components/reports-panel.tsx
// Reports tab: Financial Statement + Schedule C (IRS), built from real bank data.
// Firm UI, no animations, English labels.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { PlatformAvatar } from './platform-logo'

type Preset = 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'last30' | 'custom'
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'lastWeek', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom' },
]

type Tx = {
  id: string | number
  date: string
  bank_account: string
  detail: string
  category: string | null
  debit: number | null
  credit: number | null
  entry_type: string
  pb_class: string | null
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function rangeFor(preset: Preset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date()
  const today = iso(now)
  if (preset === 'custom') return { from: customFrom || today, to: customTo || today }
  if (preset === 'week' || preset === 'lastWeek') {
    const monday = new Date(now)
    const dow = (monday.getDay() + 6) % 7
    monday.setDate(monday.getDate() - dow - (preset === 'lastWeek' ? 7 : 0))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { from: iso(monday), to: iso(sunday) > today ? today : iso(sunday) }
  }
  if (preset === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
  if (preset === 'lastMonth') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: iso(first), to: iso(last) }
  }
  const start = new Date(now)
  start.setDate(start.getDate() - 29)
  return { from: iso(start), to: today }
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.slice(0, 7).split('-').map(Number)
  const end = to.slice(0, 7)
  let guard = 0
  while (`${y}-${String(m).padStart(2, '0')}` <= end && guard++ < 13) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

const money2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)

const isTransfer = (t: Tx) => String(t.category || '').trim().toLowerCase() === 'transfer'
const inRange = (d: string, from: string, to: string) => {
  const s = String(d || '').slice(0, 10)
  return s >= from && s <= to
}

// ---- Schedule C line mapping (heuristic; CPA must confirm) ----
function scheduleCLine(category: string): { line: string; label: string } {
  const c = String(category || '').toLowerCase()
  if (/advertis/.test(c)) return { line: '8', label: 'Advertising' }
  if (/fuel|gas\b|toll|parking|car wash|vehicle|mileage|uber|lyft/.test(c))
    return { line: '9', label: 'Car and truck expenses' }
  if (/commission|service fee|platform fee/.test(c)) return { line: '10', label: 'Commissions and fees' }
  if (/contract|labor|driver pay|helper/.test(c)) return { line: '11', label: 'Contract labor' }
  if (/insurance/.test(c)) return { line: '15', label: 'Insurance (other than health)' }
  if (/interest/.test(c)) return { line: '16a', label: 'Mortgage interest (paid to banks)' }
  if (/legal|professional|accounting|cpa/.test(c)) return { line: '17', label: 'Legal and professional services' }
  if (/office/.test(c)) return { line: '18', label: 'Office expenses' }
  if (/lease|rent/.test(c)) return { line: '20', label: 'Rent or lease' }
  if (/repair|maintenance|mechanic|tire|oil/.test(c)) return { line: '21', label: 'Repairs and maintenance' }
  if (/suppl/.test(c)) return { line: '22', label: 'Supplies' }
  if (/tax|license|tlc|dmv|registration/.test(c)) return { line: '23', label: 'Taxes and licenses' }
  if (/travel/.test(c)) return { line: '24a', label: 'Travel' }
  if (/meal|food|restaurant/.test(c)) return { line: '24b', label: 'Meals (50% limit — CPA to confirm)' }
  if (/utilit|phone|mobile|internet/.test(c)) return { line: '25', label: 'Utilities' }
  if (/depreciation/.test(c)) return { line: '13', label: 'Depreciation' }
  return { line: '27a', label: 'Other expenses' }
}

function DocRow({ label, value, bold, tone, indent }: { label: string; value: string; bold?: boolean; tone?: 'income' | 'expense' | 'total'; indent?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${indent ? 'pl-4' : ''}`}>
      <span className={`text-[13px] ${bold ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{label}</span>
      <span className={`shrink-0 font-mono text-[13px] tabular-nums ${bold ? 'font-bold' : ''} ${tone === 'income' ? 'text-emerald-700' : tone === 'expense' ? 'text-rose-700' : tone === 'total' ? 'text-slate-900' : 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-7 border-b-2 border-slate-900 pb-1 text-[12px] font-bold uppercase tracking-[0.14em] text-slate-900">
      {children}
    </h3>
  )
}

export default function ReportsPanel() {
  const [doc, setDoc] = useState<'statement' | 'schedulec'>('statement')
  const [preset, setPreset] = useState<Preset>('month')
  const today = useMemo(() => iso(new Date()), [])
  const [customFrom, setCustomFrom] = useState(today)
  const [customTo, setCustomTo] = useState(today)
  const [txs, setTxs] = useState<Tx[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const { from, to } = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo])

  useEffect(() => {
    let alive = true
    setBusy(true)
    setErr('')
    ;(async () => {
      try {
        const months = monthsBetween(from, to)
        const all: Tx[] = []
        for (const m of months) {
          const j = await fetch(`/api/reconcile/data?month=${m}`).then((r) => r.json())
          if (j.error) throw new Error(j.error)
          for (const t of j.transactions || []) {
            if (t.entry_type === 'proyectado') continue
            if (!inRange(t.date, from, to)) continue
            all.push(t as Tx)
          }
        }
        if (alive) setTxs(all)
      } catch (e: any) {
        if (alive) setErr(e?.message || 'Could not load transactions')
      } finally {
        if (alive) setBusy(false)
      }
    })()
    return () => { alive = false }
  }, [from, to])

  const data = useMemo(() => {
    const real = txs.filter((t) => !isTransfer(t))
    const transfers = txs.filter(isTransfer)
    const income = real.filter((t) => Number(t.credit) > 0)
    const expenses = real.filter((t) => Number(t.debit) > 0)
    const sum = (arr: Tx[], k: 'credit' | 'debit') => arr.reduce((s, t) => s + (Number(t[k]) || 0), 0)

    const byCat = (arr: Tx[], k: 'credit' | 'debit') => {
      const m = new Map<string, number>()
      for (const t of arr) {
        const c = String(t.category || 'Uncategorized').trim() || 'Uncategorized'
        m.set(c, (m.get(c) || 0) + (Number(t[k]) || 0))
      }
      return [...m.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)
    }
    const byPayer = () => {
      const m = new Map<string, number>()
      for (const t of income) {
        const p = String(t.detail || 'Unknown').trim() || 'Unknown'
        m.set(p, (m.get(p) || 0) + (Number(t.credit) || 0))
      }
      return [...m.entries()].map(([payer, amount]) => ({ payer, amount })).sort((a, b) => b.amount - a.amount).slice(0, 10)
    }
    const cls = (arr: Tx[], k: 'credit' | 'debit') => {
      let business = 0, personal = 0, unclassified = 0
      for (const t of arr) {
        const a = Number(t[k]) || 0
        if (t.pb_class === 'business') business += a
        else if (t.pb_class === 'personal') personal += a
        else unclassified += a
      }
      return { business, personal, unclassified }
    }

    const incomeTotal = sum(income, 'credit')
    const expenseTotal = sum(expenses, 'debit')
    const transferTotal = transfers.reduce((s, t) => s + (Number(t.credit) || 0) + (Number(t.debit) || 0), 0)

    // Schedule C: business income + business expenses mapped to lines
    const bizIncome = income.filter((t) => t.pb_class === 'business')
    const bizExpenses = expenses.filter((t) => t.pb_class === 'business')
    const lineMap = new Map<string, { line: string; label: string; amount: number; categories: string[] }>()
    for (const t of bizExpenses) {
      const cat = String(t.category || 'Uncategorized')
      const { line, label } = scheduleCLine(cat)
      const e = lineMap.get(line) || { line, label, amount: 0, categories: [] }
      e.amount += Number(t.debit) || 0
      if (!e.categories.includes(cat)) e.categories.push(cat)
      lineMap.set(line, e)
    }
    const schedLines = [...lineMap.values()].sort((a, b) => a.line.localeCompare(b.line, undefined, { numeric: true }))
    const schedExpenseTotal = schedLines.reduce((s, l) => s + l.amount, 0)
    const schedIncome = bizIncome.reduce((s, t) => s + (Number(t.credit) || 0), 0)

    return {
      incomeTotal, expenseTotal, net: incomeTotal - expenseTotal,
      incomeByCat: byCat(income, 'credit'),
      expenseByCat: byCat(expenses, 'debit'),
      byPayer: byPayer(),
      incomeCls: cls(income, 'credit'),
      expenseCls: cls(expenses, 'debit'),
      nIncome: income.length, nExpenses: expenses.length,
      nTransfers: transfers.length, transferTotal,
      schedIncome, schedLines, schedExpenseTotal,
      schedNet: schedIncome - schedExpenseTotal,
      bizExpenseCount: bizExpenses.length,
      unclassifiedExpense: cls(expenses, 'debit').unclassified,
    }
  }, [txs])

  const docHeader = (title: string, subtitle: string) => (
    <div className="border-b border-slate-200 pb-5 text-center">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Island City Transit</p>
      <p className="mt-0.5 text-[11px] text-slate-500">Ride Share · Transportation</p>
      <h3 className="mt-3 text-[22px] font-extrabold tracking-tight text-slate-900">{title}</h3>
      <p className="mt-1 text-[13px] font-semibold text-slate-600">{subtitle}</p>
      <p className="mt-2 text-[11px] text-slate-400">Period {from} → {to} · Generated {today} · Source: real bank transactions (Plaid)</p>
    </div>
  )

  return (
    <div className="max-w-4xl">
      <div className="mb-2 text-xs font-semibold text-[#086bc9]">Reports</div>
      <h2 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Reports</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Financial documents built automatically from your real bank transactions.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          onClick={() => setDoc('statement')}
          className={`rounded-xl px-4 py-2.5 text-sm font-bold ${doc === 'statement' ? 'bg-[#0b78e3] text-white' : 'border border-slate-200 bg-white text-slate-600'}`}
        >
          Financial Statement
        </button>
        <button
          onClick={() => setDoc('schedulec')}
          className={`rounded-xl px-4 py-2.5 text-sm font-bold ${doc === 'schedulec' ? 'bg-[#0b78e3] text-white' : 'border border-slate-200 bg-white text-slate-600'}`}
        >
          Schedule C <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">DRAFT</span>
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            className={`rounded-lg px-3 py-2 text-xs font-bold ${preset === p.id ? 'bg-[#071b35] text-white' : 'border border-slate-200 bg-white text-slate-600'}`}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <span className="flex items-center gap-2 text-xs text-slate-600">
            <input type="date" value={customFrom} max={today} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2" />
            →
            <input type="date" value={customTo} max={today} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2" />
          </span>
        )}
        <button onClick={() => window.print()} className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
          Print
        </button>
      </div>

      {err && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</p>}

      <div className="relative mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        {busy && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-white/70">
            <p className="text-sm font-semibold text-slate-500">Loading transactions…</p>
          </div>
        )}

        {doc === 'statement' ? (
          <div>
            {docHeader('Financial Statement', 'Income and expenses for the period')}
            {data.nIncome === 0 && data.nExpenses === 0 && !busy ? (
              <p className="mt-8 text-center text-sm text-slate-500">No transactions in this period.</p>
            ) : (
              <>
                <SectionTitle>Income</SectionTitle>
                <div className="mt-2">
                  {data.incomeByCat.map((c) => (
                    <DocRow key={c.category} label={c.category} value={money2(c.amount)} tone="income" />
                  ))}
                  <div className="mt-1 border-t border-slate-300 pt-1">
                    <DocRow label={`Total income (${data.nIncome} deposits)`} value={money2(data.incomeTotal)} bold tone="income" />
                  </div>
                </div>

                {data.byPayer.length > 0 && (
                  <>
                    <p className="mt-5 text-[11px] font-bold uppercase tracking-wider text-slate-400">By payer</p>
                    <div className="mt-1">
                      {data.byPayer.map((p) => (
                        <div key={p.payer} className="flex items-center gap-2.5 py-1">
                          <PlatformAvatar platform={p.payer} size={20} />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-slate-600">{p.payer}</span>
                          <span className="shrink-0 font-mono text-[13px] tabular-nums text-emerald-700">{money2(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <SectionTitle>Expenses</SectionTitle>
                <div className="mt-2">
                  {data.expenseByCat.map((c) => (
                    <DocRow key={c.category} label={c.category} value={money2(c.amount)} tone="expense" />
                  ))}
                  <div className="mt-1 border-t border-slate-300 pt-1">
                    <DocRow label={`Total expenses (${data.nExpenses} payments)`} value={money2(data.expenseTotal)} bold tone="expense" />
                  </div>
                </div>

                <SectionTitle>Classification</SectionTitle>
                <div className="mt-2">
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Income</p>
                  <DocRow label="Business" value={money2(data.incomeCls.business)} indent />
                  <DocRow label="Personal" value={money2(data.incomeCls.personal)} indent />
                  <DocRow label="Unclassified" value={money2(data.incomeCls.unclassified)} indent />
                  <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Expenses</p>
                  <DocRow label="Business" value={money2(data.expenseCls.business)} indent />
                  <DocRow label="Personal" value={money2(data.expenseCls.personal)} indent />
                  <DocRow label="Unclassified" value={money2(data.expenseCls.unclassified)} indent />
                  <p className="mt-2 text-[11px] text-slate-400">Mark transactions as Business or Personal in the Bank statement to classify them.</p>
                </div>

                <SectionTitle>Net result</SectionTitle>
                <div className="mt-2 border-y-2 border-slate-900 py-2">
                  <DocRow label="Total income" value={money2(data.incomeTotal)} tone="income" />
                  <DocRow label="Total expenses" value={`−${money2(data.expenseTotal)}`} tone="expense" />
                  <div className="mt-1 border-t border-slate-300 pt-1">
                    <DocRow label="Net result for the period" value={money2(data.net)} bold tone="total" />
                  </div>
                </div>

                <p className="mt-6 text-[11px] leading-5 text-slate-400">
                  Internal transfers excluded from income and expenses: {data.nTransfers} transfer{data.nTransfers === 1 ? '' : 's'} ({money2(data.transferTotal)}). Transfers are never income.
                  Projected entries are never included — this statement uses real bank transactions only.
                </p>
              </>
            )}
          </div>
        ) : (
          <div>
            <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
              <span className="-rotate-12 whitespace-nowrap text-[64px] font-extrabold uppercase tracking-widest text-slate-900/[0.05] sm:text-[96px]">
                Draft — Borrador
              </span>
            </div>
            <div className="relative z-[1]">
              <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-center">
                <p className="text-[13px] font-extrabold uppercase tracking-widest text-amber-800">Draft — Borrador</p>
                <p className="mt-1 text-[11px] leading-5 text-amber-700">
                  Auto-generated from app data for planning only. A CPA/accountant must review and approve it before filing.
                  We are not CPAs and this is not tax advice.
                </p>
              </div>
              {docHeader('Schedule C (Form 1040)', 'Profit or Loss From Business — Sole Proprietorship')}
              <div className="mt-4 grid gap-1 text-[13px] sm:grid-cols-2">
                <p><span className="font-bold text-slate-900">Business name: </span><span className="text-slate-600">Island City Transit</span></p>
                <p><span className="font-bold text-slate-900">Principal business: </span><span className="text-slate-600">Ride Share / Transportation</span></p>
              </div>

              <SectionTitle>Part I — Income</SectionTitle>
              <div className="mt-2">
                <DocRow label="Line 1 · Gross receipts or sales (Business income)" value={money2(data.schedIncome)} />
                <DocRow label="Line 7 · Gross income" value={money2(data.schedIncome)} bold />
              </div>

              <SectionTitle>Part II — Expenses</SectionTitle>
              <div className="mt-2">
                {data.schedLines.length === 0 ? (
                  <p className="py-2 text-[13px] text-slate-500">No Business expenses recorded in this period.</p>
                ) : (
                  data.schedLines.map((l) => (
                    <div key={l.line}>
                      <DocRow label={`Line ${l.line} · ${l.label}`} value={money2(l.amount)} tone="expense" />
                      <p className="pl-4 pb-1 text-[11px] text-slate-400">{l.categories.join(' · ')}</p>
                    </div>
                  ))
                )}
                <div className="mt-1 border-t border-slate-300 pt-1">
                  <DocRow label="Line 28 · Total expenses" value={money2(data.schedExpenseTotal)} bold tone="expense" />
                </div>
              </div>

              <SectionTitle>Net profit</SectionTitle>
              <div className="mt-2 border-y-2 border-slate-900 py-2">
                <DocRow label="Line 29 · Tentative profit (Line 7 − Line 28)" value={money2(data.schedNet)} />
                <div className="mt-1 border-t border-slate-300 pt-1">
                  <DocRow label="Line 31 · Net profit" value={money2(data.schedNet)} bold tone="total" />
                </div>
              </div>

              <p className="mt-6 text-[11px] leading-5 text-slate-400">
                Built from {data.bizExpenseCount} Business expense{data.bizExpenseCount === 1 ? '' : 's'} in this period.
                Category → line mapping is approximate (e.g. unmapped categories go to Line 27a, Other expenses); your CPA must confirm every line.
                {data.unclassifiedExpense > 0 && (
                  <> {money2(data.unclassifiedExpense)} of expenses are still unclassified — mark them Business in the Bank statement to include them here.</>
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
