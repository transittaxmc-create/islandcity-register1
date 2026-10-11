'use client'

import { useEffect, useMemo, useState } from 'react'

type Acct = { name: string; current_balance: number | null; institution: string | null; display_order: number }
type ProjItem = { id: string; rule_id: string; date: string; detail: string; frequency: string; debit: number; credit: number }
type RuleItem = { id: string; concept: string; amount: number; type: string; frequency: string; pay_day: string; end_date: string | null }
type Tx = { id: string; date: string; detail: string; debit: number; credit: number; category: string }

const SUMMARY_CACHE = 'proj-summary-v1'
const MAIN_BANK_KEY = 'proj-main-bank'
const OTHER_BAL_KEY = 'proj-other-bal'
const DEFAULT_MAIN = 'Access Account …6393'

const num2 = (v: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0)

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

function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

type MoveRow = { key: string; date: string; label: string; sub: string; net: number; chronoBal: number }

export default function ProjectionsPanel() {
  const [accounts, setAccounts] = useState<Acct[]>([])
  const [projected, setProjected] = useState<ProjItem[]>([])
  const [ruleItems, setRuleItems] = useState<RuleItem[]>([])
  const [mainBank, setMainBank] = useState<string>(DEFAULT_MAIN)
  const [otherEdits, setOtherEdits] = useState<Record<string, string>>({})
  const [mainTxs, setMainTxs] = useState<Tx[]>([])
  const [sortKey, setSortKey] = useState('date-asc')
  const [newRule, setNewRule] = useState<null | {
    date: string; detail: string; ptype: string; amount: string; frequency: string; end_date: string
  }>(null)
  const [ruleBusy, setRuleBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const today = useMemo(localToday, [])
  const year = today.slice(0, 4)
  const yearEnd = `${year}-12-31`

  // Preferencias guardadas: banco principal + balances corregidos
  useEffect(() => {
    try {
      const s = localStorage.getItem(MAIN_BANK_KEY)
      if (s) setMainBank(s)
      const o = localStorage.getItem(OTHER_BAL_KEY)
      if (o) setOtherEdits(JSON.parse(o) || {})
    } catch {}
  }, [])

  const pickMain = (name: string) => {
    setMainBank(name)
    try { localStorage.setItem(MAIN_BANK_KEY, name) } catch {}
  }

  const setOtherBal = (name: string, v: string) => {
    setOtherEdits((prev) => {
      const n = { ...prev, [name]: v }
      try { localStorage.setItem(OTHER_BAL_KEY, JSON.stringify(n)) } catch {}
      return n
    })
  }

  const resetOtherBals = () => {
    setOtherEdits({})
    try { localStorage.removeItem(OTHER_BAL_KEY) } catch {}
  }

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
    const items = ((sj.projected || []) as ProjItem[]).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
    setProjected(items)
    setRuleItems(((sj.ruleItems || []) as RuleItem[]).slice().sort((a, b) => String(a.pay_day).localeCompare(String(b.pay_day))))
  }

  const refreshSummary = async () => {
    try {
      const sj = await fetch('/api/projections/summary', { cache: 'no-store' }).then((r) => r.json())
      if (sj?.error) throw new Error(sj.error)
      applySummary(sj)
      try {
        sessionStorage.setItem(SUMMARY_CACHE, JSON.stringify(sj))
      } catch {}
    } catch {}
  }

  const commitRule = async () => {
    if (!newRule || ruleBusy) return
    const amount = Math.abs(Number(newRule.amount) || 0)
    if (!newRule.detail.trim() || amount <= 0 || !newRule.date) return
    setRuleBusy(true)
    try {
      const isInc = newRule.ptype === 'ingreso'
      const res = await fetch('/api/reconcile/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_type: 'proyectado',
          date: newRule.date,
          detail: newRule.detail.trim(),
          frequency: newRule.frequency,
          debit: isInc ? 0 : amount,
          credit: isInc ? amount : 0,
          end_date: newRule.end_date || null,
        }),
      }).then((r) => r.json())
      if (res?.error) throw new Error(res.error)
      setNewRule(null)
      await refreshSummary()
    } catch {
      // keep the form open so nothing is lost
    } finally {
      setRuleBusy(false)
    }
  }

  const deleteRule = async (id: string) => {
    try {
      await fetch(`/api/reconcile/data?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      await refreshSummary()
    } catch {}
  }

  useEffect(() => {
    let alive = true
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
        if (alive) setLoadError(true)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Banco principal efectivo (con fallback si el guardado ya no existe)
  const effMain = accounts.some((a) => a.name === mainBank)
    ? mainBank
    : accounts.find((a) => a.name === DEFAULT_MAIN)?.name || accounts[0]?.name || ''

  // Transacciones reales del banco principal desde hoy hasta fin de año
  useEffect(() => {
    if (!effMain) return
    let alive = true
    ;(async () => {
      const m0 = Number(today.slice(5, 7))
      const all: Tx[] = []
      for (let m = m0; m <= 12; m++) {
        const ym = `${year}-${String(m).padStart(2, '0')}`
        try {
          const d = await fetch(`/api/reconcile/data?month=${ym}`).then((r) => r.json())
          for (const t of d.transactions || []) {
            if (t.bank_account === effMain && String(t.date) >= today && t.entry_type !== 'proyectado') {
              all.push({
                id: String(t.id),
                date: t.date,
                detail: t.detail || '',
                debit: Number(t.debit) || 0,
                credit: Number(t.credit) || 0,
                category: t.category || 'Otro',
              })
            }
          }
        } catch {}
      }
      if (alive) setMainTxs(all)
    })()
    return () => {
      alive = false
    }
  }, [effMain, today, year])

  // Proyecciones dentro de la ventana: hoy → 31 dic
  const projWin = useMemo(
    () => projected.filter((p) => p.date >= today && p.date <= yearEnd),
    [projected, today, yearEnd]
  )

  // Gráfica de barras: proyectado por mes (mes actual → dic)
  const winMonths = useMemo(() => {
    const m0 = Number(today.slice(5, 7))
    const arr: { ym: string; inc: number; exp: number }[] = []
    for (let m = m0; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`
      let inc = 0
      let exp = 0
      for (const p of projWin) {
        if (p.date.slice(0, 7) === ym) {
          inc += Number(p.credit) || 0
          exp += Number(p.debit) || 0
        }
      }
      arr.push({ ym, inc, exp })
    }
    return arr
  }, [projWin, today, year])

  // Dona: gastos proyectados por detalle
  const donutProj = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of projWin) {
      const d = Number(p.debit) || 0
      if (d > 0) map.set(p.detail, (map.get(p.detail) || 0) + d)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [projWin])

  const maxBar = Math.max(1, ...winMonths.flatMap((m) => [m.inc, m.exp]))
  const barTicks = [maxBar, (maxBar * 3) / 4, maxBar / 2, maxBar / 4, 0]

  const donutSegs = donutProj.slice(0, 6) as [string, number][]
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

  // Balances: banco principal + otros (editables)
  const mainAcct = accounts.find((a) => a.name === effMain)
  const mainBal = Number(mainAcct?.current_balance) || 0
  const otherAccts = useMemo(() => accounts.filter((a) => a.name && a.name !== effMain), [accounts, effMain])
  const otherVal = (a: Acct) => {
    const raw = otherEdits[a.name]
    if (raw !== undefined && raw !== '') {
      const n = Number(raw)
      return isNaN(n) ? 0 : n
    }
    return Number(a.current_balance) || 0
  }
  const othersTotal = otherAccts.reduce((s, a) => s + otherVal(a), 0)
  const bankTotal = mainBal + othersTotal

  const winInc = projWin.reduce((s, p) => s + (Number(p.credit) || 0), 0)
  const winExp = projWin.reduce((s, p) => s + (Number(p.debit) || 0), 0)
  const winIncCount = projWin.filter((p) => Number(p.credit) > 0).length
  const winExpCount = projWin.filter((p) => Number(p.debit) > 0).length
  const grandTotal = bankTotal + winInc - winExp

  // Movimientos del registro (solo banco principal), con balance corrido cronológico
  const movesChrono: MoveRow[] = useMemo(() => {
    const arr = [
      ...mainTxs.map((t) => ({
        key: `tx-${t.id}`,
        date: t.date,
        label: t.detail,
        sub: t.category,
        net: (Number(t.credit) || 0) - (Number(t.debit) || 0),
      })),
      ...projWin.map((p) => ({
        key: `pj-${p.id}`,
        date: p.date,
        label: p.detail,
        sub: `Proyección · ${p.frequency || ''}`,
        net: (Number(p.credit) || 0) - (Number(p.debit) || 0),
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
    let run = bankTotal
    return arr.map((m) => {
      run += m.net
      return { ...m, chronoBal: run }
    })
  }, [mainTxs, projWin, bankTotal])

  const movesSorted = useMemo(() => {
    const r = [...movesChrono]
    switch (sortKey) {
      case 'date-desc':
        return r.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key))
      case 'entity':
        return r.sort((a, b) => a.label.localeCompare(b.label) || a.date.localeCompare(b.date))
      case 'amount-desc':
        return r.sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      case 'amount-asc':
        return r.sort((a, b) => Math.abs(a.net) - Math.abs(b.net))
      default:
        return r
    }
  }, [movesChrono, sortKey])

  if (loading) {
    return (
      <div>
        <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900">Proyecciones</h2>
        <p className="mt-0.5 text-xs text-slate-500">Hoy → 31 de diciembre · banco principal + proyecciones.</p>
        <p className="mt-6 text-sm text-slate-400">Cargando…</p>
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
      <p className="mt-0.5 text-xs text-slate-500">
        {fmtD(today)} → 31 dic {year} · banco principal + proyecciones.
      </p>

      {/* KPIs */}
      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={IBar} label="Ingresos proyectados" value={money(winInc)} sub={`${winIncCount} movimientos`} valueColor="text-[#16a34a]" accent="#16a34a" />
        <Kpi icon={ICart} label="Gastos proyectados" value={money(winExp)} sub={`${winExpCount} movimientos`} valueColor="text-slate-800" accent="#f59e0b" />
        <Kpi icon={IDb} label="Balance bancario" value={money(bankTotal)} sub={`${accounts.length} cuentas · a hoy`} valueColor="text-slate-800" accent="#3b82f6" />
        <Kpi icon={IPct} label="Balance total" value={money(grandTotal)} sub="Banco + proy. − proy." valueColor={grandTotal < 0 ? 'text-red-600' : 'text-[#16a34a]'} accent="#8b5cf6" />
      </section>

      {/* Proyecciones — reglas con entrada en línea */}
      <section className="mt-3">
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className={h3}>Proyecciones</h3>
              <p className="mt-0.5 text-[11px] text-slate-400">Ingresos y gastos recurrentes. Se suman a los totales de arriba.</p>
            </div>
            {!newRule && (
              <button
                onClick={() =>
                  setNewRule({
                    date: today,
                    detail: '',
                    ptype: 'gasto',
                    amount: '',
                    frequency: 'Mensual',
                    end_date: '',
                  })
                }
                className="rounded-lg bg-[#147d6b] px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#106b5c]"
              >
                + Añadir proyección
              </button>
            )}
          </div>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Inicio</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Detalle</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Tipo</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-medium">Monto</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Frecuencia</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Hasta cuándo</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {newRule && (
                  <tr className="border-t-2 border-[#40b9a1] bg-emerald-50/60">
                    <td className="px-2 py-2">
                      <input type="date" value={newRule.date} onChange={(e) => setNewRule({ ...newRule, date: e.target.value })} className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm" />
                    </td>
                    <td className="px-2 py-2">
                      <input value={newRule.detail} onChange={(e) => setNewRule({ ...newRule, detail: e.target.value })} placeholder="Ej. Car leasing" className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm" />
                    </td>
                    <td className="px-2 py-2">
                      <select value={newRule.ptype} onChange={(e) => setNewRule({ ...newRule, ptype: e.target.value })} className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm">
                        <option value="gasto">Gasto</option>
                        <option value="ingreso">Ingreso</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" inputMode="decimal" value={newRule.amount} onChange={(e) => setNewRule({ ...newRule, amount: e.target.value })} placeholder="0.00" className="w-full rounded border border-slate-200 px-1 py-0.5 text-right font-mono text-sm" />
                    </td>
                    <td className="px-2 py-2">
                      <select value={newRule.frequency} onChange={(e) => setNewRule({ ...newRule, frequency: e.target.value })} className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm">
                        {['Un solo pago', 'Diaria', 'Semanal', 'Mensual', 'Anual'].map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input type="date" value={newRule.end_date} onChange={(e) => setNewRule({ ...newRule, end_date: e.target.value })} title="Hasta cuándo corre esta proyección (opcional)" className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm" />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={commitRule} disabled={ruleBusy} className="rounded-lg bg-[#40b9a1] px-2 py-1 text-xs font-bold text-[#10243f] disabled:opacity-50">✓</button>
                        <button onClick={() => setNewRule(null)} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">✕</button>
                      </div>
                    </td>
                  </tr>
                )}
                {ruleItems.map((r) => {
                  const isInc = r.type === 'ingreso'
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-500">{fmtD(r.pay_day)}</td>
                      <td className="px-2 py-2 font-medium text-slate-700">{r.concept}</td>
                      <td className={`whitespace-nowrap px-2 py-2 font-semibold ${isInc ? 'text-[#16a34a]' : 'text-red-500'}`}>
                        {isInc ? 'Ingreso' : 'Gasto'}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums ${isInc ? 'text-[#16a34a]' : 'text-slate-800'}`}>
                        {money(r.amount)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">{r.frequency}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-slate-500">{r.end_date ? fmtD(r.end_date) : '—'}</td>
                      <td className="px-2 py-2 text-right">
                        <button onClick={() => deleteRule(r.id)} title="Borrar proyección" className="rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:bg-red-50 hover:text-red-600">✕</button>
                      </td>
                    </tr>
                  )
                })}
                {ruleItems.length === 0 && !newRule && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">Sin proyecciones. Toca <b>+ Añadir proyección</b> para registrar ingresos y gastos recurrentes.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Barras + dona — solo ventana de proyección */}
      <section className="mt-3 grid gap-3 xl:grid-cols-5">
        <div className={`${card} xl:col-span-3`}>
          <h3 className={h3}>Proyectado por mes</h3>
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
                  {winMonths.map((m) => (
                    <div key={m.ym} className="flex h-full flex-1 items-end justify-center gap-1">
                      <div className="w-full max-w-[20px] rounded-t-[3px]" style={{ height: `${(m.inc / maxBar) * 100}%`, background: BLUE }} title={`Ingresos ${money(m.inc)}`} />
                      <div className="w-full max-w-[20px] rounded-t-[3px]" style={{ height: `${(m.exp / maxBar) * 100}%`, background: ORANGE }} title={`Gastos ${money(m.exp)}`} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-1 flex gap-1 sm:gap-2">
                {winMonths.map((m) => (
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
          <h3 className={h3}>Gastos proyectados</h3>
          <div className="mt-1 flex items-center gap-4">
            <div className="relative size-[120px] shrink-0">
            <svg viewBox="0 0 180 180" className="size-full">
              <circle cx="90" cy="90" r={R} fill="none" stroke="#eef2f7" strokeWidth="22" />
              {dSegs.map((s) => (
                <circle
                  key={s.k}
                  cx="90"
                  cy="90"
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="22"
                  strokeDasharray={s.dash}
                  transform={`rotate(${s.rot - 90} 90 90)`}
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex max-w-[86px] flex-col items-center justify-center px-1 text-center leading-tight">
                <div className="w-full truncate text-[13px] font-extrabold tabular-nums tracking-tight text-slate-800">{money(donutTotal)}</div>
                <div className="text-[8px] font-medium text-slate-400">Total proyectado</div>
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
              {dSegs.length === 0 && <p className="py-2 text-center text-xs text-slate-400">Sin gastos proyectados.</p>}
            </div>
          </div>
        </div>
      </section>

      {/* Registro de proyección — banco principal */}
      <section className="mt-3">
        <div className={`${card} flex flex-col`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h3 className={h3}>Registro de proyección</h3>
              <p className="text-[11px] text-slate-400">{fmtD(today)} → 31 dic {year} · solo banco principal</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] font-semibold text-slate-500">Banco principal</label>
              <select
                value={effMain}
                onChange={(e) => pickMain(e.target.value)}
                title="Banco principal para proyecciones"
                className="max-w-[220px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
              >
                {accounts.map((a) => (
                  <option key={a.name} value={a.name}>{shortBank(a)}</option>
                ))}
              </select>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                title="Ordenar"
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600"
              >
                <option value="date-asc">Fecha ↑</option>
                <option value="date-desc">Fecha ↓</option>
                <option value="entity">Detalle A–Z</option>
                <option value="amount-desc">Monto ↓</option>
                <option value="amount-asc">Monto ↑</option>
              </select>
              <span className="shrink-0 rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
                {movesSorted.length} movs
              </span>
            </div>
          </div>

          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Fecha</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Banco / Detalle</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Tipo</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-medium">Monto</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {/* Línea 1: banco principal */}
                <tr className="border-t-2 border-[#3b82f6] bg-blue-50/60">
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-600">{fmtD(today)}</td>
                  <td className="px-2 py-2 font-bold text-slate-800">{mainAcct ? shortBank(mainAcct) : effMain}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs font-semibold text-blue-700">Banco principal</td>
                  <td className="px-2 py-2 text-right text-slate-400">—</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-extrabold tabular-nums text-slate-900">{money(mainBal)}</td>
                </tr>
                {/* Otros bancos: balances editables */}
                {otherAccts.map((a) => (
                  <tr key={a.name} className="border-t border-slate-100 bg-slate-50/50">
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-500">{fmtD(today)}</td>
                    <td className="px-2 py-1.5 font-medium text-slate-600">{shortBank(a)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-400">Otro banco</td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={otherEdits[a.name] ?? ''}
                        placeholder={num2(Number(a.current_balance) || 0)}
                        onChange={(e) => setOtherBal(a.name, e.target.value)}
                        title="Balance a hoy (editable)"
                        className="w-28 rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-sm text-slate-700"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums text-slate-700">{money(otherVal(a))}</td>
                  </tr>
                ))}
                {otherAccts.length > 0 && (
                  <tr className="border-t border-slate-200 bg-white">
                    <td colSpan={3} className="px-2 py-1.5 text-right text-[11px] text-slate-400">
                      <button onClick={resetOtherBals} className="underline hover:text-slate-600">restablecer balances</button>
                    </td>
                    <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-slate-500">Total bancos</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-extrabold tabular-nums text-slate-900">{money(bankTotal)}</td>
                  </tr>
                )}
                {/* Movimientos del banco principal */}
                {movesSorted.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">Sin movimientos proyectados — añade proyecciones arriba.</td></tr>
                ) : (
                  movesSorted.map((r) => (
                    <tr key={r.key} className="border-t border-slate-100 even:bg-slate-50/60">
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-500">{fmtD(r.date)}</td>
                      <td className="px-2 py-1.5">
                        <div className="max-w-[240px] truncate font-medium text-slate-700">{r.label}</div>
                        <div className="text-[10px] text-slate-400">{r.sub}</div>
                      </td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-xs font-semibold ${r.net >= 0 ? 'text-[#16a34a]' : 'text-red-500'}`}>
                        {r.net >= 0 ? 'Ingreso' : 'Gasto'}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums ${r.net >= 0 ? 'text-[#16a34a]' : 'text-slate-800'}`}>
                        {r.net >= 0 ? '+' : '−'}{num2(Math.abs(r.net))}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600">{num2(r.chronoBal)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border-t-2 border-[#16a34a] bg-[#f0faf8] px-4 py-2 text-sm">
            <span className="font-extrabold text-slate-800">Balance inicial <span className="font-mono tabular-nums">{num2(bankTotal)}</span></span>
            <span className="font-semibold text-slate-500">
              <span className="text-[#16a34a]">+{num2(winInc)}</span>
              {' · '}
              <span className="text-red-500">−{num2(winExp)}</span>
            </span>
            <span className={`font-extrabold font-mono tabular-nums ${grandTotal < 0 ? 'text-red-600' : 'text-[#16a34a]'}`}>
              Final {money(grandTotal)}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
