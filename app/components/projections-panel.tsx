'use client'

import { useEffect, useMemo, useState } from 'react'

type Acct = { name: string; current_balance: number | null; institution: string | null; display_order: number }
type MonthData = { ym: string; txs: any[]; proj: any[]; linked: Set<string> }

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
const GREEN_LINE = '#22c55e'
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
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  valueColor: string
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className={`mt-0.5 text-[27px] font-extrabold leading-tight ${valueColor}`}>{value}</p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">{sub}</p>
      </div>
    </div>
  )
}

const card = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm'
const h3 = 'text-[15px] font-bold text-slate-800'

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

  const proj = useMemo(
    () => data.flatMap((d) => d.proj).sort((a, b) => String(a.date).localeCompare(String(b.date))),
    [data]
  )
  const totPI = useMemo(() => proj.reduce((s, p) => s + Number(p.credit || 0), 0), [proj])
  const totPE = useMemo(() => proj.reduce((s, p) => s + Number(p.debit || 0), 0), [proj])
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
  const barTicks = [maxBar, (maxBar * 3) / 4, maxBar / 2, maxBar / 4, 0]

  const nets = monthly.map((m) => m.inc - m.exp)
  const maxNet = Math.max(1, ...nets.map(Math.abs))
  const nPts = nets.map((n, i) => ({
    x: nets.length > 1 ? (i / (nets.length - 1)) * 300 : 150,
    y: 95 - (n / maxNet) * 78,
  }))
  const nLine = nPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const nArea = `0,190 ${nLine} 300,190`
  const netTicks = [maxNet, maxNet / 2, 0, -maxNet / 2, -maxNet]

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
        <h2 className="text-[26px] font-extrabold tracking-tight text-slate-900">Proyecciones</h2>
        <p className="mt-1 text-sm text-slate-500">Balance bancario final + proyecciones de ingresos y gastos del 2026.</p>
        <p className="mt-6 text-sm text-slate-400">Cargando datos del 2026…</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-[26px] font-extrabold tracking-tight text-slate-900">Proyecciones</h2>
      <p className="mt-1 text-sm text-slate-500">Balance bancario final + proyecciones de ingresos y gastos del 2026.</p>

      {/* KPIs */}
      <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={IBar} label="Ingresos proyectados" value={money(totPI)} sub={`${proj.filter((p) => Number(p.credit) > 0).length} movimientos`} valueColor="text-[#16a34a]" />
        <Kpi icon={ICart} label="Gastos proyectados" value={money(totPE)} sub={`${proj.filter((p) => Number(p.debit) > 0).length} movimientos`} valueColor="text-slate-800" />
        <Kpi icon={IDb} label="Balance bancario" value={money(bankTotal)} sub={`${accounts.length} cuentas · saldo final`} valueColor="text-slate-800" />
        <Kpi icon={IPct} label="Balance total" value={money(grandTotal)} sub="Banco + ingresos − gastos" valueColor={grandTotal < 0 ? 'text-red-600' : 'text-[#16a34a]'} />
      </section>

      {/* Barras + tendencia */}
      <section className="mt-5 grid gap-5 xl:grid-cols-5">
        <div className={`${card} xl:col-span-3`}>
          <h3 className={h3}>Ingresos vs gastos por mes</h3>
          <div className="mt-4 flex gap-2">
            <div className="flex h-[190px] w-10 shrink-0 flex-col justify-between text-right text-[10px] leading-none text-slate-400">
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
                <div className="relative flex h-[190px] items-end gap-1 sm:gap-2">
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
          <div className="mt-3 flex items-center gap-5 text-xs font-semibold text-slate-600">
            <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-[3px]" style={{ background: BLUE }} /> Ingresos</span>
            <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-[3px]" style={{ background: ORANGE }} /> Gastos</span>
          </div>
        </div>

        <div className={`${card} xl:col-span-2`}>
          <h3 className={h3}>Tendencia neta</h3>
          <div className="mt-4 flex gap-2">
            <div className="flex h-[190px] w-10 shrink-0 flex-col justify-between text-right text-[10px] leading-none text-slate-400">
              {netTicks.map((t) => (
                <span key={t}>{moneyK(t)}</span>
              ))}
            </div>
            <svg viewBox="0 0 300 190" className="h-[190px] min-w-0 flex-1" preserveAspectRatio="none">
              <line x1="0" y1="95" x2="300" y2="95" stroke="#e2e8f0" strokeDasharray="4 4" />
              <polygon points={nArea} fill={GREEN_LINE} opacity="0.12" />
              <polyline points={nLine} fill="none" stroke={GREEN_LINE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {nPts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="4" fill={nets[i] < 0 ? '#ef4444' : GREEN} stroke="#fff" strokeWidth="1.5" />
              ))}
            </svg>
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-medium text-slate-500">
            <span>{MES[0]}</span>
            <span>{nets.length > 0 ? MES[nets.length - 1] : ''}</span>
          </div>
        </div>
      </section>

      {/* Register + dona */}
      <section className="mt-5 grid gap-5 xl:grid-cols-5">
        <div className={`${card} flex flex-col xl:col-span-3`}>
          <h3 className={h3}>Full Register 2026</h3>
          <p className="mt-1 text-xs text-slate-500">Balances finales por cuenta + proyecciones. Desliza dentro de la caja.</p>
          <div className="mt-3 h-[62vh] overflow-y-auto xl:h-[440px]">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Cuentas · saldo final</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="py-2 pr-2 font-medium">Cuenta</th>
                  <th className="py-2 font-medium text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const b = a.current_balance
                  return (
                    <tr key={a.name} className="border-t border-slate-100">
                      <td className="py-2.5 pr-2 font-medium text-slate-700">{shortBank(a)}</td>
                      <td className={`py-2.5 text-right font-semibold ${(b ?? 0) < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                        {b == null ? '–' : money(b)}
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-slate-200">
                  <td className="py-2.5 pr-2 font-bold text-slate-800">Total banco</td>
                  <td className={`py-2.5 text-right font-bold ${bankTotal < 0 ? 'text-red-600' : 'text-slate-800'}`}>{money(bankTotal)}</td>
                </tr>
              </tbody>
            </table>

            <p className="mb-1 mt-6 text-[11px] font-bold uppercase tracking-widest text-slate-400">Proyecciones</p>
            {proj.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">Sin proyecciones registradas.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-400">
                    <th className="py-2 pr-2 font-medium">Fecha</th>
                    <th className="py-2 pr-2 font-medium">Detalle</th>
                    <th className="py-2 pr-2 font-medium">Tipo</th>
                    <th className="py-2 font-medium text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {proj.map((p) => {
                    const isInc = Number(p.credit) > 0
                    return (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="whitespace-nowrap py-2.5 pr-2 text-slate-500">{fmtD(p.date)}</td>
                        <td className="py-2.5 pr-2">
                          <p className="font-medium text-slate-700">{p.detail}</p>
                          <p className="text-[11px] text-slate-400">{p.frequency}</p>
                        </td>
                        <td className={`whitespace-nowrap py-2.5 pr-2 font-semibold ${isInc ? 'text-[#16a34a]' : 'text-red-500'}`}>
                          {isInc ? 'Ingreso' : 'Gasto'}
                        </td>
                        <td className={`whitespace-nowrap py-2.5 text-right font-semibold ${isInc ? 'text-[#16a34a]' : 'text-red-500'}`}>
                          {isInc ? '+' : '−'}{money(Number(isInc ? p.credit : p.debit))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between border-t-2 border-[#16a34a] bg-[#f0faf8] px-4 py-3">
            <p className="text-sm font-extrabold text-slate-800">BALANCE TOTAL</p>
            <p className={`text-xl font-extrabold ${grandTotal < 0 ? 'text-red-600' : 'text-slate-800'}`}>{money(grandTotal)}</p>
          </div>
        </div>

        <div className={`${card} xl:col-span-2`}>
          <h3 className={h3}>Gastos por categoría</h3>
          <div className="relative mx-auto mt-5 size-[172px]">
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
                <div className="text-lg font-extrabold text-slate-800">{money(donutTotal)}</div>
                <div className="text-[10px] text-slate-400">Total gastos</div>
              </div>
            </div>
          </div>
          <div className="mt-5 space-y-2">
            {dSegs.map((s) => (
              <div key={s.k} className="flex items-center gap-2 text-sm">
                <i className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate text-slate-500">{s.k}</span>
                <span className="font-bold text-slate-700">{donutTotal > 0 ? Math.round((s.v / donutTotal) * 100) : 0}%</span>
              </div>
            ))}
            {dSegs.length === 0 && <p className="py-4 text-center text-sm text-slate-400">Sin gastos registrados.</p>}
          </div>
        </div>
      </section>
    </div>
  )
}
