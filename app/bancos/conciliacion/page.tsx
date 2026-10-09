'use client'

// app/bancos/conciliacion/page.tsx — Estado Bancario (Dual Register).
// Libro Diario unificado: filas REALES + PROYECTADAS distinguibles.
// Solo lo real mueve el balance real. Reglas recurrentes generan las filas futuras.
// "Ver registro completo" abre el mes entero en pantalla completa (overlay, misma página).

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const FALLBACK_CATEGORIES = ['Ingresos', 'Gasolina', 'Peajes E-ZPass', 'Mantenimiento', 'Llantas', 'Seguro comercial', 'Pago del vehículo', 'Comida', 'Otro']
const FREQUENCIES = ['Un solo pago', 'Diaria', 'Semanal', 'Mensual', 'Anual']
const FALLBACK_ACCOUNTS = ['Cuenta principal']

const money = (v: number) =>
  new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' }).format(v || 0)

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fmtDate = (iso: string) => {
  const [y, m, dd] = iso.split('-').map(Number)
  return new Date(y, m - 1, dd).toLocaleDateString('es-US', { day: '2-digit', month: 'short' })
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

type ChatMsg = { role: 'user' | 'ai'; text: string; pending?: any[] }

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
  const [showFull, setShowFull] = useState(false)
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
  // Chat lateral del asistente financiero
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/reconcile/data?month=${month}`)
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setTransactions(j.transactions || [])
      setProjected(j.projected || [])
    } catch (e: any) {
      setOcrMsg('Error cargando: ' + e.message)
    }
    setLoading(false)
  }, [month])

  useEffect(() => {
    load()
    fetch('/api/reconcile/lists').then((r) => r.json()).then((j) => {
      if (!j.error) {
        const acc = (j.accounts || []).map((x: any) => x.name).filter(Boolean)
        const cat = (j.categories || []).map((x: any) => x.name).filter(Boolean)
        setLists({ accounts: acc.length ? acc : FALLBACK_ACCOUNTS, categories: cat.length ? cat : FALLBACK_CATEGORIES })
      }
    }).catch(() => {})
  }, [load])

  const totals = useMemo(() => {
    let dReal = 0, cReal = 0, gProy = 0, iProy = 0
    for (const t of transactions) { dReal += Number(t.debit) || 0; cReal += Number(t.credit) || 0 }
    for (const p of projected) { gProy += Number(p.debit) || 0; iProy += Number(p.credit) || 0 }
    return { dReal, cReal, gProy, iProy }
  }, [transactions, projected])

  const realBalance = useMemo(() => {
    let b = 0
    for (const t of transactions) b += (Number(t.credit) || 0) - (Number(t.debit) || 0)
    return b
  }, [transactions])

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
    if (!confirm('¿Borrar esta fila?')) return
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
    setOcrMsg('Leyendo comprobante…')
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await fetch('/api/reconcile/ocr', { method: 'POST', body: fd })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      if (j.duplicate) {
        setOcrMsg('⚠️ ' + j.message)
      } else {
        setOcrMsg(`Comprobante registrado: ${money(j.transaction.debit)} — ${j.transaction.detail}`)
        load()
      }
    } catch (e: any) {
      setOcrMsg('No se pudo leer: ' + e.message)
    }
    setOcrBusy(false)
  }

  // Importa el CSV del banco: oculta números de cuenta, no duplica.
  async function sendCSVToImport(f: File) {
    setCsvMsg('Importando…')
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
      setCsvMsg(parts.length ? '✓ ' + parts.join(' · ') : 'Sin movimientos nuevos.')
      load()
    } catch (e: any) {
      setCsvMsg('No se pudo importar: ' + e.message)
    }
  }

  // Solicita sincronización con el banco (Plaid). El sistema la procesa en minutos.
  async function requestSync() {
    if (syncing) return
    setSyncing(true)
    setSyncMsg('Solicitando sincronización…')
    try {
      const r = await fetch('/api/reconcile/sync-request', { method: 'POST' })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      const id = j.id
      setSyncMsg('Sincronizando con el banco…')
      // Consulta el estado cada 10 segundos (máx 5 minutos)
      for (let i = 0; i < 30; i++) {
        await new Promise((res) => setTimeout(res, 10000))
        const s = await fetch(`/api/reconcile/sync-request?id=${id}`).then((x) => x.json())
        if (s.status === 'done') {
          const res2: any = s.result || {}
          setSyncMsg(`✓ Sincronizado: ${res2.imported || 0} nuevos · ${res2.duplicates || 0} duplicados`)
          load()
          break
        }
        if (s.status === 'error') {
          setSyncMsg('No se pudo sincronizar. Intenta de nuevo.')
          break
        }
      }
    } catch (e: any) {
      setSyncMsg('No se pudo solicitar: ' + e.message)
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
  async function askAI(q: string) {
    const text = q.trim()
    if (!text || chatBusy) return
    const msgs: ChatMsg[] = [...chatMsgs, { role: 'user', text }]
    setChatMsgs(msgs)
    setChatInput('')
    setChatBusy(true)
    try {
      const r = await fetch('/api/reconcile/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, month }),
      })
      const j = await r.json()
      if (j.pending?.length) {
        setChatMsgs([...msgs, { role: 'ai', text: '¿Apruebas este cambio?', pending: j.pending } as ChatMsg])
      } else {
        setChatMsgs([...msgs, { role: 'ai', text: j.answer || ('Error: ' + (j.error || 'sin respuesta')) }])
      }
    } catch (e: any) {
      setChatMsgs([...msgs, { role: 'ai', text: 'No pude responder: ' + e.message }])
    }
    setChatBusy(false)
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
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
      setChatMsgs([...chatMsgs, { role: 'ai', text: j.answer || ('Error: ' + (j.error || 'sin respuesta')) }])
      load() // recarga los datos
    } catch (e: any) {
      setChatMsgs([...chatMsgs, { role: 'ai', text: 'No pude aplicar: ' + e.message }])
    }
    setChatBusy(false)
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
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
          className={`cursor-text rounded px-1 py-0.5 hover:bg-slate-100 ${isDetail ? 'block max-w-[180px] truncate' : ''}`}
          title={isDetail ? String(value ?? '') : undefined}
        >
          {opts.display ?? String(value ?? '')}
        </span>
      </td>
    )
  }

  const selCell = (id: string, field: string, value: string, options: string[]) => {
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
    return (
      <td key={field} className="px-2 py-2 text-sm" onClick={() => setEditing({ id, field })}>
        <span className="cursor-pointer rounded bg-slate-100 px-2 py-0.5 text-xs font-medium hover:bg-slate-200">
          {value} ▾
        </span>
      </td>
    )
  }

  const badge = (kind: 'real' | 'proy') =>
    kind === 'real' ? (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Real</span>
    ) : (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Proyectado</span>
    )

  const journalRow = (t: Tx, kind: 'real' | 'proy') => (
    <tr key={t.id} className={`border-t border-slate-100 ${kind === 'proy' ? 'bg-amber-50/50' : 'bg-white'}`}>
      {txtCell(t.id, 'date', t.date, { type: 'date', display: fmtDate(t.date) })}
      {selCell(t.id, 'bank_account', t.bank_account, lists.accounts)}
      {txtCell(t.id, 'detail', t.detail, { display: shortDetail(t.detail) })}
      {selCell(t.id, 'category', t.category, lists.categories)}
      {selCell(t.id, 'frequency', t.frequency, FREQUENCIES)}
      {txtCell(t.id, 'debit', t.debit, { type: 'number', right: true, display: Number(t.debit) ? money(Number(t.debit)) : '' })}
      {txtCell(t.id, 'credit', t.credit, { type: 'number', right: true, display: Number(t.credit) ? money(Number(t.credit)) : '' })}
      <td className="px-2 py-2.5 text-right align-middle whitespace-nowrap">
        <span title={t.reconciled ? 'Reconciliado' : isFromBank(t.detail, t.source) ? 'Del banco' : 'Manual/Escaneado'} className={`mr-1 inline-grid size-4 place-items-center rounded-full ${t.reconciled ? 'bg-emerald-500' : isFromBank(t.detail, t.source) ? 'bg-blue-500' : 'bg-amber-400'}`}>
          {t.reconciled ? <span className="text-[8px] text-white">✓</span> : null}
        </span>
        <button onClick={() => delRow(t.id)} className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500" aria-label="Borrar">×</button>
      </td>
    </tr>
  )

  // Balances por cuenta (solo las que tienen balance distinto de cero)
  const accountBalances = useMemo(() => {
    const latest: Record<string, { balance: number; date: string }> = {}
    for (const t of transactions) {
      const acct = t.bank_account || 'Cuenta principal'
      const bal = Number(t.daily_balance) || 0
      if (!latest[acct] || t.date >= latest[acct].date) {
        latest[acct] = { balance: bal, date: t.date }
      }
    }
    return Object.entries(latest)
      .filter(([, v]) => v.balance !== 0)
      .sort((a, b) => Math.abs(b[1].balance) - Math.abs(a[1].balance))
  }, [transactions])

  const allRows = useMemo(() => {
    const r = transactions.map((t) => ({ ...t, _kind: 'real' as const }))
    const p = projected.map((t) => ({ ...t, _kind: 'proy' as const }))
    const s = [...r, ...p].sort((a, b) => a.date.localeCompare(b.date))
    const ordered = sortNewest ? s.reverse() : s
    const q = search.trim().toLowerCase()
    if (!q) return ordered
    return ordered.filter((t) => {
      const inText = [t.detail, t.bank_account, t.category, t.vendor].filter(Boolean).join(' ').toLowerCase().includes(q)
      const inAmount = String(t.debit || '').includes(q) || String(t.credit || '').includes(q)
      return inText || inAmount
    })
  }, [transactions, projected, sortNewest, search])

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-[#17263d]" translate="no">
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Encabezado */}
        <div className="mb-1 text-xs text-slate-400">
          <Link href="/" className="hover:underline">Bancos y Cuentas</Link>
          <span className="mx-1">›</span>
          <span className="font-semibold text-slate-600">Estado Bancario</span>
        </div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Estado Bancario</h1>
            <p className="text-sm text-slate-500">Libro Diario — movimientos reales y proyecciones del mes</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChatOpen((v) => !v)}
              className={`rounded-xl px-3 py-2 text-sm font-bold ${chatOpen ? 'bg-[#40b9a1] text-[#10243f]' : 'bg-[#10243f] text-white'}`}
            >
              💬 Preguntar
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* KPIs */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl border-t-4 border-[#10243f] bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Balance real</p>
            <p className={`mt-1 font-mono text-[26px] font-bold ${realBalance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(realBalance)}</p>
            <p className="mt-1 text-[11px] text-slate-400">Solo movimientos reales</p>
          </div>
          <div className="rounded-2xl border-t-4 border-emerald-500 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Ingresos reales</p>
            <p className="mt-1 font-mono text-[26px] font-bold text-emerald-600">{money(totals.cReal)}</p>
            <p className="mt-1 text-[11px] text-slate-400">{transactions.length} movimientos</p>
          </div>
          <div className="rounded-2xl border-t-4 border-red-500 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Gastos reales</p>
            <p className="mt-1 font-mono text-[26px] font-bold text-red-600">{money(totals.dReal)}</p>
            <p className="mt-1 text-[11px] text-slate-400">Débito acumulado</p>
          </div>
          <div className="rounded-2xl border-t-4 border-[#10243f] bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Cuentas</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {accountBalances.length === 0 && <p className="text-xs text-slate-400">Sin balances</p>}
              {accountBalances.map(([acct, v]) => (
                <div key={acct} className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-600">{acct}</span>
                  <span className={`font-mono text-sm font-bold ${v.balance < 0 ? 'text-red-600' : 'text-[#10243f]'}`}>{money(v.balance)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Libro Diario */}
        <div className="mb-5 overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-center justify-between border-b-2 border-[#10243f]/10 bg-slate-50/60 px-4 py-3">
            <h2 className="text-[17px] font-bold text-[#10243f]">Libro Diario</h2>
            <div className="flex items-center gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Buscar…"
                className="w-32 rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-[#40b9a1] sm:w-44"
              />
              <button onClick={() => setSortNewest((v) => !v)} title={sortNewest ? 'Ver más antiguos primero' : 'Ver más recientes primero'} className="rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200">
                {sortNewest ? '↓ Recientes' : '↑ Antiguos'}
              </button>
              <button onClick={() => setShowFull(true)} className="text-xs font-semibold text-[#0f8a73] hover:underline">
                Ver registro completo
              </button>
              <button
                onClick={startAdd}
                className="rounded-xl bg-[#40b9a1] px-3 py-1.5 text-sm font-bold text-[#10243f] hover:bg-[#35a48f]"
              >
                + Añadir
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                  <th className="w-[92px] px-2 py-2.5 font-semibold text-left align-middle">Fecha</th>
                  <th className="w-[110px] px-2 py-2.5 font-semibold text-left align-middle">Cuenta</th>
                  <th className="w-[180px] px-2 py-2.5 font-semibold text-left align-middle">Detalle</th>
                  <th className="w-[110px] px-2 py-2.5 font-semibold text-left align-middle">Categoría</th>
                  <th className="w-[90px] px-2 py-2.5 font-semibold text-left align-middle">Frecuencia</th>
                  <th className="w-[90px] px-2 py-2.5 text-right font-semibold align-middle">Débito</th>
                  <th className="w-[90px] px-2 py-2.5 text-right font-semibold align-middle">Crédito</th>
                  <th className="w-[36px] px-2 py-2.5 align-middle"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">Cargando…</td></tr>
                ) : (
                  <>
                    {allRows.map((t) => journalRow(t, t._kind))}
                    {newRow && (
                      <tr className="border-t-2 border-[#40b9a1] bg-emerald-50/60">
                        <td className="px-2 py-2">
                          <input type="date" value={newRow.date} onChange={(e) => setNewRow({ ...newRow, date: e.target.value })} className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm" />
                        </td>
                        <td className="px-2 py-2">
                          <select value={newRow.bank_account} onChange={(e) => setNewRow({ ...newRow, bank_account: e.target.value })} className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm">
                            {lists.accounts.map((o) => <option key={o}>{o}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input value={newRow.detail} onChange={(e) => setNewRow({ ...newRow, detail: e.target.value })} onBlur={(e) => suggestCategory(e.target.value)} placeholder="Detalle…" className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm" />
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
                        <td className="px-2 py-2">{badge(newRow.frequency === 'Un solo pago' ? 'real' : 'proy')}</td>
                        <td className="px-2 py-2">
                          <div className="flex gap-1">
                            <button onClick={commitAdd} className="rounded-lg bg-[#40b9a1] px-2 py-1 text-xs font-bold text-[#10243f]">✓</button>
                            <button onClick={() => setNewRow(null)} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">✕</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {!allRows.length && !newRow && (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">Sin movimientos este mes. Toca <b>+ Añadir</b> para crear el primero.</td></tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            Toca cualquier celda para editarla — todo se guarda solo. Solo los movimientos <b>Reales</b> mueven el balance real.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Comprobantes OCR */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-1 font-bold">Comprobantes</h2>
            <p className="mb-3 text-xs text-slate-400">Tómale foto al recibo: se lee solo y crea el gasto con el comprobante adjunto.</p>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) sendReceiptToOCR(f); e.target.value = '' }} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={ocrBusy}
              className="w-full rounded-xl border-2 border-dashed border-slate-200 py-6 text-sm font-semibold text-slate-500 hover:border-[#40b9a1] hover:text-[#0f8a73] disabled:opacity-50"
            >
              {ocrBusy ? 'Leyendo…' : '📷 Escanear comprobante'}
            </button>
            {ocrMsg && <p className="mt-2 text-xs text-slate-500">{ocrMsg}</p>}
          </div>

          {/* Importar CSV del banco */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-1 font-bold">Banco sincronizado</h2>
            <p className="mb-3 text-xs text-slate-400">Tus movimientos entran solos cada mañana. Toca para sincronizar ahora.</p>
            <button
              onClick={requestSync}
              disabled={syncing}
              className="mb-4 w-full rounded-xl bg-[#40b9a1] py-3 text-sm font-bold text-[#10243f] disabled:opacity-50"
            >
              {syncing ? 'Sincronizando…' : '🔄 Sincronizar banco ahora'}
            </button>

            {syncMsg && <p className="mb-3 text-xs text-slate-500">{syncMsg}</p>}
            <h2 className="mb-1 font-bold">Importar del banco</h2>
            <p className="mb-3 text-xs text-slate-400">Sube el CSV que bajas de tu banco. Los números de cuenta se ocultan: solo entran fecha, detalle y montos. No duplica lo que ya está.</p>
            <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) sendCSVToImport(f); e.target.value = '' }} />
            <button
              onClick={() => csvRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-slate-200 py-6 text-sm font-semibold text-slate-500 hover:border-[#40b9a1] hover:text-[#0f8a73]"
            >
              📤 Subir CSV del banco
            </button>
            {csvMsg && <p className="mt-2 text-xs text-slate-500">{csvMsg}</p>}
          </div>

          {/* Proyecciones y recurrentes */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-1 font-bold">Proyecciones y recurrentes</h2>
            <p className="mb-3 text-xs text-slate-400">Las filas <span className="font-bold text-amber-600">Proyectado</span> del diario nacen de estas reglas.</p>
            {projected.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">Sin proyecciones este mes.</p>
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
            <p className="mt-2 text-[11px] text-slate-400">Para programar algo (ej. $400 diarios hasta fin de mes): <b>+ Añadir</b> → Frecuencia <b>Diaria</b>.</p>
          </div>
        </div>

        {/* ===== Registro Completo: overlay en pantalla completa sobre esta misma página ===== */}
        {showFull && (
          <FullRegister
            month={month}
            transactions={transactions}
            projected={projected}
            sortNewest={sortNewest}
            onClose={() => setShowFull(false)}
            txtCell={txtCell}
            delRow={delRow}
          />
        )}
          </div>
        </div>
        {chatOpen && (
          <aside className="fixed inset-x-0 bottom-0 z-40 flex h-[70vh] flex-col rounded-t-3xl border-t-2 border-slate-200 bg-white shadow-2xl lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-[370px] lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h3 className="font-bold">Asistente financiero</h3>
                <p className="text-[11px] text-slate-400">Pregunta sobre tus números</p>
              </div>
              <button onClick={() => setChatOpen(false)} className="rounded-lg bg-slate-100 px-2 py-1 text-sm font-bold text-slate-500" aria-label="Cerrar chat">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {chatMsgs.length === 0 ? (
                <div>
                  <p className="mb-2 text-sm text-slate-500">¿En qué te ayudo? Prueba:</p>
                  {['¿Cuánto gasté en gasolina este mes?', '¿Cuál es mi balance real?', 'Resume mis gastos por categoría'].map((s) => (
                    <button key={s} onClick={() => askAI(s)} className="mb-2 block w-full rounded-xl bg-slate-50 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100">
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                chatMsgs.map((m, i) => (
                  <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : ''}`}>
                    <div className={`inline-block max-w-[90%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line text-left ${m.role === 'user' ? 'bg-[#10243f] text-white' : 'bg-slate-100 text-slate-700'}`}>
                      {m.text}
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
                              ✅ Aprobar
                            </button>
                            <button
                              onClick={() => setChatMsgs(chatMsgs.filter((_, k) => k !== i))}
                              className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {chatBusy && <p className="text-xs text-slate-400">Pensando…</p>}
              <div ref={chatEndRef} />
            </div>
            <div className="border-t border-slate-100 p-3">
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') askAI(chatInput) }}
                  placeholder="Pregunta de finanzas…"
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <button onClick={() => askAI(chatInput)} disabled={chatBusy} className="rounded-xl bg-[#40b9a1] px-4 py-2 text-sm font-bold text-[#10243f] disabled:opacity-50" aria-label="Enviar">
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

/* ---------- Registro Completo (overlay) ---------- */
function FullRegister({ month, transactions, projected, onClose, txtCell, delRow, sortNewest }: {
  month: string
  transactions: Tx[]
  projected: Tx[]
  onClose: () => void
  txtCell: (id: string, field: string, value: any, opts?: { type?: string; right?: boolean; display?: string }) => ReactNode
  delRow: (id: string) => void
  sortNewest: boolean
}) {
  const today = todayISO()
  const monthName = (() => {
    const [y, m] = month.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('es-US', { month: 'long', year: 'numeric' })
  })()

  type FR = {
    id: string; date: string; detail: string; account: string; kind: 'real' | 'proy'
    dReal: number; cReal: number; gProy: number; iProy: number; realBal?: number; projBal?: number
  }

  const { past, future, totGProy, totIProy, finalProj } = useMemo(() => {
    const rows: FR[] = [
      ...transactions.map((t) => ({
        id: t.id, date: t.date, detail: t.detail, account: t.bank_account, kind: 'real' as const,
        dReal: Number(t.debit) || 0, cReal: Number(t.credit) || 0, gProy: 0, iProy: 0,
      })),
      ...projected.map((p) => ({
        id: p.id, date: p.date, detail: p.detail, account: p.bank_account, kind: 'proy' as const,
        dReal: 0, cReal: 0, gProy: Number(p.debit) || 0, iProy: Number(p.credit) || 0,
      })),
    ].sort((a, b) => {
      const d = a.date.localeCompare(b.date) || (a.kind === 'real' ? -1 : 1)
      return sortNewest ? -d : d
    })

    let rb = 0
    for (const r of rows) if (r.kind === 'real') { rb += r.cReal - r.dReal; r.realBal = rb }
    let pb = rb
    let tg = 0, ti = 0
    for (const r of rows) {
      if (r.kind === 'proy') { pb += r.iProy - r.gProy; r.projBal = pb; tg += r.gProy; ti += r.iProy }
    }
    return {
      past: rows.filter((r) => r.date < today),
      future: rows.filter((r) => r.date >= today),
      totGProy: tg, totIProy: ti, finalProj: pb,
    }
  }, [transactions, projected, today])

  const row = (r: FR) => (
    <tr key={r.id + r.kind} className={`border-t border-slate-100 ${r.kind === 'proy' ? 'bg-amber-50/50' : 'bg-white'}`}>
      {txtCell(r.id, 'date', r.date, { type: 'date', display: fmtDate(r.date) })}
      {txtCell(r.id, 'detail', r.detail, { display: shortDetail(r.detail) })}
      <td className="px-2 py-2 text-sm text-slate-500">{r.account}</td>
      {r.kind === 'real' ? (
        <>
          {txtCell(r.id, 'debit', r.dReal, { type: 'number', right: true, display: r.dReal ? money(r.dReal) : '' })}
          {txtCell(r.id, 'credit', r.cReal, { type: 'number', right: true, display: r.cReal ? money(r.cReal) : '' })}
          <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${Number(r.realBal) < 0 ? 'text-red-600' : ''}`}>{money(Number(r.realBal))}</td>
          <td className="px-2 py-2"></td>
          <td className="px-2 py-2"></td>
          <td className="px-2 py-2"></td>
        </>
      ) : (
        <>
          <td className="px-2 py-2"></td>
          <td className="px-2 py-2"></td>
          <td className="px-2 py-2"></td>
          {txtCell(r.id, 'debit', r.gProy, { type: 'number', right: true, display: r.gProy ? money(r.gProy) : '' })}
          {txtCell(r.id, 'credit', r.iProy, { type: 'number', right: true, display: r.iProy ? money(r.iProy) : '' })}
          <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${Number(r.projBal) < 0 ? 'text-red-600' : 'text-amber-700'}`}>{money(Number(r.projBal))}</td>
        </>
      )}
      <td className="px-2 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.kind === 'real' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {r.kind === 'real' ? 'Real' : 'Proyectado'}
        </span>
      </td>
      <td className="px-2 py-2 text-right">
        <button onClick={() => delRow(r.id)} className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500" aria-label="Borrar">×</button>
      </td>
    </tr>
  )

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f4f7fb]">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Registro Completo</h1>
            <p className="text-sm text-slate-500 capitalize">{monthName} — reales + proyecciones en orden de fecha</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl bg-[#10243f] px-4 py-2 text-sm font-bold text-white">← Volver</button>
            <button onClick={onClose} className="rounded-xl bg-slate-200 px-3 py-2 text-sm font-bold text-slate-600" aria-label="Cerrar">✕</button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="w-[92px] px-2 py-2.5 font-semibold text-left align-middle">Fecha</th>
                  <th className="w-[180px] px-2 py-2.5 font-semibold text-left align-middle">Detalle</th>
                  <th className="w-[110px] px-2 py-2.5 font-semibold text-left align-middle">Cuenta</th>
                  <th className="w-[90px] px-2 py-2.5 text-right font-semibold align-middle">Débito real</th>
                  <th className="w-[90px] px-2 py-2.5 text-right font-semibold align-middle">Crédito real</th>
                  <th className="w-[100px] px-2 py-2.5 text-right font-semibold align-middle">Balance real</th>
                  <th className="w-[90px] px-2 py-2.5 text-right font-semibold align-middle">Gasto proy.</th>
                  <th className="w-[90px] px-2 py-2.5 text-right font-semibold align-middle">Ingreso proy.</th>
                  <th className="w-[100px] px-2 py-2.5 text-right font-semibold align-middle">Balance proy.</th>
                  <th className="w-[36px] px-2 py-2.5 align-middle"></th>
                  <th className="px-2 py-2.5 align-middle"></th>
                </tr>
              </thead>
              <tbody>
                {past.map(row)}
                <tr className="bg-[#10243f]">
                  <td colSpan={11} className="px-4 py-1.5 text-center text-xs font-bold tracking-[0.2em] text-white">— HOY —</td>
                </tr>
                {future.map(row)}
                {past.length + future.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-400">Sin movimientos este mes.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                  <td colSpan={3} className="px-2 py-3 text-sm">Totales proyectados</td>
                  <td className="px-2 py-3"></td>
                  <td className="px-2 py-3"></td>
                  <td className="px-2 py-3"></td>
                  <td className="px-2 py-3 text-right font-mono text-sm text-red-600">{money(totGProy)}</td>
                  <td className="px-2 py-3 text-right font-mono text-sm text-emerald-600">{money(totIProy)}</td>
                  <td className={`px-2 py-3 text-right font-mono text-sm ${finalProj < 0 ? 'text-red-600' : 'text-amber-700'}`}>{money(finalProj)}</td>
                  <td className="px-2 py-3"></td>
                  <td className="px-2 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            Toca cualquier celda para editarla — todo se guarda solo. El balance proyectado parte del balance real actual.
          </p>
        </div>
      </div>
    </div>
  )
}
