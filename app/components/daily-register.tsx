'use client'

// DAILY Entry Register — se alimenta SOLO del auto-sync desde la app claris.
// Sin cuadritos de entrada manual: aquí las transacciones se verifican/corrigen
// por plataforma y se cierran POR GRUPO (cada plataforma por separado) hacia
// Proyecciones como depósitos pendientes con su fecha exacta.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PlatformAvatar } from './platform-logo'

const money = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0)

const MES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtD = (iso: string) => {
  if (!iso || typeof iso !== 'string') return '–'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${MES[m - 1]} ${String(d).padStart(2, '0')}`
}
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const platformBadge = (platform: string): { label: string; cls: string } | null => {
  const p = String(platform || '').trim().toLowerCase()
  if (p === 'eco ride' || p === 'aki technology') return { label: 'ACCESS-A-RIDE', cls: 'border-sky-400/60 text-sky-500' }
  if (p === 'classic ryde' || p === 'aventus ride') return { label: 'VOUCHER', cls: 'border-orange-400/60 text-orange-500' }
  return null
}

const PLATFORMS = ['Uber', 'Lyft', 'Eco Ride', 'Throo', 'AKI Technology', 'Classic Ryde', 'Aventus Ride', 'Cash', 'Other']

const DAILY_PREFIX = 'DAILY \u00b7 '
const DAILY_CAT = 'Depósito plataforma'
const DAILY_CLOSE_KEY = 'daily-closes-v1'

type DailyTrip = {
  trip_id: string
  platform: string
  gross: number
  net: number
  tips: number
  toll: number
  extra_cash: number
  platform_fee: number
  trip_time: string
  trip_date: string
  deposit_date: string
  status: 'open' | 'closed'
}
type CloseItem = {
  platform: string
  total: number
  payDate: string
  ruleId: string
  status: 'pending' | 'fulfilled'
  realAmount?: number
  realTxId?: string
  matchedAt?: string
  gkey: string
}
type CloseRec = { workDate: string; closedAt: string; items: CloseItem[] }
type RegFilter = 'all' | 'pending' | 'matched' | 'difference'

export function DailyRegister({
  rules,
  bankTxs,
  onChanged,
}: {
  rules: any[]
  bankTxs: any[]
  onChanged: () => void
}) {
  const [trips, setTrips] = useState<DailyTrip[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [needsSetup, setNeedsSetup] = useState(false)
  const [filter, setFilter] = useState<RegFilter>('all')
  const [busy, setBusy] = useState(false)
  const [closes, setCloses] = useState<CloseRec[]>([])
  const [showHist, setShowHist] = useState(false)
  const [closingPlat, setClosingPlat] = useState<string | null>(null)
  const [closeOverrides, setCloseOverrides] = useState<Record<string, string>>({})
  const [matchRuleId, setMatchRuleId] = useState<string | null>(null)
  const [matchTxId, setMatchTxId] = useState('')
  const [editPlatId, setEditPlatId] = useState<string | null>(null)
  const [editAmtId, setEditAmtId] = useState<string | null>(null)
  const [editAmt, setEditAmt] = useState('')

  const fetchTrips = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const r = await fetch('/api/daily/trips?status=all', { cache: 'no-store' })
      const j = await r.json()
      if (j?.needsSetup) {
        setNeedsSetup(true)
        setTrips([])
        return
      }
      if (j?.error) throw new Error(j.error)
      setTrips(Array.isArray(j.trips) ? j.trips : [])
    } catch (e: any) {
      setLoadError(e?.message || 'Error loading trips')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTrips()
  }, [fetchTrips])

  // Historial de cierres (local): para marcar cumplidos al emparejar.
  useEffect(() => {
    try {
      const rc = localStorage.getItem(DAILY_CLOSE_KEY)
      if (!rc) return
      const arr = JSON.parse(rc)
      if (Array.isArray(arr)) {
        setCloses(
          arr
            .filter((c: any) => c && Array.isArray(c.items))
            .map((c: any) => ({
              workDate: String(c.workDate || ''),
              closedAt: String(c.closedAt || ''),
              items: (c.items as any[]).map((it: any) => ({
                platform: String(it.platform || ''),
                total: Number(it.total) || 0,
                payDate: String(it.payDate || ''),
                ruleId: String(it.ruleId || ''),
                status: it.status === 'fulfilled' ? 'fulfilled' : 'pending',
                realAmount: it.realAmount != null ? Number(it.realAmount) : undefined,
                realTxId: it.realTxId != null ? String(it.realTxId) : undefined,
                matchedAt: it.matchedAt != null ? String(it.matchedAt) : undefined,
                gkey: typeof it.gkey === 'string' && it.gkey ? it.gkey : `${String(it.platform || '')}||${String(it.payDate || '')}`,
              })),
            }))
        )
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(DAILY_CLOSE_KEY, JSON.stringify(closes.slice(0, 60)))
    } catch {}
  }, [closes])

  const openTrips = useMemo(() => trips.filter((t) => t.status === 'open'), [trips])
  const closedTrips = useMemo(() => trips.filter((t) => t.status === 'closed'), [trips])

  const groups = useMemo(() => {
    const m = new Map<string, { platform: string; entries: DailyTrip[]; gross: number; net: number; toll: number }>()
    for (const t of openTrips) {
      const g = m.get(t.platform) || { platform: t.platform, entries: [], gross: 0, net: 0, toll: 0 }
      g.entries.push(t)
      g.gross += Number(t.gross) || 0
      g.net += Number(t.net) || 0
      g.toll += Number(t.toll) || 0
      m.set(t.platform, g)
    }
    return [...m.values()].sort((a, b) => a.platform.localeCompare(b.platform, 'es'))
  }, [openTrips])

  const closedGroups = useMemo(() => {
    const m = new Map<string, { platform: string; entries: DailyTrip[]; net: number }>()
    for (const t of closedTrips) {
      const g = m.get(t.platform) || { platform: t.platform, entries: [], net: 0 }
      g.entries.push(t)
      g.net += Number(t.net) || 0
      m.set(t.platform, g)
    }
    return [...m.values()].sort((a, b) => a.platform.localeCompare(b.platform, 'es'))
  }, [closedTrips])

  const regGross = useMemo(() => openTrips.reduce((s, t) => s + (Number(t.gross) || 0), 0), [openTrips])
  const regNet = useMemo(() => openTrips.reduce((s, t) => s + (Number(t.net) || 0), 0), [openTrips])
  const regToll = useMemo(() => openTrips.reduce((s, t) => s + (Number(t.toll) || 0), 0), [openTrips])
  const counts = {
    all: openTrips.length,
    pending: openTrips.length,
    matched: closedTrips.length,
    difference: 0,
  }

  const shownGroups = filter === 'matched' ? closedGroups : groups

  const patchTrip = async (tripId: string, patch: Record<string, any>) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/daily/trips', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id: tripId, ...patch }),
      }).then((x) => x.json())
      if (r?.error) throw new Error(r.error)
      await fetchTrips()
    } catch (e: any) {
      setLoadError(e?.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  const deleteTrip = async (tripId: string) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/daily/trips?trip_id=${encodeURIComponent(tripId)}`, { method: 'DELETE' }).then((x) => x.json())
      if (r?.error) throw new Error(r.error)
      await fetchTrips()
    } catch (e: any) {
      setLoadError(e?.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  const saveAmt = (t: DailyTrip) => {
    const v = Math.abs(Number(editAmt) || 0)
    setEditAmtId(null)
    if (v > 0 && Math.abs(v - (Number(t.net) || 0)) >= 0.005) patchTrip(t.trip_id, { net: v })
  }

  // Cierre POR GRUPO (plataforma): el total va a Proyecciones con su fecha exacta.
  const confirmCloseGroup = async (platform: string) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/daily/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, date_overrides: closeOverrides }),
      }).then((x) => x.json())
      if (r?.error) throw new Error(r.error)
      const items: CloseItem[] = (r.closed || []).map((c: any) => ({
        platform: c.platform,
        total: c.total,
        payDate: c.deposit_date,
        ruleId: String(c.rule_id || ''),
        status: 'pending' as const,
        gkey: `${c.platform}||${c.deposit_date}`,
      }))
      if (items.length > 0) {
        const rec: CloseRec = { workDate: todayStr(), closedAt: new Date().toISOString(), items }
        setCloses((prev) => [rec, ...prev].slice(0, 60))
      }
      setClosingPlat(null)
      setCloseOverrides({})
      await fetchTrips()
      onChanged()
    } catch (e: any) {
      setLoadError(e?.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  // Depósitos pendientes: reglas DAILY por emparejar con el banco real.
  const dailyPending = useMemo(
    () =>
      (rules || [])
        .filter(
          (r) =>
            String(r.type || '').toLowerCase() === 'ingreso' &&
            String(r.frequency) === 'Un solo pago' &&
            String(r.concept || '').startsWith(DAILY_PREFIX)
        )
        .map((r) => ({ ...r, platform: String(r.concept).slice(DAILY_PREFIX.length).trim() || String(r.concept) }))
        .sort((a, b) => String(a.pay_day).localeCompare(String(b.pay_day))),
    [rules]
  )
  const matchCandidates = useMemo(
    () =>
      (bankTxs || [])
        .filter((x) => (Number(x.credit) || 0) > 0)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)))
        .slice(0, 40),
    [bankTxs]
  )

  const confirmMatch = async () => {
    const rule = dailyPending.find((r) => String(r.id) === String(matchRuleId))
    const tx = matchCandidates.find((x) => String(x.id) === String(matchTxId))
    if (!rule || !tx || busy) return
    const programmed = Math.abs(Number(rule.amount) || 0)
    const real = Math.abs(Number(tx.credit) || 0)
    setBusy(true)
    try {
      if (Math.abs(programmed - real) >= 0.005) {
        const res = await fetch('/api/reconcile/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ruleId: String(rule.id),
            pivot: String(rule.pay_day),
            scope: 'todas',
            values: {
              concept: String(rule.concept),
              amount: real,
              type: 'ingreso',
              frequency: 'Un solo pago',
              pay_day: String(rule.pay_day),
              end_date: null,
              category: rule.category || DAILY_CAT,
            },
          }),
        }).then((r) => r.json())
        if (res?.error) throw new Error(res.error)
      }
      const del = await fetch(`/api/reconcile/data?id=${encodeURIComponent(String(rule.id))}`, { method: 'DELETE' }).then((r) => r.json())
      if (del?.error) throw new Error(del.error)
      setCloses((prev) =>
        prev.map((c) => ({
          ...c,
          items: c.items.map((it) =>
            String(it.ruleId) === String(rule.id)
              ? { ...it, status: 'fulfilled' as const, realAmount: real, realTxId: String(tx.id), matchedAt: new Date().toISOString() }
              : it
          ),
        }))
      )
      setMatchRuleId(null)
      setMatchTxId('')
      onChanged()
    } catch {
      // se deja abierto para reintentar
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-extrabold tracking-wide text-slate-800">DAILY Entry Register</h3>
        <span className="rounded-full border border-orange-400/70 px-2 py-0.5 text-[10px] font-bold text-orange-500">DAY OPEN</span>
        <span className="text-[11px] text-slate-400">auto-sync from claris</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-bold tracking-wide text-slate-500">GROSS <span className="font-extrabold tabular-nums text-amber-500">{money(regGross)}</span></span>
        <span className="font-bold tracking-wide text-slate-500">NET <span className="font-extrabold tabular-nums text-[#16a34a]">{money(regNet)}</span></span>
        {regToll > 0 && (
          <span className="font-bold tracking-wide text-slate-500">TOLLS <span className="font-extrabold tabular-nums text-sky-600">{money(regToll)}</span></span>
        )}
        {counts.pending > 0 ? (
          <span className="rounded-full border border-orange-400/70 px-2 py-0.5 text-[10px] font-bold text-orange-500">{counts.pending} PENDING</span>
        ) : counts.matched > 0 ? (
          <span className="rounded-full border border-green-500/70 px-2 py-0.5 text-[10px] font-bold text-green-600">ALL MATCHED</span>
        ) : null}
      </div>

      {needsSetup && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          The trips table is not set up yet. Run the one-time SQL setup so claris trips can appear here.
        </p>
      )}
      {loadError && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600">{loadError}</p>
      )}

      {/* Filtros */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(
          [
            ['all', `ALL ${counts.all}`],
            ['pending', `PENDING ${counts.pending}`],
            ['matched', `MATCHED ${counts.matched}`],
            ['difference', `DIFFERENCE ${counts.difference}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold ${filter === k ? 'bg-amber-400 text-black' : 'bg-slate-100 text-slate-500'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Register: bloques por plataforma */}
      <div className="mt-2 max-h-[430px] space-y-2 overflow-y-auto overscroll-contain pr-0.5">
        {loading ? (
          <p className="rounded-xl border border-slate-100 px-3 py-6 text-center text-xs text-slate-400">Loading trips…</p>
        ) : shownGroups.length === 0 ? (
          <p className="rounded-xl border border-slate-100 px-3 py-6 text-center text-xs text-slate-400">
            {filter === 'matched' ? 'No closed trips yet.' : 'No trips yet. They appear here automatically when a trip closes in claris.'}
          </p>
        ) : (
          shownGroups.map((g) => {
            const badge = platformBadge(g.platform)
            const locked = filter === 'matched'
            const closing = closingPlat === g.platform
            return (
              <section key={g.platform} className="rounded-2xl border border-slate-200 bg-white p-2">
                <header className="flex items-center gap-2 px-1">
                  <PlatformAvatar platform={g.platform} size={26} />
                  <span className="truncate text-sm font-bold text-slate-800">{g.platform}</span>
                  {badge && (
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase leading-none ${badge.cls}`}>{badge.label}</span>
                  )}
                  <span className="grid size-5 shrink-0 place-items-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-500">{g.entries.length}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-slate-400">{locked ? 'sent' : `${g.entries.length} unpaid`}</span>
                  {!locked && (
                    <button
                      onClick={() => {
                        setClosingPlat(closing ? null : g.platform)
                        setCloseOverrides({})
                      }}
                      disabled={busy}
                      title="Close this platform group"
                      className="shrink-0 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
                    >
                      {closing ? 'Cancel' : 'Close'}
                    </button>
                  )}
                </header>
                <p className="mt-0.5 px-1 text-[11px] text-slate-500">
                  Gross <b className="tabular-nums text-amber-600">{money('gross' in g ? (g as any).gross : 0)}</b>
                  <span className="mx-1 text-slate-300">·</span>
                  Net <b className="tabular-nums text-green-600">{money(g.net)}</b>
                  {'toll' in g && (g as any).toll > 0 && (
                    <>
                      <span className="mx-1 text-slate-300">·</span>
                      Toll <b className="tabular-nums text-sky-600">{money((g as any).toll)}</b>
                    </>
                  )}
                </p>

                {/* Confirmación de cierre por grupo */}
                {closing && !locked && (
                  <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[11px] font-bold text-slate-700">
                      Close {g.platform} — {g.entries.length} trip{g.entries.length === 1 ? '' : 's'} · <span className="tabular-nums">{money(g.net)}</span> → Projections
                    </p>
                    {(() => {
                      const byDate = new Map<string, DailyTrip[]>()
                      for (const e of g.entries) {
                        const d = closeOverrides[e.trip_id] || e.deposit_date || ''
                        if (!byDate.has(d)) byDate.set(d, [])
                        byDate.get(d)!.push(e)
                      }
                      return (
                        <ul className="mt-1 space-y-1">
                          {[...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, list]) => (
                            <li key={d || 'none'} className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                                {list.length} trip{list.length === 1 ? '' : 's'} · <b className="tabular-nums">{money(list.reduce((s, x) => s + (Number(x.net) || 0), 0))}</b>
                              </span>
                              <input
                                type="date"
                                value={d}
                                onChange={(ev) => {
                                  const nd = ev.target.value
                                  setCloseOverrides((prev) => {
                                    const next = { ...prev }
                                    for (const x of list) next[x.trip_id] = nd
                                    return next
                                  })
                                }}
                                title="Deposit date"
                                className="shrink-0 rounded border border-slate-200 px-1 py-1 text-[11px]"
                              />
                            </li>
                          ))}
                        </ul>
                      )
                    })()}
                    <div className="mt-2 flex justify-end gap-2">
                      <button onClick={() => { setClosingPlat(null); setCloseOverrides({}) }} className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500">Cancel</button>
                      <button onClick={() => confirmCloseGroup(g.platform)} disabled={busy} className="rounded-lg bg-[#16a34a] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
                        Confirm close
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-1.5 space-y-1.5">
                  {g.entries.map((e) => {
                    const ebadge = platformBadge(e.platform)
                    return (
                      <div key={e.trip_id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                        <div className="flex items-center gap-2">
                          <PlatformAvatar platform={e.platform} size={30} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {locked ? (
                                <span className="truncate text-xs font-bold text-slate-800">{e.platform}</span>
                              ) : editPlatId === e.trip_id ? (
                                <select
                                  autoFocus
                                  value={e.platform}
                                  onChange={(ev) => { patchTrip(e.trip_id, { platform: ev.target.value }); setEditPlatId(null) }}
                                  onBlur={() => setEditPlatId(null)}
                                  className="min-w-0 max-w-full rounded border border-slate-200 px-1 py-0.5 text-xs font-bold"
                                >
                                  {PLATFORMS.map((v) => (<option key={v} value={v}>{v}</option>))}
                                </select>
                              ) : (
                                <button onClick={() => setEditPlatId(e.trip_id)} title="Change platform" className="truncate text-left text-xs font-bold text-slate-800">{e.platform}</button>
                              )}
                              {ebadge && (
                                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase leading-none ${ebadge.cls}`}>{ebadge.label}</span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[10px] tabular-nums text-slate-400">
                              {e.trip_time || '–'}
                              {Number(e.toll) > 0 && <span className="ml-1.5 text-sky-600">Toll {money(Number(e.toll))}</span>}
                              {Number(e.tips) > 0 && <span className="ml-1.5">Tip {money(Number(e.tips))}</span>}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            {editAmtId === e.trip_id && !locked ? (
                              <input
                                autoFocus
                                type="number"
                                inputMode="decimal"
                                value={editAmt}
                                onChange={(ev) => setEditAmt(ev.target.value)}
                                onBlur={() => saveAmt(e)}
                                onKeyDown={(ev) => { if (ev.key === 'Enter') saveAmt(e) }}
                                className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right text-xs font-bold tabular-nums"
                              />
                            ) : (
                              <button
                                onClick={() => { if (!locked) { setEditAmtId(e.trip_id); setEditAmt(String(e.net)) } }}
                                title={locked ? 'Net (locked — edit in Projections)' : 'Edit net amount'}
                                className="text-sm font-extrabold tabular-nums text-[#16a34a]"
                              >{money(Number(e.net))}</button>
                            )}
                            <p className="text-[10px] tabular-nums text-slate-400">Gross {money(Number(e.gross))}</p>
                          </div>
                          {!locked && (
                            <button onClick={() => deleteTrip(e.trip_id)} title="Delete entry" className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold text-slate-300 hover:bg-red-50 hover:text-red-500">✕</button>
                          )}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          {locked ? (
                            <span className="text-[10px] tabular-nums text-slate-400">Dep {fmtD(e.deposit_date)} · <span className="font-bold text-slate-400">SENT</span></span>
                          ) : (
                            <label className="flex items-center gap-1 text-[10px] text-slate-400">
                              Dep
                              <input
                                type="date"
                                value={e.deposit_date || ''}
                                onChange={(ev) => patchTrip(e.trip_id, { deposit_date: ev.target.value })}
                                title="Deposit date"
                                className="rounded border border-slate-200 px-1 py-0.5 text-[10px] tabular-nums text-slate-500"
                              />
                            </label>
                          )}
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${
                            locked ? 'border-green-500/60 text-green-600' : 'border-orange-400/60 text-orange-500'
                          }`}>{locked ? 'Sent' : 'Pending'}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>

      {/* Depósitos pendientes de emparejar */}
      {dailyPending.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold text-slate-700">Pending deposits ({dailyPending.length})</p>
          <ul className="mt-1 space-y-1">
            {dailyPending.map((r) => (
              <li key={String(r.id)} className="rounded-lg border border-amber-200 bg-amber-50/60 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5"><PlatformAvatar platform={r.platform} size={20} /><span className="truncate text-xs font-semibold text-slate-700">🔮 {r.platform}</span></span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-slate-800">{money(Number(r.amount) || 0)}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{fmtD(String(r.pay_day))}</span>
                  <button onClick={() => { setMatchRuleId(String(r.id)); setMatchTxId('') }} title="Match with actual bank deposit" className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-blue-600 shadow-sm">Match</button>
                </div>
                {String(matchRuleId) === String(r.id) && (
                  <div className="mt-1.5 rounded-md bg-white p-1.5">
                    <select value={matchTxId} onChange={(e) => setMatchTxId(e.target.value)} className="w-full rounded border border-slate-200 px-1 py-1 text-xs">
                      <option value="" disabled>— Actual bank deposit —</option>
                      {matchCandidates.map((x) => (
                        <option key={String(x.id)} value={String(x.id)}>{fmtD(x.date)} · {(x.detail || '').slice(0, 32)} · {money(Number(x.credit) || 0)}</option>
                      ))}
                    </select>
                    {(() => {
                      const tx = matchCandidates.find((x) => String(x.id) === String(matchTxId))
                      if (!tx) return null
                      const real = Math.abs(Number(tx.credit) || 0)
                      const prog = Math.abs(Number(r.amount) || 0)
                      const diff = Math.abs(prog - real) >= 0.005
                      return (
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-500">Scheduled <b className="tabular-nums">{money(prog)}</b> vs actual <b className="tabular-nums">{money(real)}</b></span>
                          <div className="flex shrink-0 gap-1.5">
                            <button onClick={() => { setMatchRuleId(null); setMatchTxId('') }} className="rounded px-2 py-1 text-[11px] font-bold text-slate-400">Cancel</button>
                            <button onClick={confirmMatch} disabled={busy} className="rounded bg-[#16a34a] px-2 py-1 text-[11px] font-bold text-white disabled:opacity-40">{diff ? `Adjust to ${money(real)} and mark fulfilled` : 'Mark fulfilled'}</button>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Historial de días cerrados */}
      {closes.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowHist((v) => !v)} className="text-xs font-bold text-slate-500">Closed days ({closes.length}) {showHist ? '▾' : '▸'}</button>
          {showHist && (
            <ul className="mt-1 max-h-[160px] space-y-1.5 overflow-y-auto overscroll-contain">
              {closes.map((c, i) => (
                <li key={`${c.workDate}-${i}`} className="rounded-lg border border-slate-100 px-2 py-1.5">
                  <p className="text-[11px] font-bold text-slate-600">{fmtD(c.workDate)}</p>
                  {c.items.map((it, j) => (
                    <p key={j} className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span className="flex min-w-0 items-center gap-1.5"><PlatformAvatar platform={it.platform} size={16} /><span className="truncate">{it.platform} → {fmtD(it.payDate)}</span></span>
                      <span className="shrink-0 tabular-nums">
                        {money(it.total)}
                        {it.status === 'fulfilled'
                          ? <span className="ml-1 rounded-full bg-green-100 px-1.5 py-px text-[9px] font-bold text-green-700">✓ {money(it.realAmount || 0)}</span>
                          : <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-bold text-amber-700">Pending</span>}
                      </span>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
