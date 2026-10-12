'use client'

import { useEffect, useMemo, useState } from 'react'

type Acct = { name: string; current_balance: number | null; institution: string | null; display_order: number }
type ProjItem = { id: string; rule_id: string; date: string; detail: string; frequency: string; category: string; debit: number; credit: number }
type RuleItem = { id: string; concept: string; amount: number; type: string; frequency: string; pay_day: string; end_date: string | null; category: string }
type Tx = { id: string; date: string; detail: string; debit: number; credit: number; category: string }

const SUMMARY_CACHE = 'proj-summary-v1'
const MAIN_BANK_KEY = 'proj-main-bank'
const SAFETY_FLOOR_KEY = 'proj-safety-floor'
const HIDE_TR_KEY = 'proj-hide-transfers'
const VIEW_KEY = 'proj-view'
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

// Etiquetas en inglés para frecuencia (los valores internos siguen en español, que es lo que espera el motor)
// v2: redeploy
const FREQS: [string, string][] = [
  ['Un solo pago', 'ONE TIME'],
  ['Diaria', 'DAILY'],
  ['Semanal', 'WEEKLY'],
  ['Mensual', 'MONTHLY'],
  ['Anual', 'YEARLY'],
]
const freqLabel = (f: string) => (FREQS.find(([v]) => v === f)?.[1] || f)
const CATS = [
  'Proyección',
  'Car Leasing',
  'Combustible',
  'Comidas',
  'Telefonía e Internet',
  'Vehículo y Operaciones',
  'Viajes',
  'Software y Servicios',
  'Comisiones Bancarias',
  'Propinas',
  'Otro',
]

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
const IAlert = (
  <svg {...iconProps}>
    <path d="M12 3 2.5 20h19L12 3z" />
    <line x1="12" y1="9.5" x2="12" y2="14" />
    <circle cx="12" cy="17" r="0.6" fill={INK} />
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

type MoveRow = { key: string; date: string; label: string; sub: string; category: string; frequency: string; net: number; chronoBal: number; bankBal: number; ruleId: string | null }
type DailyRow = { date: string; opening: number; inflow: number; outflow: number; net: number; closing: number; health: 'ok' | 'warn' | 'bad' }

// Categorías que son transferencias internas (misma definición que el Estado Bancario)
const TRANSFER_CATS = ['transfer', 'transferencias internas', 'por verificar']
const isTransferCat = (c: string) => TRANSFER_CATS.includes(String(c || '').trim().toLowerCase())

export default function ProjectionsPanel() {
  const [accounts, setAccounts] = useState<Acct[]>([])
  const [projected, setProjected] = useState<ProjItem[]>([])
  const [ruleItems, setRuleItems] = useState<RuleItem[]>([])
  const [mainBank, setMainBank] = useState<string>(DEFAULT_MAIN)
  const [mainTxs, setMainTxs] = useState<Tx[]>([])
  const [sortKey, setSortKey] = useState('date-desc')
  const [safetyFloor, setSafetyFloor] = useState<number>(0)
  const [hideTransfers, setHideTransfers] = useState<boolean>(true)
  const [view, setView] = useState<'banco' | 'proyecciones'>('proyecciones')
  const [ruleBusy, setRuleBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const today = useMemo(localToday, [])
  const year = today.slice(0, 4)
  const yearEnd = `${year}-12-31`
  const emptyEntry = { date: today, detail: '', category: 'Proyección', inc: '', exp: '', frequency: 'Mensual', end_date: '' }
  const [entry, setEntry] = useState({ ...emptyEntry })

  // Edición de proyección guardada: se carga en la primera fila; al guardar se pregunta el alcance.
  const [editing, setEditing] = useState<{ ruleId: string; occurrenceDate: string; frequency: string } | null>(null)
  const [scopeAsk, setScopeAsk] = useState(false)
  // Listas de categorías y vendedores (Ajustes → Cuentas y bancos) para los dropdowns.
  const [catsList, setCatsList] = useState<string[]>([])
  const [vendorsList, setVendorsList] = useState<string[]>([])
  // Modo "+ Añadir nuevo/a": el dropdown se vuelve input ahí mismo en la fila.
  const [newCatMode, setNewCatMode] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [newVenMode, setNewVenMode] = useState(false)
  const [newVen, setNewVen] = useState('')
  const NEW_CAT = '__nueva_categoria__'
  const NEW_VEN = '__nuevo_vendedor__'

  // Preferencias guardadas: banco principal + balances corregidos + mínimo + ocultar transfers
  useEffect(() => {
    try {
      const s = localStorage.getItem(MAIN_BANK_KEY)
      if (s) setMainBank(s)
      const f = localStorage.getItem(SAFETY_FLOOR_KEY)
      if (f !== null && f !== '') setSafetyFloor(Number(f) || 0)
      const h = localStorage.getItem(HIDE_TR_KEY)
      if (h !== null) setHideTransfers(h === '1')
      const v = localStorage.getItem(VIEW_KEY)
      if (v === 'banco' || v === 'proyecciones') setView(v)
    } catch {}
  }, [])

  const setFloor = (v: number) => {
    const n = Math.max(0, Number(v) || 0)
    setSafetyFloor(n)
    try { localStorage.setItem(SAFETY_FLOOR_KEY, String(n)) } catch {}
  }

  const setHideTr = (v: boolean) => {
    setHideTransfers(v)
    try { localStorage.setItem(HIDE_TR_KEY, v ? '1' : '0') } catch {}
  }

  const pickView = (v: 'banco' | 'proyecciones') => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch {}
  }

  const pickMain = (name: string) => {
    setMainBank(name)
    try { localStorage.setItem(MAIN_BANK_KEY, name) } catch {}
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

  // Guarda una categoría/vendedor nuevo en su lista (Ajustes → Cuentas y bancos) para que salga en el dropdown la próxima vez.
  const persistList = async (list: 'categories' | 'vendors', name: string) => {
    const n = name.trim()
    if (!n) return
    if (list === 'categories' && n === 'Proyección') return
    const cur = list === 'categories' ? catsList : vendorsList
    if (cur.some((c) => c.toLowerCase() === n.toLowerCase())) return
    try {
      const j = await fetch('/api/reconcile/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list, name: n }),
      }).then((r) => r.json())
      const finalName = j?.item?.name ? String(j.item.name) : n
      const upd = (prev: string[]) => (prev.some((c) => c.toLowerCase() === finalName.toLowerCase()) ? prev : [...prev, finalName])
      if (list === 'categories') setCatsList(upd)
      else setVendorsList(upd)
    } catch {}
  }

  const cancelEdit = () => {
    setEditing(null)
    setScopeAsk(false)
    setNewCatMode(false)
    setNewVenMode(false)
    setNewCat('')
    setNewVen('')
    setEntry({ ...emptyEntry, date: today })
  }

  const nextOccurrence = (ruleId: string) => {
    const ds = projected
      .filter((p) => String(p.rule_id) === String(ruleId) && p.date >= today)
      .map((p) => p.date)
      .sort()
    return ds[0] || today
  }

  // Tocar una proyección la carga en la primera fila en modo edición.
  const startEdit = (ruleId: string, occurrenceDate: string) => {
    const r = ruleItems.find((x) => String(x.id) === String(ruleId))
    if (!r || ruleBusy) return
    const isInc = String(r.type || '').toLowerCase() === 'ingreso'
    setEntry({
      date: occurrenceDate,
      detail: r.concept || '',
      category: r.category || 'Proyección',
      inc: isInc ? String(r.amount) : '',
      exp: !isInc ? String(r.amount) : '',
      frequency: r.frequency || 'Mensual',
      end_date: r.end_date || '',
    })
    setNewCatMode(false)
    setNewVenMode(false)
    setNewCat('')
    setNewVen('')
    setScopeAsk(false)
    setEditing({ ruleId: String(r.id), occurrenceDate, frequency: r.frequency || '' })
  }

  const commitEntry = async (scope?: 'solo' | 'atras' | 'adelante' | 'todas') => {
    if (ruleBusy) return
    // Resolver vendedor y categoría (incluye los recién creados con "+ Añadir").
    const useNewVen = newVenMode && newVen.trim().length > 0
    const useNewCat = newCatMode && newCat.trim().length > 0
    if (newVenMode && !useNewVen) setNewVenMode(false)
    if (newCatMode && !useNewCat) setNewCatMode(false)
    const venName = (useNewVen ? newVen : entry.detail).trim()
    const catName = (useNewCat ? newCat : entry.category).trim() || 'Proyección'
    const inc = Math.abs(Number(entry.inc) || 0)
    const exp = Math.abs(Number(entry.exp) || 0)
    const amount = inc > 0 ? inc : exp
    if (!venName || amount <= 0 || !entry.date) return
    setRuleBusy(true)
    try {
      await persistList('categories', catName)
      await persistList('vendors', venName)
      const isInc = inc > 0
      if (editing) {
        // En edición con regla recurrente, primero se pregunta el alcance.
        if (editing.frequency !== 'Un solo pago' && !scope) {
          setScopeAsk(true)
          setRuleBusy(false)
          return
        }
        const res = await fetch('/api/reconcile/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ruleId: editing.ruleId,
            pivot: editing.occurrenceDate,
            scope: scope || 'todas',
            values: {
              concept: venName,
              amount,
              type: isInc ? 'ingreso' : 'gasto',
              frequency: entry.frequency,
              pay_day: entry.date,
              end_date: entry.end_date || null,
              category: catName,
            },
          }),
        }).then((r) => r.json())
        if (res?.error) throw new Error(res.error)
      } else {
        const res = await fetch('/api/reconcile/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entry_type: 'proyectado',
            date: entry.date,
            detail: venName,
            category: catName,
            frequency: entry.frequency,
            debit: isInc ? 0 : amount,
            credit: isInc ? amount : 0,
            end_date: entry.end_date || null,
          }),
        }).then((r) => r.json())
        if (res?.error) throw new Error(res.error)
      }
      cancelEdit()
      await refreshSummary()
    } catch {
      // keep the form open so nothing is lost
    } finally {
      setRuleBusy(false)
    }
  }

  // Listas de categorías y vendedores para los dropdowns de la primera fila.
  useEffect(() => {
    ;(async () => {
      try {
        const j = await fetch('/api/reconcile/lists', { cache: 'no-store' }).then((r) => r.json())
        if (j && !j.error) {
          setCatsList(((j.categories || []) as any[]).map((x) => String(x.name)).filter(Boolean))
          setVendorsList(((j.vendors || []) as any[]).map((x) => String(x.name)).filter(Boolean))
        }
      } catch {}
    })()
  }, [])

  const catOptions = useMemo(() => {
    const base = ['Proyección', ...catsList, ...CATS.filter((c) => c !== 'Proyección' && !catsList.includes(c))]
    const uniq = [...new Set(base)]
    if (editing && entry.category && !uniq.includes(entry.category)) uniq.push(entry.category)
    return uniq
  }, [catsList, editing, entry.category])

  const venOptions = useMemo(() => {
    const fromRules = ruleItems.map((r) => String(r.concept || '').trim()).filter(Boolean)
    const uniq = [...new Set([...vendorsList, ...fromRules])]
    uniq.sort((a, b) => a.localeCompare(b, 'es'))
    if (editing && entry.detail.trim() && !uniq.includes(entry.detail.trim())) uniq.push(entry.detail.trim())
    return uniq
  }, [vendorsList, ruleItems, editing, entry.detail])

  // Vendedor: dropdown con "+ Añadir nuevo vendedor" que se vuelve input ahí mismo.
  const vendorField = (cls: string, placeholder: string) =>
    newVenMode ? (
      <input
        value={newVen}
        onChange={(e) => setNewVen(e.target.value)}
        placeholder={placeholder}
        autoFocus
        title="Nuevo vendedor"
        className={cls}
      />
    ) : (
      <select
        value={entry.detail}
        onChange={(e) => {
          const v = e.target.value
          if (v === NEW_VEN) { setNewVenMode(true); setNewVen('') }
          else setEntry({ ...entry, detail: v })
        }}
        title="Vendedor"
        className={cls}
      >
        <option value="" disabled>— Vendedor —</option>
        {venOptions.map((v) => (<option key={v} value={v}>{v}</option>))}
        <option value={NEW_VEN}>+ Añadir nuevo vendedor</option>
      </select>
    )

  // Categoría: dropdown con "+ Añadir nueva categoría" que se vuelve input ahí mismo.
  const catField = (cls: string) =>
    newCatMode ? (
      <input
        value={newCat}
        onChange={(e) => setNewCat(e.target.value)}
        placeholder="Nueva categoría…"
        autoFocus
        title="Nueva categoría"
        className={cls}
      />
    ) : (
      <select
        value={catOptions.includes(entry.category) ? entry.category : 'Proyección'}
        onChange={(e) => {
          const v = e.target.value
          if (v === NEW_CAT) { setNewCatMode(true); setNewCat('') }
          else setEntry({ ...entry, category: v })
        }}
        title="Categoría"
        className={cls}
      >
        {catOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
        <option value={NEW_CAT}>+ Añadir nueva categoría</option>
      </select>
    )

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

  // Transacciones reales del banco principal desde hoy hasta fin de año (para la vista PROYECCIONES)
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

  // Vista BANCO: últimos 30 días de transacciones reales (ventana rodante, independiente)
  const [bancoTxs, setBancoTxs] = useState<Tx[]>([])
  useEffect(() => {
    if (!effMain) return
    let alive = true
    ;(async () => {
      const d1 = new Date(today + 'T12:00:00')
      const d0 = new Date(d1)
      d0.setDate(d0.getDate() - 29)
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const winStart = iso(d0)
      const yms = new Set<string>()
      for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
        yms.add(iso(d).slice(0, 7))
      }
      const all: Tx[] = []
      for (const ym of [...yms].sort()) {
        try {
          const r = await fetch(`/api/reconcile/data?month=${ym}`).then((x) => x.json())
          for (const t of r.transactions || []) {
            const dt = String(t.date || '')
            if (t.bank_account === effMain && dt >= winStart && dt <= today && t.entry_type !== 'proyectado') {
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
      if (alive) setBancoTxs(all)
    })()
    return () => {
      alive = false
    }
  }, [effMain, today])

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

  // Balances: siempre en vivo desde Plaid (current_balance) — sin edición manual
  const mainAcct = accounts.find((a) => a.name === effMain)
  const otherAccts = useMemo(() => accounts.filter((a) => a.name && a.name !== effMain), [accounts, effMain])
  const bankVal = (a: Acct) => Number(a.current_balance) || 0
  const mainBal = mainAcct ? bankVal(mainAcct) : 0
  const othersTotal = otherAccts.reduce((s, a) => s + bankVal(a), 0)
  const bankTotal = mainBal + othersTotal

  const winInc = projWin.reduce((s, p) => s + (Number(p.credit) || 0), 0)
  const winExp = projWin.reduce((s, p) => s + (Number(p.debit) || 0), 0)
  const winIncCount = projWin.filter((p) => Number(p.credit) > 0).length
  const winExpCount = projWin.filter((p) => Number(p.debit) > 0).length
  const grandTotal = bankTotal + winInc - winExp

  // Movimientos del registro (solo banco principal), con balance corrido cronológico
  // Si se ocultan transfers, se excluyen por categoría (las reglas proyectadas no son transfers)
  const visibleTxs = useMemo(
    () => (hideTransfers ? mainTxs.filter((t) => !isTransferCat(t.category)) : mainTxs),
    [mainTxs, hideTransfers]
  )

  const movesChrono: MoveRow[] = useMemo(() => {
    const arr = [
      ...visibleTxs.map((t) => ({
        key: `tx-${t.id}`,
        date: t.date,
        label: t.detail,
        sub: t.category,
        category: t.category || 'Otro',
        frequency: '',
        net: (Number(t.credit) || 0) - (Number(t.debit) || 0),
        ruleId: null,
      })),
      ...projWin.map((p) => ({
        key: `pj-${p.id}`,
        date: p.date,
        label: p.detail,
        sub: `Proyección · ${p.frequency || ''}`,
        category: p.category || 'Proyección',
        frequency: p.frequency || '',
        net: (Number(p.credit) || 0) - (Number(p.debit) || 0),
        ruleId: p.rule_id || null,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
    let run = bankTotal
    let runBank = bankTotal
    return arr.map((m) => {
      run += m.net
      if (m.key.startsWith('tx-')) runBank += m.net
      return { ...m, chronoBal: run, bankBal: runBank }
    })
  }, [visibleTxs, projWin, bankTotal])

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

  // Vista BANCO: solo transacciones reales de los últimos 30 días, con balance corrido (estilo statement)
  const bancoVisibleTxs = useMemo(
    () => (hideTransfers ? bancoTxs.filter((t) => !isTransferCat(t.category)) : bancoTxs),
    [bancoTxs, hideTransfers]
  )
  const bancoRows = useMemo(() => {
    const arr = [...bancoVisibleTxs].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    // balance corrido cronológico (de atrás hacia adelante) y luego se muestra más reciente arriba
    const chrono = [...bancoVisibleTxs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    const balById = new Map<string, number>()
    let run = bankTotal
    for (const t of chrono) {
      run += (Number(t.credit) || 0) - (Number(t.debit) || 0)
      balById.set(t.id, run)
    }
    return arr.map((t) => ({ ...t, bal: balById.get(t.id) ?? bankTotal }))
  }, [bancoVisibleTxs, bankTotal])

  const bancoInc = useMemo(() => bancoVisibleTxs.reduce((s, t) => s + (Number(t.credit) || 0), 0), [bancoVisibleTxs])
  const bancoExp = useMemo(() => bancoVisibleTxs.reduce((s, t) => s + (Number(t.debit) || 0), 0), [bancoVisibleTxs])

  // Ledger diario: una fila por día (hoy → 31 dic) con apertura, flujo y cierre proyectado
  const dailyRows: DailyRow[] = useMemo(() => {
    const byDate = new Map<string, { inflow: number; outflow: number }>()
    for (const m of movesChrono) {
      const e = byDate.get(m.date) || { inflow: 0, outflow: 0 }
      if (m.net >= 0) e.inflow += m.net
      else e.outflow += -m.net
      byDate.set(m.date, e)
    }
    const rows: DailyRow[] = []
    let run = bankTotal
    const d = new Date(today + 'T12:00:00')
    const end = new Date(yearEnd + 'T12:00:00')
    while (d <= end) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const e = byDate.get(iso)
      const inflow = e?.inflow || 0
      const outflow = e?.outflow || 0
      const opening = run
      run = run + inflow - outflow
      rows.push({
        date: iso,
        opening,
        inflow,
        outflow,
        net: inflow - outflow,
        closing: run,
        health: run < 0 ? 'bad' : run < safetyFloor ? 'warn' : 'ok',
      })
      d.setDate(d.getDate() + 1)
    }
    return rows
  }, [movesChrono, bankTotal, today, yearEnd, safetyFloor])

  // Punto crítico: día con el balance proyectado más bajo
  const criticalPt = useMemo(() => {
    if (dailyRows.length === 0) return null
    let m = dailyRows[0]
    for (const r of dailyRows) if (r.closing < m.closing) m = r
    return m
  }, [dailyRows])

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

      {/* Dos vistas: Banco | Proyecciones */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => pickView('banco')}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-extrabold transition ${
            view === 'banco'
              ? 'bg-[#1c3d5e] text-white shadow-md'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span className="text-base">🏦</span> Banco
        </button>
        <button
          onClick={() => pickView('proyecciones')}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-extrabold transition ${
            view === 'proyecciones'
              ? 'bg-[#1c3d5e] text-white shadow-md'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span className="text-base">🔮</span> Proyecciones
        </button>
      </div>

      {/* KPIs */}
      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={IBar} label="Ingresos proyectados" value={money(winInc)} sub={`${winIncCount} movimientos`} valueColor="text-[#16a34a]" accent="#16a34a" />
        <Kpi icon={ICart} label="Gastos proyectados" value={money(winExp)} sub={`${winExpCount} movimientos`} valueColor="text-slate-800" accent="#f59e0b" />
        <Kpi icon={IDb} label="Balance bancario" value={money(bankTotal)} sub={`${accounts.length} cuentas · a hoy`} valueColor="text-slate-800" accent="#3b82f6" />
        <Kpi icon={IPct} label="Balance total" value={money(grandTotal)} sub="Banco + proy. − proy." valueColor={grandTotal < 0 ? 'text-red-600' : 'text-[#16a34a]'} accent="#8b5cf6" />
        <Kpi
          icon={IAlert}
          label="Punto crítico"
          value={criticalPt ? money(criticalPt.closing) : '—'}
          sub={criticalPt ? `${fmtD(criticalPt.date)}${criticalPt.closing < safetyFloor ? ' · bajo mínimo' : ''}` : 'sin datos'}
          valueColor={criticalPt && criticalPt.closing < safetyFloor ? 'text-red-600' : criticalPt && criticalPt.closing < 0 ? 'text-red-600' : 'text-slate-800'}
          accent="#ef4444"
        />
      </section>

      {view === 'proyecciones' && (
      <>
      {/* Proyecciones — reglas guardadas (la entrada vive en la primera fila del Registro) */}
      <section className="mt-3">
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className={h3}>Proyecciones</h3>
              <p className="mt-0.5 text-[11px] text-slate-400">Ingresos y gastos recurrentes. Se suman a los totales de arriba.</p>
            </div>

          </div>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Inicio</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Detalle</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Categoría</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Tipo</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-medium">Monto</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Frecuencia</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Hasta cuándo</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {ruleItems.map((r) => {
                  const t = String(r.type || '').toLowerCase()
                  const isInc = t === 'ingreso' || t === 'income'
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-500">{fmtD(r.pay_day)}</td>
                      <td className="px-2 py-2 font-medium text-slate-700">{r.concept}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">{r.category || 'Proyección'}</td>
                      <td className={`whitespace-nowrap px-2 py-2 text-xs font-bold ${isInc ? 'text-[#16a34a]' : 'text-red-500'}`}>
                        {isInc ? 'INGRESO' : 'GASTO'}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums ${isInc ? 'text-[#16a34a]' : 'text-slate-800'}`}>
                        {money(r.amount)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs font-semibold text-slate-500">{freqLabel(r.frequency)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-slate-500">{r.end_date ? fmtD(r.end_date) : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        <button onClick={() => startEdit(r.id, nextOccurrence(r.id))} title="Editar proyección" className="rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:bg-blue-50 hover:text-blue-600">✎</button>
                        <button onClick={() => deleteRule(r.id)} title="Borrar proyección" className="rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:bg-red-50 hover:text-red-600">✕</button>
                      </td>
                    </tr>
                  )
                })}
                {ruleItems.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">Sin proyecciones. Entra tus ingresos y gastos en la primera fila del Registro.</td></tr>
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

      {/* UN SOLO register condensado: reales + proyectadas, marcadas diferente */}
      <section className="mt-3">
        <div className={`${card} flex flex-col`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h3 className={h3}>Registro</h3>
              <p className="text-[11px] text-slate-400">{fmtD(today)} → 31 dic {year} · reales + proyectadas</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] font-semibold text-slate-500">Banco</label>
              <select
                value={effMain}
                onChange={(e) => pickMain(e.target.value)}
                title="Banco principal para proyecciones"
                className="max-w-[180px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
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
                <option value="date-desc">Fecha ↓</option>
                <option value="date-asc">Fecha ↑</option>
                <option value="entity">Detalle A–Z</option>
                <option value="amount-desc">Monto ↓</option>
                <option value="amount-asc">Monto ↑</option>
              </select>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <input type="checkbox" checked={hideTransfers} onChange={(e) => setHideTr(e.target.checked)} className="size-3.5 rounded" />
                Ocultar transfers
              </label>
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                Mínimo $
                <input
                  type="number"
                  inputMode="decimal"
                  value={safetyFloor}
                  onChange={(e) => setFloor(Number(e.target.value))}
                  title="Balance mínimo (safety floor)"
                  className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right font-mono text-xs"
                />
              </label>
              <span className="shrink-0 rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
                {movesSorted.length} movs
              </span>
            </div>
          </div>

          {/* Móvil: formato compacto */}
          <div className="mt-2 max-h-[320px] overflow-y-auto overscroll-contain rounded-lg border border-slate-100 md:hidden">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Fecha</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Descripción</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {/* Fila de entrada: primera línea del register */}
                <tr className="border-b-2 border-[#40b9a1] bg-emerald-50/60">
                  <td colSpan={3} className="px-2 py-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} title={editing ? 'Ocurrencia que estás editando' : 'Inicio'} disabled={!!editing && editing.frequency !== 'Un solo pago'} className="rounded border border-slate-200 px-1.5 py-1.5 text-xs disabled:bg-slate-100 disabled:text-slate-400" />
                      {vendorField('rounded border border-slate-200 px-1.5 py-1.5 text-xs', 'Vendedor')}
                      {catField('rounded border border-slate-200 px-1.5 py-1.5 text-xs')}
                      <select value={entry.frequency} onChange={(e) => setEntry({ ...entry, frequency: e.target.value })} className="rounded border border-slate-200 px-1.5 py-1.5 text-xs font-semibold">
                        {FREQS.map(([v, label]) => (<option key={v} value={v}>{label}</option>))}
                      </select>
                      <input type="number" inputMode="decimal" value={entry.inc} onChange={(e) => setEntry({ ...entry, inc: e.target.value })} placeholder="Ingreso" className="rounded border border-slate-200 px-1.5 py-1.5 text-right font-mono text-xs" />
                      <input type="number" inputMode="decimal" value={entry.exp} onChange={(e) => setEntry({ ...entry, exp: e.target.value })} placeholder="Gasto" className="rounded border border-slate-200 px-1.5 py-1.5 text-right font-mono text-xs" />
                      <input type="date" value={entry.end_date} onChange={(e) => setEntry({ ...entry, end_date: e.target.value })} title="Hasta cuándo (opcional)" className="rounded border border-slate-200 px-1.5 py-1.5 text-xs text-slate-500" />
                      <div className="flex items-center justify-end gap-1.5">
                        {editing && (<span className="mr-1 rounded-full bg-[#40b9a1]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#0f766e]">Editando</span>)}
                        <button onClick={() => commitEntry()} disabled={ruleBusy} title={editing ? 'Guardar cambios' : 'Guardar proyección'} className="rounded-lg bg-[#40b9a1] px-3 py-1.5 text-xs font-bold text-[#10243f] disabled:opacity-50">✓ Guardar</button>
                        <button onClick={cancelEdit} title={editing ? 'Cancelar edición' : 'Limpiar'} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">✕</button>
                      </div>
                    </div>
                  </td>
                </tr>
                {scopeAsk && editing && (
                  <tr className="border-b border-slate-200 bg-sky-50/70">
                    <td colSpan={3} className="px-2 py-2">
                      <div className="text-xs font-extrabold text-slate-700">¿A cuáles aplica el cambio?</div>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <button onClick={() => commitEntry('solo')} disabled={ruleBusy} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Solo esta</button>
                        <button onClick={() => commitEntry('atras')} disabled={ruleBusy} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Esta y las pasadas</button>
                        <button onClick={() => commitEntry('adelante')} disabled={ruleBusy} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Esta y las futuras</button>
                        <button onClick={() => commitEntry('todas')} disabled={ruleBusy} className="rounded-lg bg-[#1c3d5e] px-2 py-2 text-xs font-bold text-white disabled:opacity-50">Todas</button>
                      </div>
                      <button onClick={() => setScopeAsk(false)} className="mt-1.5 text-xs font-semibold text-slate-400 underline">Cancelar</button>
                    </td>
                  </tr>
                )}
                {movesSorted.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">Sin movimientos — entra tu proyección en la primera fila.</td></tr>
                ) : (
                  movesSorted.map((r) => {
                    const isProj = r.key.startsWith('pj-')
                    const inc = r.net > 0 ? r.net : 0
                    const exp = r.net < 0 ? -r.net : 0
                    const health = r.chronoBal < 0 ? 'bad' : r.chronoBal < safetyFloor ? 'warn' : 'ok'
                    return (
                      <tr key={r.key} className={`border-t border-slate-100 ${isProj ? 'bg-amber-50/40' : 'even:bg-slate-50/60'}`}>
                        <td className="whitespace-nowrap px-2 py-1.5 align-top tabular-nums text-slate-500">{fmtD(r.date)}</td>
                        <td className="min-w-0 px-2 py-1.5 align-top">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className={`line-clamp-2 text-sm font-semibold leading-snug ${isProj ? 'italic text-slate-600' : 'text-slate-800'}`}>{isProj ? '🔮' : '🏦'} {r.label}</span>
                            {isProj && (
                              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wide text-amber-700">Proy</span>
                            )}
                            {isProj && r.frequency && (
                              <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-blue-600">{freqLabel(r.frequency)}</span>
                            )}
                            {isProj && r.ruleId && (
                              <button onClick={() => startEdit(r.ruleId as string, r.date)} title="Editar proyección" className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500">✎</button>
                            )}
                          </div>
                          <div className="truncate text-xs text-slate-400">{r.category}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right align-top">
                          <div className={`font-semibold tabular-nums ${inc > 0 ? 'text-[#16a34a]' : exp > 0 ? 'text-red-500' : 'text-slate-300'}`}>
                            {inc > 0 ? `+${num2(inc)}` : exp > 0 ? `−${num2(exp)}` : '—'}
                          </div>
                          <div className={`font-bold tabular-nums ${health === 'bad' ? 'text-red-600' : health === 'warn' ? 'text-amber-600' : 'text-slate-900'}`}>
                            {num2(r.chronoBal)}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Computadora: register completo */}
          <div className="mt-2 hidden max-h-[480px] overflow-auto overscroll-contain rounded-lg border border-slate-100 md:block">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="border-b border-slate-200 px-3 py-2 font-medium">Fecha</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-medium">Vendedor</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-medium">Categoría</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-medium">Frecuencia</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right font-medium">Ingreso</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right font-medium">Gasto</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right font-medium">Balance banco</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right font-medium">Balance proyectado</th>
                </tr>
              </thead>
              <tbody>
                {/* Fila de entrada: primera línea del register */}
                <tr className="border-b-2 border-[#40b9a1] bg-emerald-50/60">
                  <td className="px-2 py-2">
                    <input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} title={editing ? 'Ocurrencia que estás editando' : 'Inicio'} disabled={!!editing && editing.frequency !== 'Un solo pago'} className="w-full rounded border border-slate-200 px-1 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-400" />
                  </td>
                  <td className="px-2 py-2">
                    {vendorField('w-full rounded border border-slate-200 px-1 py-1 text-xs', 'Nuevo vendedor…')}
                  </td>
                  <td className="px-2 py-2">
                    {catField('w-full rounded border border-slate-200 px-1 py-1 text-xs')}
                  </td>
                  <td className="px-2 py-2">
                    <select value={entry.frequency} onChange={(e) => setEntry({ ...entry, frequency: e.target.value })} className="w-full rounded border border-slate-200 px-1 py-1 text-xs font-semibold">
                      {FREQS.map(([v, label]) => (<option key={v} value={v}>{label}</option>))}
                    </select>
                    <input type="date" value={entry.end_date} onChange={(e) => setEntry({ ...entry, end_date: e.target.value })} title="Hasta cuándo (opcional)" className="mt-1 w-full rounded border border-slate-200 px-1 py-1 text-xs text-slate-500" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" inputMode="decimal" value={entry.inc} onChange={(e) => setEntry({ ...entry, inc: e.target.value })} placeholder="0.00" className="w-full rounded border border-slate-200 px-1 py-1 text-right font-mono text-xs" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" inputMode="decimal" value={entry.exp} onChange={(e) => setEntry({ ...entry, exp: e.target.value })} placeholder="0.00" className="w-full rounded border border-slate-200 px-1 py-1 text-right font-mono text-xs" />
                  </td>
                  <td className="px-2 py-2 text-center text-xs text-slate-300">—</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {editing && (<span className="mr-1 rounded-full bg-[#40b9a1]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#0f766e]">Editando</span>)}
                      <button onClick={() => commitEntry()} disabled={ruleBusy} title={editing ? 'Guardar cambios' : 'Guardar proyección'} className="rounded-lg bg-[#40b9a1] px-2.5 py-1 text-xs font-bold text-[#10243f] disabled:opacity-50">✓</button>
                      <button onClick={cancelEdit} title={editing ? 'Cancelar edición' : 'Limpiar'} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">✕</button>
                    </div>
                  </td>
                </tr>
                {scopeAsk && editing && (
                    <tr className="border-b border-slate-200 bg-sky-50/70">
                      <td colSpan={8} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="mr-1 text-xs font-extrabold text-slate-700">¿A cuáles aplica el cambio?</span>
                          <button onClick={() => commitEntry('solo')} disabled={ruleBusy} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50">Solo esta</button>
                          <button onClick={() => commitEntry('atras')} disabled={ruleBusy} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50">Esta y las pasadas</button>
                          <button onClick={() => commitEntry('adelante')} disabled={ruleBusy} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50">Esta y las futuras</button>
                          <button onClick={() => commitEntry('todas')} disabled={ruleBusy} className="rounded-lg bg-[#1c3d5e] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Todas</button>
                          <button onClick={() => setScopeAsk(false)} className="text-xs font-semibold text-slate-400 underline">Cancelar</button>
                        </div>
                      </td>
                    </tr>
                  )}
                {movesSorted.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">Sin movimientos — entra tu proyección en la primera fila.</td></tr>
                ) : (
                  movesSorted.map((r) => {
                    const isProj = r.key.startsWith('pj-')
                    const inc = r.net > 0 ? r.net : 0
                    const exp = r.net < 0 ? -r.net : 0
                    const health = r.chronoBal < 0 ? 'bad' : r.chronoBal < safetyFloor ? 'warn' : 'ok'
                    return (
                      <tr key={r.key} className={`border-t border-slate-100 ${isProj ? 'bg-amber-50/40' : 'even:bg-slate-50/60'} hover:bg-blue-50/40`}>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">{fmtD(r.date)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-semibold ${isProj ? 'italic text-slate-600' : 'text-slate-800'}`}>{r.label}</span>
                            {isProj && (
                              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wide text-amber-700">Proy</span>
                            )}
                            {isProj && r.ruleId && (
                              <button onClick={() => startEdit(r.ruleId as string, r.date)} title="Editar proyección" className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500">✎</button>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">{isProj ? `🔮 ${r.sub}` : `🏦 ${r.sub}`}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{r.category}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-slate-500">{isProj ? freqLabel(r.frequency) : <span className="text-slate-300">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-[#16a34a]">
                          {inc > 0 ? `+${num2(inc)}` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-red-500">
                          {exp > 0 ? `−${num2(exp)}` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-500">{num2(r.bankBal)}</td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums ${health === 'bad' ? 'text-red-600' : health === 'warn' ? 'text-amber-600' : 'text-slate-800'}`}>
                          {num2(r.chronoBal)}
                        </td>
                      </tr>
                    )
                  })
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
      </>
      )}

      {view === 'banco' && (
      <section className="mt-3">
        <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h3 className={h3}>Banco · {mainAcct ? shortBank(mainAcct) : ''}</h3>
              <p className="text-[11px] text-slate-400">Transacciones reales · últimos 30 días</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] font-semibold text-slate-500">Banco</label>
              <select
                value={effMain}
                onChange={(e) => pickMain(e.target.value)}
                title="Banco para ver"
                className="max-w-[180px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
              >
                {accounts.map((a) => (
                  <option key={a.name} value={a.name}>{shortBank(a)}</option>
                ))}
              </select>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <input type="checkbox" checked={hideTransfers} onChange={(e) => setHideTr(e.target.checked)} className="size-3.5 rounded" />
                Ocultar transfers
              </label>
              <span className="shrink-0 rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
                {bancoRows.length} movs
              </span>
            </div>
          </div>

          {/* Móvil: formato compacto */}
          <div className="mt-2 max-h-[320px] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white md:hidden">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Fecha</th>
                  <th className="border-b border-slate-200 px-2 py-2 font-medium">Descripción</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {/* Fila de entrada: primera línea del register */}
                <tr className="border-b-2 border-[#40b9a1] bg-emerald-50/60">
                  <td colSpan={3} className="px-2 py-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} title={editing ? 'Ocurrencia que estás editando' : 'Inicio'} disabled={!!editing && editing.frequency !== 'Un solo pago'} className="rounded border border-slate-200 px-1.5 py-1.5 text-xs disabled:bg-slate-100 disabled:text-slate-400" />
                      {vendorField('rounded border border-slate-200 px-1.5 py-1.5 text-xs', 'Vendedor')}
                      {catField('rounded border border-slate-200 px-1.5 py-1.5 text-xs')}
                      <select value={entry.frequency} onChange={(e) => setEntry({ ...entry, frequency: e.target.value })} className="rounded border border-slate-200 px-1.5 py-1.5 text-xs font-semibold">
                        {FREQS.map(([v, label]) => (<option key={v} value={v}>{label}</option>))}
                      </select>
                      <input type="number" inputMode="decimal" value={entry.inc} onChange={(e) => setEntry({ ...entry, inc: e.target.value })} placeholder="Ingreso" className="rounded border border-slate-200 px-1.5 py-1.5 text-right font-mono text-xs" />
                      <input type="number" inputMode="decimal" value={entry.exp} onChange={(e) => setEntry({ ...entry, exp: e.target.value })} placeholder="Gasto" className="rounded border border-slate-200 px-1.5 py-1.5 text-right font-mono text-xs" />
                      <input type="date" value={entry.end_date} onChange={(e) => setEntry({ ...entry, end_date: e.target.value })} title="Hasta cuándo (opcional)" className="rounded border border-slate-200 px-1.5 py-1.5 text-xs text-slate-500" />
                      <div className="flex items-center justify-end gap-1.5">
                        {editing && (<span className="mr-1 rounded-full bg-[#40b9a1]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#0f766e]">Editando</span>)}
                        <button onClick={() => commitEntry()} disabled={ruleBusy} title={editing ? 'Guardar cambios' : 'Guardar proyección'} className="rounded-lg bg-[#40b9a1] px-3 py-1.5 text-xs font-bold text-[#10243f] disabled:opacity-50">✓ Guardar</button>
                        <button onClick={cancelEdit} title={editing ? 'Cancelar edición' : 'Limpiar'} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">✕</button>
                      </div>
                    </div>
                  </td>
                </tr>
                {scopeAsk && editing && (
                  <tr className="border-b border-slate-200 bg-sky-50/70">
                    <td colSpan={3} className="px-2 py-2">
                      <div className="text-xs font-extrabold text-slate-700">¿A cuáles aplica el cambio?</div>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <button onClick={() => commitEntry('solo')} disabled={ruleBusy} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Solo esta</button>
                        <button onClick={() => commitEntry('atras')} disabled={ruleBusy} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Esta y las pasadas</button>
                        <button onClick={() => commitEntry('adelante')} disabled={ruleBusy} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Esta y las futuras</button>
                        <button onClick={() => commitEntry('todas')} disabled={ruleBusy} className="rounded-lg bg-[#1c3d5e] px-2 py-2 text-xs font-bold text-white disabled:opacity-50">Todas</button>
                      </div>
                      <button onClick={() => setScopeAsk(false)} className="mt-1.5 text-xs font-semibold text-slate-400 underline">Cancelar</button>
                    </td>
                  </tr>
                )}
                {bancoRows.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">Sin transacciones reales en la ventana.</td></tr>
                ) : (
                  bancoRows.map((t) => {
                    const inc = Number(t.credit) || 0
                    const exp = Number(t.debit) || 0
                    const isInc = inc > 0
                    return (
                      <tr key={t.id} className="border-t border-slate-100 even:bg-slate-50/60">
                        <td className="whitespace-nowrap px-2 py-1.5 align-top tabular-nums text-slate-500">{fmtD(t.date)}</td>
                        <td className="min-w-0 px-2 py-1.5 align-top">
                          <div className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800">{t.detail}</div>
                          <div className="truncate text-xs text-slate-400">{t.category}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right align-top">
                          <div className={`font-semibold tabular-nums ${isInc ? 'text-[#16a34a]' : 'text-red-500'}`}>
                            {isInc ? `+${num2(inc)}` : exp > 0 ? `−${num2(exp)}` : <span className="text-slate-300">—</span>}
                          </div>
                          <div className="font-bold tabular-nums text-slate-900">{num2(t.bal)}</div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Computadora: register completo */}
          <div className="mt-2 hidden max-h-[480px] overflow-auto overscroll-contain rounded-lg border border-slate-200 bg-white md:block">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="border-b border-slate-200 px-3 py-2 font-medium">Fecha</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-medium">Vendedor</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-medium">Categoría</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right font-medium">Ingreso</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right font-medium">Gasto</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {bancoRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">Sin transacciones reales en la ventana.</td></tr>
                ) : (
                  bancoRows.map((t) => {
                    const inc = Number(t.credit) || 0
                    const exp = Number(t.debit) || 0
                    return (
                      <tr key={t.id} className="border-t border-slate-100 even:bg-slate-50/60 hover:bg-blue-50/40">
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">{fmtD(t.date)}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{t.detail}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{t.category}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-[#16a34a]">
                          {inc > 0 ? `+${num2(inc)}` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-red-500">
                          {exp > 0 ? `−${num2(exp)}` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-slate-900">{num2(t.bal)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border-t-2 border-[#3b82f6] bg-blue-50/60 px-4 py-2 text-sm">
            <span className="font-extrabold text-slate-800">Balance inicial <span className="font-mono tabular-nums">{num2(bankTotal)}</span></span>
            <span className="font-semibold text-slate-500">
              <span className="text-[#16a34a]">+{num2(bancoInc)}</span>
              {' · '}
              <span className="text-red-500">−{num2(bancoExp)}</span>
            </span>
            <span className={`font-extrabold font-mono tabular-nums ${bankTotal + bancoInc - bancoExp < 0 ? 'text-red-600' : 'text-slate-800'}`}>
              Final {money(bankTotal + bancoInc - bancoExp)}
            </span>
          </div>
        </div>
      </section>
      )}


    </div>
  )
}