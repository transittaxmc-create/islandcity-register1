'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Acct = { name: string; current_balance: number | null; institution: string | null; display_order: number }
type MonthData = { ym: string; inc: number; exp: number; byCat: Map<string, number> }
type SummaryMonth = { ym: string; inc: number; exp: number; byCat: [string, number][] }
type ProjItem = { id: string; rule_id: string; date: string; detail: string; frequency: string; debit: number; credit: number }

const SUMMARY_CACHE = 'proj-summary-v1'
const PROJ_ROW_H = 52
const PROJ_VIEW_H = 220

const money = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0)

const moneyK = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1000) return `$${(v / 1000).toFixed(a >= 20000 ? 0 : 1)}k`
  return `$${Math.round(v)}`
}

const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const BLUE = '#3b82f6'
const ORANGE = '#f59e0b'
const GREEN = '#16a34a'
const INK = '#1e293b'
const DONUT_COLORS = ['#3b82f6', '#f59e0b', '#eab308', '#8b5cf6', '#14b8a6', '#ef4444', '#94a3b8']

// Etiqueta corta: banco + últimos 4 dígitos (igual que el Journal)
const shortBank = (a: Acct) => {
  const inst = (a.institution || '').replace(/\s+(Online|Credit Union|Bank)$/i, '')
  const mask = (a.name.match(/(\d{4})\s*$/) || [])[1]
  if (!inst && !mask) return a.name
  return `${inst}${mask ? ` …${mask}` : ''}`.trim() || a.name
}

const fmtD = (iso: string) => {
  if (!iso || typeof iso !== 'string') return '–'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${MES[m - 1]} ${String(d).padStart(2, '0')}`
}

const iconProps = {
  width: 34,
  height: 34,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: INK,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}
const IBar = (
  <svg {...iconProps}>
    <line x1="5" y1="20" x2="5" y2="12" />
    <line x1="11" y1="20" x2="11" y2="4" />
    <line x1="17" y1="20" x2="17" y2="9" />
  </svg>
)
const ICart = (
  <svg {...iconProps}>
    <circle cx="9" cy="20" r="1.6" />
    <circle cx="17" cy="20" r="1.6" />
    <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6" />
  </svg>
)
const IDb = (
  <svg {...iconProps}>
    <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
    <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" />
    <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
  </svg>
)
const IPct = (
  <svg {...iconProps}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <circle cx="8.5" cy="8.5" r="2.5" />
    <circle cx="15.5" cy="15.5" r="2.5" />
  </svg>
)

function Kpi({
  icon,
  label,
  value,
  sub,
  valueColor,
  accent = '#16a34a',
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  valueColor: string
  accent?: string
}) {
  return (
    <div className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span
        className="absolute inset-x-0 top-0 h-1 rounded-t-xl"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}44)` }}
      />
      <div
        className="grid size-10 shrink-0 place-items-center rounded-lg"
        style={{ background: `${accent}14`, color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`mt-0.5 text-[22px] font-extrabold leading-tight tabular-nums ${valueColor}`}>{value}</p>
        <p className="mt-0.5 inline-flex max-w-full truncate rounded-full bg-slate-100 px-2 py-px text-[10px] font-medium text-slate-500">{sub}</p>
      </div>
    </div>
  )
}

const card = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm'
const h3 = 'text-[14px] font-bold text-slate-800'

export default function ProjectionsPanel() {
  const [accounts, setAccounts] = useState<Acct[]>([])
  const [months, setMonths] = useState<SummaryMonth[]>([])
  const [projItems, setProjItems] = useState<ProjItem[]>([])
  const [projTotals, setProjTotals] = useState({ income: 0, expenses: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  const applySummary = (sj: any) => {
    const accs: Acct[] = ((sj.accounts || []) as any[])
      .map((x) => ({
        name: x.name,
        current_balance: x.current_balance ?? null,
        institution: x.institution || null,
        display_order: x.display_order ?? 100,
      }))
      .filter((x) => x.name)
      .sort((a, b) => a.display_order - b.display_order)
    setAccounts(accs)
    setMonths((sj.monthly || []) as SummaryMonth[])
    const items = ((sj.projected || []) as ProjItem[]).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
    setProjItems(items)
    setProjTotals(sj.projTotals || { income: 0, expenses: 0 })
  }

  useEffect(() => {
    let alive = true
    // Ticket C: paint cache instantly, then silent-refresh in background.
    try {
      const raw = sessionStorage.getItem(SUMMARY_CACHE)
      if (raw) {
        applySummary(JSON.parse(raw))
        setLoading(false)
      }
    } catch {}
    ;(async () => {
      try {
        const sj = await fetch('/api/projections/summary').then((r) => r.json())
        if (sj?.error) throw new Error(sj.error)
        if (!alive) return
        applySummary(sj)
        try {
          sessionStorage.setItem(SUMMARY_CACHE, JSON.stringify(sj))
        } catch {}
      } catch {
        if (alive && months.length === 0) setLoadError(true)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onProjScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => setScrollTop(top))
  }

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const projWin = useMemo(() => {
    const n = projItems.length
    if (!n) return { start: 0, end: 0 }
    const start = Math.max(0, Math.floor(scrollTop / PROJ_ROW_H) - 3)
    const end = Math.min(n, Math.ceil((scrollTop + PROJ_VIEW_H) / PROJ_ROW_H) + 3)
    return { start, end }
  }, [scrollTop, projItems.length])

  const bankTotal = useMemo(
    () => accounts.reduce((s, a) => s + (Number(a.current_balance) || 0), 0),
    [accounts]
  )

  // KPIs use server-aggregated projected totals (ticket A).
  const totPI = projTotals.income
  const totPE = projTotals.expenses
  const grandTotal = bankTotal + totPI - totPE
  const projCount = projItems.length

  const monthly: MonthData[] = useMemo(
    () =>
      months.map((m) => {
        const byCat = new Map<string, number>()
        for (const [k, v] of m.byCat || []) byCat.set(k, v)
        return { ym: m.ym, inc: m.inc, exp: m.exp, byCat }
      }),
    [months]
  )

  const catTotal = useMemo(() => {
    const m = new Map<string, number>()
    for (const mo of monthly) for (const [k, v] of mo.byCat) m.set(k, (m.get(k) || 0) + v)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [monthly])

  const maxBar = Math.max(1, ...monthly.flatMap((m) => [m.inc, m.exp]))
  const barTicks = [maxBar, (maxBar * 3) / 4, maxBar / 2, maxBar / 4, 0]

  const donutSegs = catTotal.slice(0, 6) as [string, number][]
  const donutTotal = donutSegs.reduce((s, kv) => s + kv[1], 0)
  const R = 70
  const CIRC = 2 * Math.PI * R
  let dAcc = 0
  const dSegs = donutSegs.map((kv, i) => {
    const k = kv[0]
    const v = kv[1]
    const rot = donutTotal > 0 ? (dAcc / donutTotal) * 360 : 0
    dAcc += v
    return {
      k,
      v,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      dash: donutTotal > 0 ? `${((v / donutTotal) * CIRC).toFixed(1)} ${CIRC.toFixed(1)}` : `0 ${CIRC.toFixed(1)}`,
      rot,
    }
  })

  if (loading) {
    return (
      <div>
        <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900">Proyecciones</h2>
        <p className="mt-0.5 text-xs text-slate-500">Balance bancario final + proyecciones de ingresos y gastos del 2026.</p>
        <p className="mt-6 text-sm text-slate-400">Cargando datos del 2026…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div>
        <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900">Proyecciones</h2>
        <p className="mt-6 text-sm text-slate-500">No se pudieron cargar los datos. Revisa tu conexión e inténtalo de nuevo.</p>
        <button onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900">Proyecciones</h2>
      <p className="mt-0.5 text-xs text-slate-500">Balance bancario final + proyecciones de ingresos y gastos del 2026.</p>

      {/* KPIs */}
      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={IBar} label="Ingresos proyectados" value={money(totPI)} sub={`${projCount} movimientos`} valueColor="text-[#16a34a]" accent="#16a34a" />
        <Kpi icon={ICart} label="Gastos proyectados" value={money(totPE)} sub={`${projCount} movimientos`} valueColor="text-slate-800" accent="#f59e0b" />
        <Kpi icon={IDb} label="Balance bancario" value={money(bankTotal)} sub={`${accounts.length} cuentas · saldo final`} valueColor="text-slate-800" accent="#3b82f6" />
        <Kpi icon={IPct} label="Balance total" value={money(grandTotal)} sub="Banco + ingresos − gastos" valueColor={grandTotal < 0 ? 'text-red-600' : 'text-[#16a34a]'} accent="#8b5cf6" />
      </section>

      {/* Barras + dona */}
      <section className="mt-3 grid gap-3 xl:grid-cols-5">
        <div className={`${card} xl:col-span-3`}>
          <h3 className={h3}>Ingresos vs gastos por mes</h3>
          <div className="mt-2 flex gap-2">
            <div className="flex h-[110px] w-10 shrink-0 flex-col justify-between text-right text-[10px] leading-none text-slate-400">
              {barTicks.map((t) => (
                <span key={t}>{moneyK(t)}</span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative">
                <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                  {barTicks.map((t) => (
                    <div key={t} className="border-t border-slate-100" />
                  ))}
                </div>
                <div className="relative flex h-[110px] items-end gap-1 sm:gap-2">
                  {monthly.map((m) => (
                    <div key={m.ym} className="flex h-full flex-1 items-end justify-center gap-1">
                      <div className="w-full max-w-[20px] rounded-t-[3px]" style={{ height: `${(m.inc / maxBar) * 100}%`, background: BLUE }} title={`Ingresos ${money(m.inc)}`} />
                      <div className="w-full max-w-[20px] rounded-t-[3px]" style={{ height: `${(m.exp / maxBar) * 100}%`, background: ORANGE }} title={`Gastos ${money(m.exp)}`} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-1 flex gap-1 sm:gap-2">
                {monthly.map((m) => (
                  <div key={m.ym} className="flex-1 text-center text-[9px] font-medium text-slate-500">
                    {MES[Number(m.ym.slice(5)) - 1]}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-5 text-xs font-semibold text-slate-600">
            <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-[3px]" style={{ background: BLUE }} /> Ingresos</span>
            <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-[3px]" style={{ background: ORANGE }} /> Gastos</span>
          </div>
        </div>

        <div className={`${card} xl:col-span-2`}>
          <h3 className={h3}>Gastos por categoría</h3>
          <div className="mt-1 flex items-center gap-4">
            <div className="relative size-[104px] shrink-0">
            <svg viewBox="0 0 180 180" className="size-full -rotate-0">
              <circle cx="90" cy="90" r={R} fill="none" stroke="#eef2f7" strokeWidth="26" />
              {dSegs.map((s) => (
                <circle
                  key={s.k}
                  cx="90"
                  cy="90"
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="26"
                  strokeDasharray={s.dash}
                  transform={`rotate(${s.rot - 90} 90 90)`}
                />
              ))}
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="text-sm font-extrabold tabular-nums text-slate-800">{money(donutTotal)}</div>
                <div className="text-[9px] text-slate-400">Total gastos</div>
              </div>
            </div>
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              {dSegs.map((s) => (
                <div key={s.k} className="flex min-w-0 items-center gap-1.5 text-xs">
                  <i className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate text-slate-500">{s.k}</span>
                  <span className="font-bold tabular-nums text-slate-700">{donutTotal > 0 ? Math.round((s.v / donutTotal) * 100) : 0}%</span>
                </div>
              ))}
              {dSegs.length === 0 && <p className="py-2 text-center text-xs text-slate-400">Sin gastos registrados.</p>}
            </div>
          </div>
        </div>
      </section>

      {/* Full Register — horizontal full-width block, bounded scroll box */}
      <section className="mt-3">
        <div className={`${card} flex flex-col`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h3 className={h3}>Full Register 2026</h3>
              <p className="text-[11px] text-slate-400">Desplázate dentro del recuadro para ver todas las transacciones.</p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
              {accounts.length} cuentas · {projCount} proyecciones
            </span>
          </div>
          <div className="scroll-slim mt-2 max-h-[240px] overflow-y-auto rounded-lg border border-slate-100 px-3">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Cuentas · saldo final</p>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="border-b border-slate-200 py-2 pr-2 font-medium">Cuenta</th>
                  <th className="border-b border-slate-200 py-2 font-medium text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const b = a.current_balance
                  return (
                    <tr key={a.name} className="border-t border-slate-100 even:bg-slate-50/60">
                      <td className="py-1.5 pr-2 font-medium text-slate-700">{shortBank(a)}</td>
                      <td className={`py-1.5 text-right font-semibold tabular-nums ${(b ?? 0) < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                        {b == null ? '–' : money(b)}
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-slate-200">
                  <td className="py-1.5 pr-2 font-bold text-slate-800">Total banco</td>
                  <td className={`py-1.5 text-right font-bold ${bankTotal < 0 ? 'text-red-600' : 'text-slate-800'}`}>{money(bankTotal)}</td>
                </tr>
              </tbody>
            </table>

            <p className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">Proyecciones</p>
            {projItems.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">Sin proyecciones registradas.</p>
            ) : (
              <div>
                <div className="grid grid-cols-[72px_1fr_84px_96px] gap-x-2 border-b border-slate-200 py-2 pr-2 text-left text-[11px] text-slate-400">
                  <span className="font-medium">Fecha</span>
                  <span className="font-medium">Detalle</span>
                  <span className="font-medium">Tipo</span>
                  <span className="text-right font-medium">Monto</span>
                </div>
                <div
                  ref={listRef}
                  onScroll={onProjScroll}
                  className="scroll-slim overflow-y-auto"
                  style={{ height: PROJ_VIEW_H }}
                >
                  <div style={{ height: projItems.length * PROJ_ROW_H, position: 'relative' }}>
                    {projItems.slice(projWin.start, projWin.end).map((p, i) => {
                      const idx = projWin.start + i
                      const isInc = Number(p.credit) > 0
                      return (
                        <div
                          key={p.id}
                          className={`grid grid-cols-[72px_1fr_84px_96px] items-center gap-x-2 border-t border-slate-100 pr-2 text-sm ${idx % 2 === 1 ? 'bg-slate-50/60' : ''}`}
                          style={{ position: 'absolute', top: idx * PROJ_ROW_H, left: 0, right: 0, height: PROJ_ROW_H }}
                        >
                          <span className="whitespace-nowrap tabular-nums text-slate-500">{fmtD(p.date)}</span>
                          <span className="min-w-0">
                            <p className="truncate font-medium text-slate-700">{p.detail}</p>
                            <p className="text-[11px] text-slate-400">{p.frequency}</p>
                          </span>
                          <span className={`whitespace-nowrap font-semibold ${isInc ? 'text-[#16a34a]' : 'text-red-500'}`}>
                            {isInc ? 'Ingreso' : 'Gasto'}
                          </span>
                          <span className={`whitespace-nowrap text-right font-semibold tabular-nums ${isInc ? 'text-[#16a34a]' : 'text-red-500'}`}>
                            {isInc ? '+' : '−'}{money(Number(isInc ? p.credit : p.debit))}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl border-t-2 border-[#16a34a] bg-[#f0faf8] px-4 py-2">
            <p className="text-sm font-extrabold text-slate-800">BALANCE TOTAL</p>
            <p className={`text-lg font-extrabold tabular-nums ${grandTotal < 0 ? 'text-red-600' : 'text-slate-800'}`}>{money(grandTotal)}</p>
          </div>
        </div>
      </section>

    </div>
  )
}
