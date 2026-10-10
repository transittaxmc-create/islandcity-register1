'use client'

import { useEffect, useMemo, useState } from 'react'

type Acct = { name: string; current_balance: number | null; institution: string | null; display_order: number }
type MonthData = { ym: string; txs: any[]; proj: any[]; linked: Set<string> }

const money = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0)

const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const DONUT_COLORS = ['#147d6b', '#56b8a5', '#e4a24f', '#b76532', '#7c8db0', '#dce5ee']

// Etiqueta corta: banco + últimos 4 dígitos (igual que el Journal)
// Recibe el objeto cuenta completo.
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

function Kpi({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accent || 'text-[#10243f]'}`}>{value}</p>
      <p className="mt-1 text-[11px] text-slate-400">{detail}</p>
    </div>
  )
}

export default function ProjectionsPanel() {
  const [accounts, setAccounts] = useState<Acct[]>([])
  const [data, setData] = useState<MonthData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const lj = await fetch('/api/reconcile/lists').then((r) => r.json()).catch(() => ({}))
        const accs: Acct[] = ((lj.accounts || []) as any[])
          .map((x) => ({
            name: x.name,
            current_balance: x.current_balance ?? null,
            institution: x.institution || null,
            display_order: x.display_order ?? 100,
          }))
          .filter((x) => x.name)
          .sort((a, b) => a.display_order - b.display_order)
        const yms = Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)
        const rows: MonthData[] = await Promise.all(
          yms.map(async (ym) => {
            const [dj, tj] = await Promise.all([
              fetch(`/api/reconcile/data?month=${ym}`).then((r) => r.json()).catch(() => ({})),
              fetch(`/api/reconcile/transfers?links=1&month=${ym}`).then((r) => r.json()).catch(() => ({})),
            ])
            const linked = new Set<string>()
            for (const l of tj.links || []) {
              linked.add(String(l.from_tx))
              linked.add(String(l.to_tx))
            }
            return { ym, txs: dj.transactions || [], proj: dj.projected || [], linked }
          })
        )
        if (!alive) return
        setAccounts(accs)
        setData(rows)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const bankTotal = useMemo(
    () => accounts.reduce((s, a) => s + (Number(a.current_balance) || 0), 0),
    [accounts]
  )

  const proj = useMemo(() => data.flatMap((d) => d.proj).sort((a, b) => String(a.date).localeCompare(String(b.date))), [data])
  const projIncome = useMemo(() => proj.filter((p) => Number(p.credit) > 0), [proj])
  const projExpenses = useMemo(() => proj.filter((p) => Number(p.debit) > 0), [proj])
  const totPI = useMemo(() => projIncome.reduce((s, p) => s + Number(p.credit), 0), [projIncome])
  const totPE = useMemo(() => projExpenses.reduce((s, p) => s + Number(p.debit), 0), [projExpenses])
  const grandTotal = bankTotal + totPI - totPE

  const monthly = useMemo(
    () =>
      data.map((d) => {
        let inc = 0
        let exp = 0
        const byCat = new Map<string, number>()
        for (const t of d.txs) {
          if (d.linked.has(String(t.id))) continue
          const c = Number(t.credit) || 0
          const db = Number(t.debit) || 0
          inc += c
          exp += db
          if (db > 0) {
            const k = t.category || 'Otro'
            byCat.set(k, (byCat.get(k) || 0) + db)
          }
        }
        return { ym: d.ym, inc, exp, byCat }
      }),
    [data]
  )

  const catTotal = useMemo(() => {
    const m = new Map<string, number>()
    for (const mo of monthly) for (const [k, v] of mo.byCat) m.set(k, (m.get(k) || 0) + v)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [monthly])

  const maxBar = Math.max(1, ...monthly.flatMap((m) => [m.inc, m.exp]))
  const nets = monthly.map((m) => m.inc - m.exp)
  const maxNet = Math.max(1, ...nets.map(Math.abs))

  if (loading) {
    return (
      <div>
        <h2 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Proyecciones</h2>
        <p className="mt-4 text-sm text-slate-400">Cargando datos del 2026…</p>
      </div>
    )
  }

  const donutTop = catTotal.slice(0, 5)
  const donutOther = catTotal.slice(5).reduce((s, [, v]) => s + v, 0)
  const donutSegs = [...donutTop, ...(donutOther > 0 ? [['Otros', donutOther] as [string, number]] : [])]
  const donutTotal = donutSegs.reduce((s, [, v]) => s + v, 0)
  let acc = 0
  const donutBg =
    donutTotal > 0
      ? `conic-gradient(${donutSegs
          .map(([ , v], i) => {
            const from = (acc / donutTotal) * 100
            acc += v
            const to = (acc / donutTotal) * 100
            return `${DONUT_COLORS[i % DONUT_COLORS.length]} ${from}% ${to}%`
          })
          .join(', ')})`
      : '#eef2f7'

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#167b6a]">
        <span>📊</span> Vista anual
      </div>
      <h2 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Proyecciones</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Balance bancario final + proyecciones de ingresos y gastos. Todo el 2026 acumulado.
      </p>

      {/* Totales arriba */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Balance bancario" value={money(bankTotal)} detail={`${accounts.length} cuentas · saldo final`} />
        <Kpi label="Ingresos proyectados" value={money(totPI)} detail={`${projIncome.length} movimientos`} accent="text-[#147d6b]" />
        <Kpi label="Gastos proyectados" value={money(totPE)} detail={`${projExpenses.length} movimientos`} accent="text-[#b76532]" />
        <Kpi label="Balance total" value={money(grandTotal)} detail="Banco + ingresos − gastos" accent={grandTotal < 0 ? 'text-red-600' : 'text-[#10243f]'} />
      </section>

      {/* Gráficos */}
      <section className="mt-6 grid gap-5 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold">Ingresos vs gastos por mes</h3>
          <p className="mt-1 text-xs text-slate-500">Real 2026, sin transferencias internas</p>
          <div className="mt-6 flex h-[190px] items-end gap-2 sm:gap-3">
            {monthly.map((m) => (
              <div key={m.ym} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <div className="flex h-full w-full items-end justify-center gap-1">
                  <div className="w-[42%] rounded-t bg-[#147d6b]" style={{ height: `${(m.inc / maxBar) * 100}%` }} title={`Ingresos ${money(m.inc)}`} />
                  <div className="w-[42%] rounded-t bg-[#e4a24f]" style={{ height: `${(m.exp / maxBar) * 100}%` }} title={`Gastos ${money(m.exp)}`} />
                </div>
                <span className="text-[9px] font-medium text-slate-500">{MES[Number(m.ym.slice(5)) - 1]}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[11px] font-semibold">
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#147d6b]" /> Ingresos</span>
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#e4a24f]" /> Gastos</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold">Tendencia neta</h3>
          <p className="mt-1 text-xs text-slate-500">Ingresos − gastos por mes</p>
          <svg viewBox="0 0 300 190" className="mt-4 h-[190px] w-full" preserveAspectRatio="none">
            <line x1="0" y1="95" x2="300" y2="95" stroke="#e2e8f0" strokeDasharray="4 4" />
            <polyline
              fill="none"
              stroke="#147d6b"
              strokeWidth="2.5"
              points={nets.map((n, i) => `${(i / Math.max(1, nets.length - 1)) * 300},${95 - (n / maxNet) * 80}`).join(' ')}
            />
            {nets.map((n, i) => (
              <circle key={i} cx={(i / Math.max(1, nets.length - 1)) * 300} cy={95 - (n / maxNet) * 80} r="4" fill={n < 0 ? '#b76532' : '#147d6b'} />
            ))}
          </svg>
          <div className="mt-2 flex justify-between text-[9px] font-medium text-slate-500">
            <span>{MES[0]}</span>
            <span>{MES[nets.length - 1]}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold">Gastos por categoría</h3>
          <p className="mt-1 text-xs text-slate-500">Acumulado 2026</p>
          <div className="mx-auto mt-5 grid size-[170px] place-items-center rounded-full" style={{ background: donutBg }}>
            <div className="grid size-[112px] place-items-center rounded-full bg-white text-center">
              <div>
                <div className="text-[10px] text-slate-400">Total</div>
                <div className="text-lg font-bold">{money(donutTotal)}</div>
              </div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2">
            {donutSegs.map(([k, v], i) => (
              <div key={k} className="flex items-center gap-2">
                <i className="size-2.5 shrink-0 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-slate-500">{k}</p>
                  <p className="text-xs font-bold">{donutTotal > 0 ? Math.round((v / donutTotal) * 100) : 0}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ventana grande con scroll: register del año */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <h3 className="font-bold">Register 2026</h3>
          <p className="mt-1 text-xs text-slate-500">
            Balances finales por cuenta + proyecciones. Desliza dentro de la ventana — los gráficos quedan visibles.
          </p>
        </div>
        <div className="h-[62vh] overflow-y-auto">
          <div className="divide-y divide-slate-100">
            <div className="p-5">
              <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Cuentas bancarias · saldo final</p>
              <ul className="divide-y divide-slate-50">
                {accounts.map((a) => (
                  <li key={a.name} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="font-medium text-slate-700">{shortBank(a)}</span>
                    <span className={`font-mono font-bold ${(a.current_balance ?? 0) < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                      {a.current_balance == null ? '–' : money(a.current_balance)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-bold">
                <span>Total banco</span>
                <span className={`font-mono ${bankTotal < 0 ? 'text-red-600' : ''}`}>{money(bankTotal)}</span>
              </div>
            </div>
            <div className="p-5">
              <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
                Proyecciones de ingresos · <span className="text-[#147d6b]">{money(totPI)}</span>
              </p>
              {projIncome.length === 0 ? (
                <p className="py-3 text-center text-sm text-slate-400">Sin ingresos proyectados.</p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {projIncome.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-700">{p.detail}</p>
                        <p className="text-[11px] text-slate-400">{fmtD(p.date)} · {p.frequency}</p>
                      </div>
                      <span className="shrink-0 font-mono font-bold text-[#147d6b]">+{money(Number(p.credit))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-5">
              <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
                Proyecciones de gastos · <span className="text-[#b76532]">{money(totPE)}</span>
              </p>
              {projExpenses.length === 0 ? (
                <p className="py-3 text-center text-sm text-slate-400">Sin gastos proyectados.</p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {projExpenses.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-700">{p.detail}</p>
                        <p className="text-[11px] text-slate-400">{fmtD(p.date)} · {p.frequency}</p>
                      </div>
                      <span className="shrink-0 font-mono font-bold text-[#b76532]">−{money(Number(p.debit))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-[#147d6b] bg-[#f0faf8] p-5">
          <div>
            <p className="text-sm font-bold text-[#10243f]">BALANCE TOTAL</p>
            <p className="text-[11px] text-slate-500">Banco + ingresos proyectados − gastos proyectados</p>
          </div>
          <p className={`font-mono text-2xl font-bold ${grandTotal < 0 ? 'text-red-600' : 'text-[#10243f]'}`}>{money(grandTotal)}</p>
        </div>
      </section>
    </div>
  )
}
