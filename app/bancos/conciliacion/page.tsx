'use client'

// app/bancos/conciliacion/page.tsx — Estado Bancario (Dual Register).
// Libro Diario unificado: filas REALES + PROYECTADAS distinguibles.
// Solo lo real mueve el balance real. Reglas recurrentes generan las filas futuras.
// El register completo vive en el tab Proyecciones de la página raíz.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const FALLBACK_CATEGORIES = ['Ingresos', 'Gasolina', 'Peajes E-ZPass', 'Mantenimiento', 'Llantas', 'Seguro comercial', 'Pago del vehículo', 'Comida', 'Otro']
const FREQUENCIES = ['Un solo pago', 'Diaria', 'Semanal', 'Mensual', 'Anual']
const FALLBACK_ACCOUNTS = ['Cuenta principal']

const money = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0)

// Fila del puente de conciliación (diseño firme, sin animaciones)
function BridgeRow({ label, value, valueClass, tag }: { label: string; value: number; valueClass?: string; tag?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-50 py-2">
      <span className="min-w-0 truncate text-[13px] font-semibold text-slate-600">
        {label}
        {tag && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-slate-500">{tag}</span>}
      </span>
      <span className={`flex-none font-mono text-[14px] font-bold text-slate-800 ${valueClass || ''}`}>{money(value)}</span>
    </div>
  )
}

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fmtDate = (iso: string) => {
  const [y, m, dd] = iso.split('-').map(Number)
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { day: '2-digit', month: 'short' })
}

type Tx = {
  id: string; date: string; bank_account: string; detail: string; category: string;
  frequency: string; entry_type: string; debit: number; credit: number; daily_balance: number;
  has_receipt: boolean; receipt_url: string | null; receipt_name: string | null;
}

// Extrae lo importante del detalle: "Zelle Debit ... NAME:JULIO CABRER" -> "Zelle - Julio Cabrer"
// El texto completo siempre queda guardado en la base de datos.
function shortDetail(detail: string): string {
  if (!detail) return ''
  const d = detail.trim()
  // Zelle: saca el NAME
  const zelle = d.match(/zelle\s+(debit|credit)?\s*.*?name:([^\s].*?)(\s{2,}|$)/i)
  if (zelle) {
    const name = zelle[2].trim().replace(/\s+/g, ' ')
    const title = name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    return `Zelle - ${title}`.slice(0, 40)
  }
  if (/^zelle/i.test(d)) return d.slice(0, 40)
  // Debit card transfer: saca el nombre
  const dc = d.match(/debit card transfer (credit|debit)\s+([A-Za-z*]+(?:\s+[A-Za-z*]+){0,3})/i)
  if (dc) {
    const name = dc[2].trim().replace(/\s+/g, ' ')
    const title = name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    return title.slice(0, 40)
  }
  // Dispute / ajustes: primera parte legible
  const disp = d.match(/^(dispute[^-]*)/i)
  if (disp) {
    const title = disp[1].trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    return title.slice(0, 40)
  }
  // Por defecto: limpia y corta
  return d.replace(/\s+/g, ' ').slice(0, 40)
}

type ChatMsg = { role: 'user' | 'ai'; text: string; pending?: any[]; file?: { name: string; url: string } }

// Detecta si un detalle viene del banco (para transacciones viejas sin source)
function isFromBank(detail: string, source?: string): boolean {
  if (source === 'plaid') return true
  if (source && source !== 'manual') return true
  const d = (detail || '').toUpperCase()
  return /PAY ID|ORG ID|\bNAME:|DEBIT CARD TRANSFER|^ZELLE|DISPUTE|ACH |WIRE /.test(d)
}

export default function EstadoBancario() {
  const [lists, setLists] = useState<{ accounts: string[]; categories: string[] }>({ accounts: FALLBACK_ACCOUNTS, categories: FALLBACK_CATEGORIES })
  const [month, setMonth] = useState(() => todayISO().slice(0, 7))
  const [transactions, setTransactions] = useState<Tx[]>([])
  const [projected, setProjected] = useState<Tx[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ id: string; field: string } | null>(null)
  const [newRow, setNewRow] = useState<any>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrMsg, setOcrMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const csvRef = useRef<HTMLInputElement>(null)
  const [csvMsg, setCsvMsg] = useState('')
  const [syncMsg, setSyncMsg] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [sortNewest, setSortNewest] = useState(true)
  const [search, setSearch] = useState('')
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [acctPop, setAcctPop] = useState(false)
  // Register por cuenta: filtro + balances reales + transferencias
  const [acctFilter, setAcctFilter] = useState('all')
  const [acctMeta, setAcctMeta] = useState<{ name: string; current_balance: number | null; institution: string | null; display_order: number }[]>([])
  const [links, setLinks] = useState<any[]>([])
  const [showTransfers, setShowTransfers] = useState(false)
  const [transferCands, setTransferCands] = useState<any[]>([])
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferMsg, setTransferMsg] = useState('')
  const [analysis, setAnalysis] = useState<Record<string, string>>({})
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null)
  // Remitentes por verificar (Miguel: la AI aprende; él confirma con un toque)
  const [showSenders, setShowSenders] = useState(false)
  const [pendingSenders, setPendingSenders] = useState<any[]>([])
  const [sendersBusy, setSendersBusy] = useState(false)
  const [confirmingSender, setConfirmingSender] = useState<string | null>(null)
  // Chat lateral del asistente financiero
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const recogRef = useRef<any>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatListRef = useRef<HTMLDivElement>(null)
  const newRowRef = useRef<HTMLTableRowElement>(null)

  // Cuando se abre el formulario + Add, llevarlo a la vista (está arriba de la tabla).
  useEffect(() => {
    if (newRow && newRowRef.current) {
      newRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [newRow])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/reconcile/data?month=${month}`)
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setTransactions(j.transactions || [])
      setProjected(j.projected || [])
    } catch (e: any) {
      setOcrMsg('Error loading: ' + e.message)
    }
    setLoading(false)
    setLoadedAt(Date.now())
    fetch(`/api/reconcile/transfers?links=1&month=${month}`).then((r) => r.json()).then((j) => {
      if (!j.error) setLinks(j.links || [])
    }).catch(() => {})
  }, [month])

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  const agoText = () => {
    if (!loadedAt) return '…'
    const m = Math.max(0, Math.round((nowTick - loadedAt) / 60000))
    if (m < 1) return 'just now'
    if (m === 1) return '1 min ago'
    if (m < 60) return `${m} min ago`
    const h = Math.round(m / 60)
    return h === 1 ? '1 hr ago' : `${h} hr ago`
  }

  const ACCT_DOTS = ['#6366f1', '#10b981', '#f59e0b']

  useEffect(() => {
    load()
    fetch('/api/reconcile/lists').then((r) => r.json()).then((j) => {
      if (!j.error) {
        const acc = (j.accounts || []).map((x: any) => x.name).filter(Boolean)
        const cat = (j.categories || []).map((x: any) => x.name).filter(Boolean)
        setLists({ accounts: acc.length ? acc : FALLBACK_ACCOUNTS, categories: cat.length ? cat : FALLBACK_CATEGORIES })
        setAcctMeta((j.accounts || []).map((x: any) => ({ name: x.name, current_balance: x.current_balance ?? null, institution: x.institution || null, display_order: x.display_order ?? 100 })).filter((x: any) => x.name))
      }
    }).catch(() => {})
  }, [load])

  // Banco (institución) de la cuenta seleccionada, para mostrarlo arriba del register
  const acctInstitution = useMemo(() => {
    if (acctFilter === 'all') return null
    return acctMeta.find((a) => a.name === acctFilter)?.institution || null
  }, [acctMeta, acctFilter])

  // Etiqueta "Banco · Cuenta" para identificar cada cuenta (evita duplicar si ya lo trae)
  const acctLabel = (name: string) => {
    const inst = acctMeta.find((a) => a.name === name)?.institution
    if (!inst) return name
    const firstWord = inst.split(' ')[0].toLowerCase()
    if (name.toLowerCase().includes(firstWord)) return name
    return `${inst} · ${name}`
  }

  // Forma corta para la columna Account del Journal: solo banco + últimos 4 dígitos.
  // El nombre completo queda en background (tooltip y dropdown de edición).
  const acctShort = (name: string) => {
    const m = acctMeta.find((a) => a.name === name)
    const inst = (m?.institution || '').replace(/\s+(Online|Credit Union|Bank)$/i, '')
    const mask = (name.match(/(\d{4})\s*$/) || [])[1]
    if (!inst && !mask) return name
    return `${inst}${mask ? ` …${mask}` : ''}`.trim() || name
  }

  // Movimientos vinculados como transferencias (no cuentan como ingreso/gasto: evita duplicar)
  const linkedIds = useMemo(() => {
    const s = new Set<string>()
    for (const l of links) { s.add(String(l.from_tx)); s.add(String(l.to_tx)) }
    return s
  }, [links])

  // Filtro por cuenta (register por cuenta)
  const ftx = useMemo(() => acctFilter === 'all' ? transactions : transactions.filter((t) => t.bank_account === acctFilter), [transactions, acctFilter])
  const fproj = useMemo(() => acctFilter === 'all' ? projected : projected.filter((p: any) => (p.bank_account || 'Cuenta principal') === acctFilter), [projected, acctFilter])
  const acctNames = useMemo(() => {
    const s = new Set<string>()
    for (const t of transactions) if (t.bank_account) s.add(t.bank_account)
    const orderOf = (n: string) => acctMeta.find((a) => a.name === n)?.display_order ?? 100
    return [...s].sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b))
  }, [transactions, acctMeta])

  const totals = useMemo(() => {
    let dReal = 0, cReal = 0, gProy = 0, iProy = 0
    for (const t of ftx) {
      if (linkedIds.has(String(t.id))) continue
      // Transferencias internas y pendientes de verificación no son ingreso ni gasto
      const cat = String(t.category || '').trim().toLowerCase()
      if (cat === 'transfer' || cat === 'transferencias internas' || cat === 'por verificar') continue
      dReal += Number(t.debit) || 0; cReal += Number(t.credit) || 0
    }
    for (const p of fproj) { gProy += Number(p.debit) || 0; iProy += Number(p.credit) || 0 }
    return { dReal, cReal, gProy, iProy }
  }, [ftx, fproj, linkedIds])

  // Balance REAL: lo que el banco reporta hoy por cada cuenta (viene de Plaid en cada sync).
  const realBalance = useMemo(() => {
    const rows = acctMeta.filter((a) => acctFilter === 'all' || a.name === acctFilter)
    if (!rows.some((a) => a.current_balance != null)) return null
    return rows.reduce((s, a) => s + (Number(a.current_balance) || 0), 0)
  }, [acctMeta, acctFilter])

  // Puente de conciliación: de dónde vino / a dónde fue el dinero en el periodo (solo banco real).
  // Regla de Miguel: en el banco cada gasto se rastrea a un depósito; los transfers jamás inflan ingresos.
  const bridge = useMemo(() => {
    const isTransferCat = (c: any) => { const s = String(c || '').trim().toLowerCase(); return s === 'transfer' || s === 'transferencias internas' }
    const isPendingCat = (c: any) => String(c || '').trim().toLowerCase() === 'por verificar'
    let opening = 0, closing = 0, income = 0, expenses = 0, tIn = 0, tOut = 0, pNet = 0
    const byAcct = new Map<string, Tx[]>()
    for (const t of ftx) {
      const k = t.bank_account || 'Cuenta principal'
      if (!byAcct.has(k)) byAcct.set(k, [])
      byAcct.get(k)!.push(t)
    }
    for (const arr of byAcct.values()) {
      arr.sort((a, b) => a.date.localeCompare(b.date) || String((a as any).created_at || '').localeCompare(String((b as any).created_at || '')))
      const first = arr[0], last = arr[arr.length - 1]
      const db0 = Number(first.daily_balance), db1 = Number(last.daily_balance)
      if (Number.isFinite(db0)) opening += db0 - (Number(first.credit) || 0) + (Number(first.debit) || 0)
      if (Number.isFinite(db1)) closing += db1
      for (const t of arr) {
        const d = Number(t.debit) || 0, c = Number(t.credit) || 0
        if (linkedIds.has(String(t.id)) || isTransferCat(t.category)) { tOut += d; tIn += c; continue }
        if (isPendingCat(t.category)) { pNet += c - d; continue }
        expenses += d; income += c
      }
    }
    const residual = closing - (opening + income - expenses + tIn - tOut + pNet)
    return { opening, income, expenses, tIn, tOut, pNet, closing, residual, nAccts: byAcct.size }
  }, [ftx, linkedIds])

  async function saveEdit(id: string, field: string, value: any) {
    setEditing(null)
    await fetch('/api/reconcile/data', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, field, value }),
    })
    load()
  }

  async function delRow(id: string) {
    if (!confirm('Delete this row?')) return
    await fetch(`/api/reconcile/data?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    load()
  }

  function startAdd() {
    setNewRow({
      date: todayISO(), bank_account: lists.accounts[0] || FALLBACK_ACCOUNTS[0], detail: '', category: 'Otro',
      frequency: 'Un solo pago', debit: '', credit: '', entry_type: 'real',
    })
  }

  async function commitAdd() {
    if (!newRow) return
    // Regla aprobada: frecuencia recurrente = fila proyectada (se guarda como regla);
    // "Un solo pago" = movimiento real.
    const entry_type = newRow.frequency === 'Un solo pago' ? 'real' : 'proyectado'
    const payload = {
      ...newRow,
      debit: Number(newRow.debit) || 0,
      credit: Number(newRow.credit) || 0,
      entry_type,
    }
    await fetch('/api/reconcile/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setNewRow(null)
    load()
  }

  async function sendReceiptToOCR(f: File) {
    setOcrBusy(true)
    setOcrMsg('Reading receipt…')
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await fetch('/api/reconcile/ocr', { method: 'POST', body: fd })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      if (j.duplicate) {
        setOcrMsg('⚠️ ' + j.message)
      } else {
        setOcrMsg(`Receipt recorded: ${money(j.transaction.debit)} — ${j.transaction.detail}`)
        load()
      }
    } catch (e: any) {
      setOcrMsg('Could not read: ' + e.message)
    }
    setOcrBusy(false)
  }

  // Importa el CSV del banco: oculta números de cuenta, no duplica.
  async function sendCSVToImport(f: File) {
    setCsvMsg('Importing…')
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await fetch('/api/reconcile/import', { method: 'POST', body: fd })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      const parts = []
      if (j.imported) parts.push(`${j.imported} importados`)
      if (j.duplicates) parts.push(`${j.duplicates} duplicados omitidos`)
      if (j.skipped) parts.push(`${j.skipped} omitidos`)
      setCsvMsg(parts.length ? '✓ ' + parts.join(' · ') : 'No new transactions.')
      load()
    } catch (e: any) {
      setCsvMsg('Could not import: ' + e.message)
    }
  }

  // Solicita sincronización con el banco (Plaid). El sistema la procesa en minutos.
  async function requestSync() {
    if (syncing) return
    setSyncing(true)
    setSyncMsg('Requesting sync…')
    try {
      const r = await fetch('/api/reconcile/sync-request', { method: 'POST' })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      const id = j.id
      setSyncMsg('Syncing with the bank…')
      // Consulta el estado cada 10 segundos (máx 5 minutos)
      for (let i = 0; i < 30; i++) {
        await new Promise((res) => setTimeout(res, 10000))
        const s = await fetch(`/api/reconcile/sync-request?id=${id}`).then((x) => x.json())
        if (s.status === 'done') {
          const res2: any = s.result || {}
          setSyncMsg(`✓ Synced: ${res2.imported || 0} new · ${res2.duplicates || 0} duplicates`)
          load()
          break
        }
        if (s.status === 'error') {
          setSyncMsg('Could not sync. Try again.')
          break
        }
      }
    } catch (e: any) {
      setSyncMsg('Could not request: ' + e.message)
    }
    setSyncing(false)
  }

  // Sugiere la categoría con AI cuando termina de escribir el detalle en + Añadir.
  async function suggestCategory(detail: string) {
    if (!detail?.trim()) return
    try {
      const r = await fetch('/api/reconcile/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detail }),
      })
      const j = await r.json()
      if (j.category && j.category !== 'Otro') {
        setNewRow((nr: any) => (nr && nr.category === 'Otro' ? { ...nr, category: j.category } : nr))
      }
    } catch { /* sin AI, se queda en Otro */ }
  }

  // Pregunta al asistente financiero.
  // Si pide un PDF/reporte, la AI lo genera y descarga directamente (él especifica los meses exactos).
  async function askAI(q: string) {
    const text = q.trim()
    if (!text || chatBusy) return
    const msgs: ChatMsg[] = [...chatMsgs, { role: 'user', text }]
    setChatMsgs(msgs)
    setChatInput('')
    setChatBusy(true)
    const scrollDown = () => setTimeout(() => { const el = chatListRef.current; if (el) el.scrollTop = el.scrollHeight }, 50)
    try {
      if (/\bpdf\b|reporte|statement/i.test(text)) {
        const pdf = await import('@/lib/statement-pdf')
        const range = pdf.parseReportRange(text)
        if (!range) {
          setChatMsgs([...msgs, { role: 'ai', text: '¿De qué meses genero el PDF? Dime por ejemplo: "PDF de enero a marzo 2026" o "PDF todo el 2026".' }])
        } else {
          setChatMsgs([...msgs, { role: 'ai', text: `Generando el PDF de ${pdf.rangeLabel(range.from, range.to)}…` }])
          scrollDown()
          const yms = pdf.monthsBetween(range.from, range.to)
          const months: { ym: string; txs: any[] }[] = []
          for (const ym of yms) {
            const r = await fetch(`/api/reconcile/data?month=${ym}`)
            const j = await r.json().catch(() => null)
            months.push({ ym, txs: (j && j.transactions) || [] })
          }
          const inst: Record<string, string> = {}
          const ord: Record<string, number> = {}
          for (const a of acctMeta) { if (a.institution) inst[a.name] = a.institution; ord[a.name] = a.display_order }
          const { fname, url } = await pdf.generateStatementPDF(months, inst, range.from, range.to, ord)
          const total = months.reduce((s, m) => s + m.txs.length, 0)
          // Descarga automática + link en el mensaje por si el navegador la bloquea.
          const a = document.createElement('a')
          a.href = url
          a.download = fname
          document.body.appendChild(a)
          a.click()
          a.remove()
          setChatMsgs((prev) => [...prev, { role: 'ai', text: `PDF generado: ${fname} (${total} movimientos, ${pdf.rangeLabel(range.from, range.to)}).`, file: { name: fname, url } }])
        }
        setChatBusy(false)
        scrollDown()
        return
      }
      const r = await fetch('/api/reconcile/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, month }),
      })
      const j = await r.json()
      if (j.pending?.length) {
        setChatMsgs([...msgs, { role: 'ai', text: 'Do you approve this change?', pending: j.pending } as ChatMsg])
      } else {
        setChatMsgs([...msgs, { role: 'ai', text: j.answer || ('Error: ' + (j.error || 'no response')) }])
      }
    } catch (e: any) {
      setChatMsgs([...msgs, { role: 'ai', text: 'No pude responder: ' + e.message }])
    }
    setChatBusy(false)
    scrollDown()
  }

  // Aprueba y ejecuta un cambio propuesto.
  async function approveChange(pending: any[]) {
    setChatBusy(true)
    try {
      const r = await fetch('/api/reconcile/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposals: pending }),
      })
      const j = await r.json()
      setChatMsgs([...chatMsgs, { role: 'ai', text: j.answer || ('Error: ' + (j.error || 'no response')) }])
      load() // recarga los datos
    } catch (e: any) {
      setChatMsgs([...chatMsgs, { role: 'ai', text: 'No pude aplicar: ' + e.message }])
    }
    setChatBusy(false)
    setTimeout(() => { const el = chatListRef.current; if (el) el.scrollTop = el.scrollHeight }, 50)
  }

  /* ---------- celdas editables inline ---------- */
  const txtCell = (id: string, field: string, value: any, opts: { type?: string; right?: boolean; display?: string } = {}) => {
    const isEd = editing?.id === id && editing?.field === field
    const cls = `px-2 py-2 text-sm align-middle ${opts.right ? 'text-right font-mono' : ''}`
    if (isEd) {
      return (
        <td key={field} className={cls}>
          <input
            autoFocus
            type={opts.type || 'text'}
            defaultValue={value ?? ''}
            className="w-full rounded border border-[#40b9a1] bg-white px-1 py-0.5 text-sm"
            onBlur={(e) => saveEdit(id, field, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(null)
            }}
          />
        </td>
      )
    }
    const isDetail = field === 'detail'
    return (
      <td key={field} className={cls} onClick={() => setEditing({ id, field })}>
        <span
          className={`cursor-text rounded py-0.5 hover:bg-slate-100 ${isDetail ? 'block max-w-[150px] truncate' : ''}`}
          title={isDetail ? String(value ?? '') : undefined}
        >
          {opts.display ?? String(value ?? '')}
        </span>
      </td>
    )
  }

  const selCell = (id: string, field: string, value: string, options: string[], compact?: boolean, display?: string) => {
    const isEd = editing?.id === id && editing?.field === field
    if (isEd) {
      return (
        <td key={field} className="px-2 py-2.5 text-sm align-middle">
          <select
            autoFocus
            defaultValue={value}
            className="w-full rounded border border-[#40b9a1] bg-white px-1 py-0.5 text-sm"
            onChange={(e) => saveEdit(id, field, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null) }}
            onBlur={() => setEditing(null)}
          >
            {options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </td>
      )
    }
    if (compact) {
      return (
        <td key={field} className="px-1 py-2 text-center align-middle" onClick={() => setEditing({ id, field })}>
          <span
            title={value || 'None selected'}
            className="mx-auto block w-[46px] cursor-pointer truncate text-center text-[9px] font-medium leading-tight text-slate-600 hover:text-slate-900"
          >
            {value || '–'}
          </span>
        </td>
      )
    }
    return (
      <td key={field} className="px-2 py-2 text-sm" onClick={() => setEditing({ id, field })}>
        <span title={value} className="cursor-pointer rounded bg-slate-100 py-0.5 text-xs font-medium hover:bg-slate-200">
          {display || value} ▾
        </span>
      </td>
    )
  }

  const badge = (kind: 'real' | 'proy') =>
    kind === 'real' ? (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Actual</span>
    ) : (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Projected</span>
    )

  // Marca Personal/Business: Business -> Personal -> sin marcar
  async function cyclePb(t: Tx) {
    const cur = (t as any).pb_class as string | null
    const next = cur === 'business' ? 'personal' : cur === 'personal' ? null : 'business'
    await fetch('/api/reconcile/data', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, field: 'pb_class', value: next }),
    })
    load()
  }

  // ---- Remitentes por verificar (un toque: transferencia o pago; la AI aprende) ----
  async function loadSenders() {
    setSendersBusy(true)
    try {
      const j = await fetch(`/api/reconcile/senders?month=${month}`).then((r) => r.json())
      if (j.error) throw new Error(j.error)
      setPendingSenders(j.pending || [])
    } catch {
      setPendingSenders([])
    }
    setSendersBusy(false)
  }

  async function confirmSender(sender: string, kind: 'transfer' | 'payment') {
    setConfirmingSender(sender)
    try {
      await fetch('/api/reconcile/senders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, kind }),
      })
      setPendingSenders((ps) => ps.filter((p) => p.sender !== sender))
      load()
    } finally {
      setConfirmingSender(null)
    }
  }

  // ---- Transferencias entre cuentas propias ----
  async function findTransfers() {
    setTransferBusy(true)
    setTransferMsg('')
    try {
      const j = await fetch(`/api/reconcile/transfers?month=${month}`).then((r) => r.json())
      if (j.error) throw new Error(j.error)
      setTransferCands(j.candidates || [])
      setTransferMsg(j.candidates?.length
        ? `${j.candidates.length} possible transfer(s) found — review and approve.`
        : 'No transfer candidates found for this month.')
    } catch (e: any) {
      setTransferMsg('Could not search: ' + e.message)
    }
    setTransferBusy(false)
  }

  async function analyzeTransfer(c: any) {
    const key = `${c.from.id}>${c.to.id}`
    setAnalyzingKey(key)
    try {
      const j = await fetch('/api/reconcile/transfer-analysis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_tx: c.from.id, to_tx: c.to.id }),
      }).then((r) => r.json())
      setAnalysis((a) => ({ ...a, [key]: j.analysis || j.error || 'No analysis.' }))
    } catch {
      setAnalysis((a) => ({ ...a, [key]: 'Could not analyze.' }))
    }
    setAnalyzingKey(null)
  }

  async function approveTransfer(c: any) {
    await fetch('/api/reconcile/transfers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_tx: c.from.id, to_tx: c.to.id }),
    })
    setTransferCands((cs) => cs.filter((x) => x.from.id !== c.from.id || x.to.id !== c.to.id))
    load()
  }

  async function unlinkTransfer(id: string) {
    if (!confirm('Unlink this transfer? It will count as income/expense again.')) return
    await fetch(`/api/reconcile/transfers?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    load()
  }

  // Cadena de fondos: camina los vínculos para mostrar origen -> ... -> destino
  function trailFor(link: any) {
    const byTo = new Map(links.map((l: any) => [String(l.to_tx), l]))
    const byFrom = new Map(links.map((l: any) => [String(l.from_tx), l]))
    const chain = [link]
    let cur: any = link
    let guard = 0
    while (byTo.has(String(cur.from_tx)) && guard++ < 20) { cur = byTo.get(String(cur.from_tx)); chain.unshift(cur) }
    cur = link; guard = 0
    while (byFrom.has(String(cur.to_tx)) && guard++ < 20) { cur = byFrom.get(String(cur.to_tx)); chain.push(cur) }
    return chain
  }

  const journalRow = (t: Tx, kind: 'real' | 'proy') => {
    const tb = kind === 'real' ? trueBal.get(t.id) : null
    const pb = (t as any).pb_class as string | null
    return (
    <tr key={t.id} className={`border-t border-slate-100 ${kind === 'proy' ? 'bg-amber-50/50' : 'bg-white'}`}>
      {txtCell(t.id, 'date', t.date, { type: 'date', display: fmtDate(t.date) })}
      {selCell(t.id, 'bank_account', t.bank_account, lists.accounts, false, acctShort(t.bank_account))}
      {txtCell(t.id, 'detail', t.detail, { display: shortDetail(t.detail) })}
      {selCell(t.id, 'category', t.category, lists.categories, true)}
      {selCell(t.id, 'frequency', t.frequency, FREQUENCIES, true)}
      {txtCell(t.id, 'debit', t.debit, { type: 'number', right: true, display: Number(t.debit) ? money(Number(t.debit)) : '' })}
      {txtCell(t.id, 'credit', t.credit, { type: 'number', right: true, display: Number(t.credit) ? money(Number(t.credit)) : '' })}
      {kind === 'real' ? (
        <td className="px-2 py-2.5 text-right align-middle whitespace-nowrap font-mono text-sm font-bold">
          {tb == null
            ? <span className="text-slate-300">–</span>
            : <span className={tb < 0 ? 'text-red-600' : 'text-slate-700'}>{money(tb)}</span>}
        </td>
      ) : (
        <td className="px-2 py-2.5 align-middle"></td>
      )}
      <td className="px-2 py-2.5 text-right align-middle whitespace-nowrap">
        <button
          title={pb === 'business' ? 'Business — tap to change' : pb === 'personal' ? 'Personal — tap to change' : 'Set Personal / Business'}
          onClick={() => cyclePb(t)}
          className={`mr-1 inline-grid size-4 place-items-center rounded-full text-[8px] font-bold ${pb === 'business' ? 'bg-blue-600 text-white' : pb === 'personal' ? 'bg-violet-500 text-white' : 'bg-slate-200 text-slate-400'}`}
        >{pb === 'business' ? 'B' : pb === 'personal' ? 'P' : '·'}</button>
        <span title={t.reconciled ? 'Reconciled' : isFromBank(t.detail, t.source) ? 'From bank' : 'Manual/Scanned'} className={`mr-1 inline-grid size-4 place-items-center rounded-full ${t.reconciled ? 'bg-emerald-500' : isFromBank(t.detail, t.source) ? 'bg-blue-500' : 'bg-amber-400'}`}>
          {t.reconciled ? <span className="text-[8px] text-white">✓</span> : null}
        </span>
        <button onClick={() => delRow(t.id)} className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500" aria-label="Delete">×</button>
      </td>
    </tr>
    )
  }

  // Balances por cuenta (solo las que tienen balance distinto de cero), en el orden que Miguel definió
  const accountBalances = useMemo(() => {
    return acctMeta
      .filter((a) => a.current_balance != null && Number(a.current_balance) !== 0)
      .map((a) => [a.name, { balance: Number(a.current_balance) }] as [string, { balance: number }])
  }, [acctMeta])

  const allRows = useMemo(() => {
    const r = ftx.map((t) => ({ ...t, _kind: 'real' as const }))
    const p = fproj.map((t) => ({ ...t, _kind: 'proy' as const }))
    const s = [...r, ...p].sort((a, b) => a.date.localeCompare(b.date))
    const ordered = sortNewest ? s.reverse() : s
    const q = search.trim().toLowerCase()
    if (!q) return ordered
    return ordered.filter((t) => {
      const inText = [t.detail, t.bank_account, t.category, t.vendor].filter(Boolean).join(' ').toLowerCase().includes(q)
      const inAmount = String(t.debit || '').includes(q) || String(t.credit || '').includes(q)
      return inText || inAmount
    })
  }, [ftx, fproj, sortNewest, search])

  // Balance real por fila: se reconstruye caminando hacia atrás desde el balance
  // actual que reporta el banco para cada cuenta (como un estado bancario de verdad).
  const trueBal = useMemo(() => {
    const m = new Map<string, number | null>()
    const curByAcct = new Map<string, number>()
    for (const a of acctMeta) if (a.current_balance != null) curByAcct.set(a.name, Number(a.current_balance))
    const byAcct = new Map<string, Tx[]>()
    for (const t of transactions) {
      if (t.entry_type !== 'real') continue
      const k = t.bank_account || 'Cuenta principal'
      if (!byAcct.has(k)) byAcct.set(k, [])
      byAcct.get(k)!.push(t)
    }
    for (const [acct, arr] of byAcct) {
      arr.sort((a, b) => a.date.localeCompare(b.date) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
      const cur = curByAcct.get(acct)
      if (cur == null) { arr.forEach((t) => m.set(t.id, null)); continue }
      let b = cur
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = arr[i]
        m.set(t.id, b)
        b -= (Number(t.credit) || 0) - (Number(t.debit) || 0)
      }
    }
    return m
  }, [transactions, acctMeta])

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#17263d]" translate="no">
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Encabezado */}
        <div className="mb-1 text-xs text-slate-400">
          <Link href="/" className="hover:underline">Banks & Accounts</Link>
          <span className="mx-1">›</span>
          <span className="font-semibold text-slate-600">Bank Statement</span>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold text-[#0f172a]">Bank Statement</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10b981] opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-[#10b981]" />
              </span>
              <p className="text-[13px] text-[#64748b]">
                {acctFilter === 'all'
                  ? `Summary of ${accountBalances.length} ${accountBalances.length === 1 ? 'account' : 'accounts'}`
                  : <>{acctInstitution && <span className="font-bold text-[#10243f]">{acctInstitution} — </span>}{acctFilter}</>}
                {' '}• Today
              </p>
              <span className="rounded-full border border-[#e2e8f0] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#64748b]">LIVE • Updated {agoText()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChatOpen((v) => !v)}
              className={`rounded-xl px-3 py-2 text-sm font-bold ${chatOpen ? 'bg-[#40b9a1] text-[#10243f]' : 'bg-[#10243f] text-white'}`}
            >
              💬 Ask
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* KPIs — 4 banners fijos de 88px */}
        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
          <div className="relative h-[88px] max-h-[88px] min-h-[88px] overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-[10px_12px]">
            <span className="absolute right-3 top-[10px] grid size-[26px] place-items-center rounded-full bg-[#eef2ff] text-[#6366f1]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>
            </span>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">Real balance</p>
            <p className={`mt-[2px] whitespace-nowrap font-mono text-[20px] font-bold leading-[1.1] ${realBalance != null && realBalance < 0 ? 'text-[#be123c]' : 'text-[#0f172a]'}`}>{realBalance == null ? '—' : money(realBalance)}</p>
          </div>
          <div className="relative h-[88px] max-h-[88px] min-h-[88px] overflow-hidden rounded-2xl border border-[#bbf7d0] bg-gradient-to-br from-[#f0fdf4] to-[#ecfdf5] p-[10px_12px]">
            <span className="absolute right-3 top-[10px] grid size-[26px] place-items-center rounded-full bg-[#dcfce7] text-[#16a34a]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </span>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#16a34a]">Real income</p>
            <p className="mt-[2px] whitespace-nowrap font-mono text-[20px] font-bold leading-[1.1] text-[#065f46]">{money(totals.cReal)}</p>
          </div>
          <div className="relative h-[88px] max-h-[88px] min-h-[88px] overflow-hidden rounded-2xl border border-[#fecdd3] bg-gradient-to-br from-[#fef2f2] to-[#fff1f2] p-[10px_12px]">
            <span className="absolute right-3 top-[10px] grid size-[26px] place-items-center rounded-full bg-[#fee2e2] text-[#e11d48]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
            </span>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#e11d48]">Real expenses</p>
            <p className="mt-[2px] whitespace-nowrap font-mono text-[20px] font-bold leading-[1.1] text-[#be123c]">{money(totals.dReal)}</p>
          </div>
          <div className="relative">
            <div className="h-[88px] max-h-[88px] min-h-[88px] overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-[10px_12px]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">Accounts</p>
              <div className="mt-[2px] h-[36px] overflow-y-auto pr-1">
                {accountBalances.length === 0 && <p className="text-[11px] text-slate-400">No balances</p>}
                {accountBalances.slice(0, 3).map(([acct, v], i) => (
                  <div key={acct} className="mb-1 flex h-[18px] items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="size-2 flex-none rounded-full" style={{ backgroundColor: ACCT_DOTS[i % 3] }} />
                      <span className="truncate text-[11px] font-semibold text-slate-600">{acctLabel(acct)}</span>
                    </span>
                    <span className={`flex-none font-mono text-[12px] font-bold ${v.balance < 0 ? 'text-[#be123c]' : 'text-[#0f172a]'}`}>{money(v.balance)}</span>
                  </div>
                ))}
              </div>
              {accountBalances.length > 3 && (
                <button onClick={() => setAcctPop((v) => !v)} className="mt-[2px] text-[10px] font-bold text-[#6366f1] hover:underline">
                  +{accountBalances.length - 3} more
                </button>
              )}
            </div>
            {acctPop && accountBalances.length > 3 && (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 rounded-xl border border-[#e2e8f0] bg-white p-2 shadow-lg">
                {accountBalances.slice(3).map(([acct, v], i) => (
                  <div key={acct} className="flex h-[18px] items-center justify-between gap-2 px-1 py-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="size-2 flex-none rounded-full" style={{ backgroundColor: ACCT_DOTS[(i + 3) % 3] }} />
                      <span className="truncate text-[11px] font-semibold text-slate-600">{acctLabel(acct)}</span>
                    </span>
                    <span className={`flex-none font-mono text-[12px] font-bold ${v.balance < 0 ? 'text-[#be123c]' : 'text-[#0f172a]'}`}>{money(v.balance)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Conciliación: de dónde vino / a dónde fue el dinero */}
        <div className="mb-3 overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-[17px] font-bold text-[#10243f]">Conciliación</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {new Date(month + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              {' · '}{acctFilter === 'all' ? `All accounts (${bridge.nAccts})` : acctLabel(acctFilter)}
              {' — cada gasto rastreado a su depósito'}
            </p>
          </div>
          <div className="px-4 py-1.5">
            <BridgeRow label="Balance inicial" value={bridge.opening} />
            <BridgeRow label="+ Ingresos reales" value={bridge.income} valueClass="text-[#065f46]" />
            <BridgeRow label="+ Transferencias recibidas" value={bridge.tIn} tag="transfer" />
            <BridgeRow label="− Gastos reales" value={bridge.expenses} valueClass="text-[#be123c]" />
            <BridgeRow label="− Transferencias enviadas" value={bridge.tOut} tag="transfer" />
            {Math.abs(bridge.pNet) >= 0.005 && (
              <BridgeRow label="± Por verificar (neto)" value={bridge.pNet} valueClass="text-[#b45309]" />
            )}
            <div className="flex items-center justify-between gap-3 border-t-2 border-[#10243f]/10 py-2.5">
              <span className="text-[13px] font-bold text-[#10243f]">= Balance final</span>
              <span className="flex-none font-mono text-[15px] font-bold text-[#10243f]">{money(bridge.closing)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 py-2">
              <span className="text-[12px] font-semibold text-slate-500">Diferencia por conciliar</span>
              <span className={`flex-none font-mono text-[13px] font-bold ${Math.abs(bridge.residual) < 0.01 ? 'text-[#16a34a]' : 'text-[#b45309]'}`}>{money(bridge.residual)}</span>
            </div>
          </div>
        </div>

        {/* Libro Diario */}
        <div className="mb-5 overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#10243f]/10 bg-slate-50/60 px-4 py-3">
            <h2 className="text-[17px] font-bold text-[#10243f]">Journal</h2>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Search…"
                className="w-32 rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-[#40b9a1] sm:w-44"
              />
              <button onClick={() => setSortNewest((v) => !v)} title={sortNewest ? 'See oldest first' : 'See newest first'} className="rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200">
                {sortNewest ? '↓ Newest' : '↑ Oldest'}
              </button>
              <button
                onClick={() => setShowTransfers((v) => !v)}
                title="Match bank-to-bank transfers"
                className={`rounded-xl px-3 py-1.5 text-sm font-bold ${showTransfers ? 'bg-[#10243f] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                🔗 Transfers{links.length ? ` (${links.length})` : ''}
              </button>
              <button
                onClick={() => { setShowSenders((v) => !v); if (!showSenders) loadSenders() }}
                title="Zelles pendientes de verificación"
                className={`rounded-xl px-3 py-1.5 text-sm font-bold ${showSenders ? 'bg-[#10243f] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                ✓ Zelles
              </button>
              <button
                onClick={startAdd}
                className="rounded-xl bg-[#40b9a1] px-3 py-1.5 text-sm font-bold text-[#10243f] hover:bg-[#35a48f]"
              >
                + Add
              </button>
            </div>
          </div>
          {/* Register por cuenta */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Account</span>
            {['all', ...acctNames].map((n) => (
              <button
                key={n}
                onClick={() => setAcctFilter(n)}
                title={n === 'all' ? 'All accounts' : (acctMeta.find((a) => a.name === n)?.institution || n)}
                className={`max-w-[160px] truncate rounded-full px-2.5 py-1 text-[11px] font-bold ${acctFilter === n ? 'bg-[#10243f] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {n === 'all' ? 'All accounts' : acctLabel(n)}
              </button>
            ))}
          </div>
          {/* Transferencias entre cuentas propias */}
          {showTransfers && (
            <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-[#10243f]">Bank-to-bank transfers</h3>
                  <p className="text-[11px] text-slate-500">Matched transfers don't count as income or expenses — no double counting.</p>
                </div>
                <button
                  onClick={findTransfers}
                  disabled={transferBusy}
                  className="rounded-xl bg-[#10243f] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1c3557] disabled:opacity-50"
                >
                  {transferBusy ? 'Searching…' : '🔍 Find transfers'}
                </button>
              </div>
              {transferMsg && <p className="mb-2 text-xs text-slate-500">{transferMsg}</p>}
              {links.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Matched ({links.length})</p>
                  {links.map((l) => {
                    const chain = trailFor(l)
                    return (
                      <div key={l.id} className="mb-1.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 text-xs">
                            <span className="font-bold text-slate-700">{l.from ? `${fmtDate(l.from.date)} · ${l.from.bank_account}` : '?'} <span className="font-mono text-red-600">−{money(l.from?.debit)}</span></span>
                            <span className="mx-1.5 text-slate-400">→</span>
                            <span className="font-bold text-slate-700">{l.to ? `${fmtDate(l.to.date)} · ${l.to.bank_account}` : '?'} <span className="font-mono text-emerald-600">+{money(l.to?.credit)}</span></span>
                          </div>
                          <button onClick={() => unlinkTransfer(l.id)} title="Unlink" className="rounded-lg bg-white px-2 py-0.5 text-[11px] font-bold text-slate-400 hover:text-red-500">Unlink</button>
                        </div>
                        {chain.length > 1 && (
                          <p className="mt-1 text-[11px] text-slate-500">Trail: {chain.map((c: any) => c.from?.bank_account).concat([chain[chain.length - 1].to?.bank_account]).filter(Boolean).join(' → ')}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {transferCands.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Candidates — review & approve</p>
                  {transferCands.map((c) => {
                    const key = `${c.from.id}>${c.to.id}`
                    return (
                      <div key={key} className="mb-1.5 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 text-xs">
                            <span className="font-semibold text-slate-700">{fmtDate(c.from.date)} · {c.from.bank_account} <span className="font-mono text-red-600">−{money(c.from.debit)}</span> <span className="text-slate-400">“{c.from.detail}”</span></span>
                            <span className="mx-1.5 text-slate-400">→</span>
                            <span className="font-semibold text-slate-700">{fmtDate(c.to.date)} · {c.to.bank_account} <span className="font-mono text-emerald-600">+{money(c.to.credit)}</span> <span className="text-slate-400">“{c.to.detail}”</span></span>
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => analyzeTransfer(c)} disabled={analyzingKey === key} className="rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-[#6366f1] hover:bg-indigo-50 disabled:opacity-50">
                              {analyzingKey === key ? 'Analyzing…' : '🤖 Analyze'}
                            </button>
                            <button onClick={() => approveTransfer(c)} className="rounded-lg bg-[#40b9a1] px-2 py-1 text-[11px] font-bold text-[#10243f]">Approve</button>
                            <button onClick={() => setTransferCands((cs) => cs.filter((x) => `${x.from.id}>${x.to.id}` !== key))} className="rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-400 hover:text-red-500">Dismiss</button>
                          </div>
                        </div>
                        {analysis[key] && <p className="mt-1.5 whitespace-pre-line text-[11px] leading-snug text-slate-600">{analysis[key]}</p>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {/* Remitentes por verificar: un toque por remitente, la AI aprende */}
          {showSenders && (
            <div className="border-b border-slate-100 bg-amber-50/50 px-4 py-3">
              <div className="mb-2">
                <h3 className="text-sm font-bold text-[#10243f]">Zelles por verificar</h3>
                <p className="text-[11px] text-slate-500">Confirma si el remitente es cuenta propia (transferencia) o un pago. Tu respuesta se guarda y la próxima vez se clasifica solo.</p>
              </div>
              {sendersBusy && <p className="text-xs text-slate-500">Loading…</p>}
              {!sendersBusy && pendingSenders.length === 0 && (
                <p className="text-xs text-slate-500">No hay remitentes pendientes este mes. ✓</p>
              )}
              {pendingSenders.map((p) => (
                <div key={p.sender} className="mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2">
                  <div className="min-w-0 text-xs">
                    <span className="font-bold text-slate-700">{p.sender}</span>
                    <span className="ml-2 text-slate-500">{p.n} movimiento{p.n === 1 ? '' : 's'} · {p.total < 0 ? '−' : '+'}{money(Math.abs(p.total))}</span>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => confirmSender(p.sender, 'transfer')}
                      disabled={confirmingSender === p.sender}
                      className="rounded-lg bg-[#10243f] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#1c3557] disabled:opacity-50"
                    >{confirmingSender === p.sender ? '…' : '🔁 Transferencia'}</button>
                    <button
                      onClick={() => confirmSender(p.sender, 'payment')}
                      disabled={confirmingSender === p.sender}
                      className="rounded-lg bg-[#40b9a1] px-2.5 py-1 text-[11px] font-bold text-[#10243f] hover:bg-[#35a48f] disabled:opacity-50"
                    >{confirmingSender === p.sender ? '…' : '💵 Es pago'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="w-[74px] px-2 py-2.5 font-semibold text-left align-middle">Date</th>
                  <th className="w-[100px] px-2 py-2.5 font-semibold text-left align-middle">Account</th>
                  <th className="w-[150px] px-2 py-2.5 font-semibold text-left align-middle">Detail</th>
                  <th className="w-[56px] px-1 py-2.5 font-semibold text-center align-middle" title="Category">Cat.</th>
                  <th className="w-[56px] px-1 py-2.5 font-semibold text-center align-middle" title="Frequency">Freq.</th>
                  <th className="w-[80px] px-2 py-2.5 text-right font-semibold align-middle">Debit</th>
                  <th className="w-[80px] px-2 py-2.5 text-right font-semibold align-middle">Credit</th>
                  <th className="w-[86px] px-2 py-2.5 text-right font-semibold align-middle">Balance</th>
                  <th className="w-[56px] px-2 py-2.5 align-middle"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
                ) : (
                  <>
                    {newRow && (
                      <tr ref={newRowRef} className="border-t-2 border-[#40b9a1] bg-emerald-50/60">
                        <td className="px-2 py-2">
                          <input type="date" value={newRow.date} onChange={(e) => setNewRow({ ...newRow, date: e.target.value })} className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm" />
                        </td>
                        <td className="px-2 py-2">
                          <select value={newRow.bank_account} onChange={(e) => setNewRow({ ...newRow, bank_account: e.target.value })} className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm">
                            {lists.accounts.map((o) => <option key={o}>{o}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input value={newRow.detail} onChange={(e) => setNewRow({ ...newRow, detail: e.target.value })} onBlur={(e) => suggestCategory(e.target.value)} placeholder="Detail…" className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm" />
                        </td>
                        <td className="px-2 py-2">
                          <select value={newRow.category} onChange={(e) => setNewRow({ ...newRow, category: e.target.value })} className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm">
                            {lists.categories.map((o) => <option key={o}>{o}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select value={newRow.frequency} onChange={(e) => setNewRow({ ...newRow, frequency: e.target.value })} className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm">
                            {FREQUENCIES.map((o) => <option key={o}>{o}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" inputMode="decimal" value={newRow.debit} onChange={(e) => setNewRow({ ...newRow, debit: e.target.value })} placeholder="0.00" className="w-full rounded border border-slate-200 px-1 py-0.5 text-right font-mono text-sm" />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" inputMode="decimal" value={newRow.credit} onChange={(e) => setNewRow({ ...newRow, credit: e.target.value })} placeholder="0.00" className="w-full rounded border border-slate-200 px-1 py-0.5 text-right font-mono text-sm" />
                        </td>
                        <td className="px-2 py-2"></td>
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {badge(newRow.frequency === 'Un solo pago' ? 'real' : 'proy')}
                            <button onClick={commitAdd} className="rounded-lg bg-[#40b9a1] px-2 py-1 text-xs font-bold text-[#10243f]">✓</button>
                            <button onClick={() => setNewRow(null)} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">✕</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {allRows.map((t) => journalRow(t, t._kind))}
                    {!allRows.length && !newRow && (
                      <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-400">No transactions this month. Tap <b>+ Add</b> to create the first one.</td></tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            Tap any cell to edit — everything saves automatically. Only <b>Actual</b> movements change the real balance.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Comprobantes OCR */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-1 font-bold">Receipts</h2>
            <p className="mb-3 text-xs text-slate-400">Snap a photo of the receipt: it is read automatically and creates the expense with the receipt attached.</p>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) sendReceiptToOCR(f); e.target.value = '' }} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={ocrBusy}
              className="w-full rounded-xl border-2 border-dashed border-slate-200 py-6 text-sm font-semibold text-slate-500 hover:border-[#40b9a1] hover:text-[#0f8a73] disabled:opacity-50"
            >
              {ocrBusy ? 'Reading…' : '📷 Scan receipt'}
            </button>
            {ocrMsg && <p className="mt-2 text-xs text-slate-500">{ocrMsg}</p>}
          </div>

          {/* Importar CSV del banco */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-1 font-bold">Synced bank</h2>
            <p className="mb-3 text-xs text-slate-400">Your transactions come in automatically every morning. Tap to sync now.</p>
            <button
              onClick={requestSync}
              disabled={syncing}
              className="mb-4 w-full rounded-xl bg-[#40b9a1] py-3 text-sm font-bold text-[#10243f] disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : '🔄 Sync bank now'}
            </button>

            {syncMsg && <p className="mb-3 text-xs text-slate-500">{syncMsg}</p>}
            <h2 className="mb-1 font-bold">Import from bank</h2>
            <p className="mb-3 text-xs text-slate-400">Upload the CSV you download from your bank. Account numbers are hidden: only date, detail and amounts come in. It will not duplicate what is already there.</p>
            <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) sendCSVToImport(f); e.target.value = '' }} />
            <button
              onClick={() => csvRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-slate-200 py-6 text-sm font-semibold text-slate-500 hover:border-[#40b9a1] hover:text-[#0f8a73]"
            >
              📤 Upload bank CSV
            </button>
            {csvMsg && <p className="mt-2 text-xs text-slate-500">{csvMsg}</p>}
          </div>

          {/* Proyecciones y recurrentes */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-1 font-bold">Projections & recurring</h2>
            <p className="mb-3 text-xs text-slate-400">The journal <span className="font-bold text-amber-600">Projected</span> rows come from these rules.</p>
            {projected.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No projections this month.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {projected.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium">{p.detail}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(p.date)} · {p.frequency}</p>
                    </div>
                    <p className={`font-mono font-bold ${Number(p.credit) ? 'text-emerald-600' : 'text-red-600'}`}>
                      {Number(p.credit) ? '+' : '−'}{money(Number(p.credit) || Number(p.debit))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-400">To schedule something (e.g. $400 daily until end of month): <b>+ Add</b> → Frec. → <b>Diaria</b>.</p>
          </div>
        </div>

        {/* ===== Full Register: fullscreen overlay on this same page ===== */}
          </div>
        </div>
        {chatOpen && (
          <aside className="fixed inset-x-0 bottom-0 z-40 flex h-[70vh] max-h-[70dvh] flex-col overflow-x-clip overscroll-contain rounded-t-3xl border-t-2 border-slate-200 bg-white shadow-2xl lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:max-h-none lg:w-[370px] lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h3 className="font-bold">Financial assistant</h3>
                <p className="text-[11px] text-slate-400">Ask about your numbers</p>
              </div>
              <button onClick={() => setChatOpen(false)} className="rounded-lg bg-slate-100 px-2 py-1 text-sm font-bold text-slate-500" aria-label="Close chat">✕</button>
            </div>
            <div ref={chatListRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain px-4 py-3">
              {chatMsgs.length === 0 ? (
                <div>
                  <p className="mb-2 text-sm text-slate-500">How can I help? Try:</p>
                  {['How much did I spend on gas this month?', 'What is my real balance?', 'Summarize my expenses by category'].map((s) => (
                    <button key={s} onClick={() => askAI(s)} className="mb-2 block w-full rounded-xl bg-slate-50 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100">
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                chatMsgs.map((m, i) => (
                  <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : ''}`}>
                    <div className={`inline-block max-w-[90%] break-words rounded-2xl px-3 py-2 text-sm whitespace-pre-line [overflow-wrap:anywhere] text-left ${m.role === 'user' ? 'bg-[#10243f] text-white' : 'bg-slate-100 text-slate-700'}`}>
                      {m.text}
                      {m.file && (
                        <div className="mt-2">
                          <a
                            href={m.file.url}
                            download={m.file.name}
                            className="inline-block rounded-lg bg-[#10243f] px-3 py-1.5 text-xs font-bold text-white"
                          >
                            📄 Descargar {m.file.name}
                          </a>
                        </div>
                      )}
                      {m.pending?.length > 0 && (
                        <div className="mt-2 border-t border-slate-200 pt-2">
                          {m.pending.map((p: any, j: number) => (
                            <p key={j} className="text-xs font-semibold text-slate-600">• {p.desc}</p>
                          ))}
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => { approveChange(m.pending!); setChatMsgs(chatMsgs.filter((_, k) => k !== i)) }}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
                            >
                              ✅ Approve
                            </button>
                            <button
                              onClick={() => setChatMsgs(chatMsgs.filter((_, k) => k !== i))}
                              className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {chatBusy && <p className="text-xs text-slate-400">Thinking…</p>}
              <div ref={chatEndRef} />
            </div>
            <div className="shrink-0 border-t border-slate-100 bg-white p-3">
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') askAI(chatInput) }}
                  placeholder="Finance question… or 'PDF de enero a marzo'"
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-[16px]"
                />
                {typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) && (
                  <button
                    onClick={() => {
                      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
                      if (listening) { recogRef.current?.stop(); return }
                      const r = new SR()
                      r.lang = 'es-ES'
                      r.interimResults = false
                      r.maxAlternatives = 1
                      r.onresult = (e: any) => {
                        const t = e.results[0][0].transcript as string
                        setChatInput((prev) => (prev ? prev + ' ' : '') + t)
                      }
                      r.onend = () => setListening(false)
                      r.onerror = () => setListening(false)
                      recogRef.current = r
                      setListening(true)
                      try { r.start() } catch { setListening(false) }
                    }}
                    className={`rounded-xl px-3 py-2 text-sm font-bold ${listening ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600'}`}
                    aria-label={listening ? 'Detener dictado' : 'Dictar por voz'}
                    title="Dictar por voz"
                  >
                    {listening ? '⏹' : '🎤'}
                  </button>
                )}
                <button onClick={() => askAI(chatInput)} disabled={chatBusy} className="rounded-xl bg-[#40b9a1] px-4 py-2 text-sm font-bold text-[#10243f] disabled:opacity-50" aria-label="Send">
                  ➤
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}