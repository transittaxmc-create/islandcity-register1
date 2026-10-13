'use client'

import { useEffect, useState } from 'react'
import { money, fmtD, freqLabel, FREQS, CATS, localToday, RULES_EVT } from './projections-panel'
import type { RuleItem, ProjItem } from './projections-panel'

// ============ RECURRING RULES (Ajustes → Proyecciones) ============
// Caja autocontenida: lista, crea, edita (con pregunta de alcance) y borra
// reglas recurrentes. Usa las mismas APIs que el register de Proyecciones;
// los cambios se notifican con RULES_EVT para refrescar la vista al instante.
const RR_NEW_VEN = '__rr_nuevo_vendedor__'
const RR_NEW_CAT = '__rr_nueva_categoria__'

export default function RecurringRulesBox() {
  const today = localToday()
  const [rules, setRules] = useState<RuleItem[]>([])
  const [proj, setProj] = useState<ProjItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [catsList, setCatsList] = useState<string[]>([])
  const [vendorsList, setVendorsList] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const [fdate, setFdate] = useState(today)
  const [fdetail, setFdetail] = useState('')
  const [fcat, setFcat] = useState('Proyección')
  const [finc, setFinc] = useState('')
  const [fexp, setFexp] = useState('')
  const [ffreq, setFfreq] = useState('Mensual')
  const [fend, setFend] = useState('')
  const [editing, setEditing] = useState<{ ruleId: string; occurrenceDate: string; frequency: string } | null>(null)
  const [scopeAsk, setScopeAsk] = useState(false)
  const [newVenMode, setNewVenMode] = useState(false)
  const [newCatMode, setNewCatMode] = useState(false)
  const [newVen, setNewVen] = useState('')
  const [newCat, setNewCat] = useState('')

  const load = async () => {
    try {
      const sj = await fetch(`/api/projections/summary?_=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json())
      if (sj && !sj.error) {
        setRules(((sj.ruleItems || []) as RuleItem[]).slice().sort((a, b) => String(a.pay_day).localeCompare(String(b.pay_day))))
        setProj(((sj.projected || []) as ProjItem[]).slice())
      }
    } catch {}
    setLoaded(true)
  }

  useEffect(() => { load() }, [])

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

  const notify = () => { try { window.dispatchEvent(new Event(RULES_EVT)) } catch {} }

  // Guarda una categoría/vendedor nuevo en su lista (Ajustes → Cuentas y bancos).
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

  const resetForm = () => {
    setFdate(today)
    setFdetail('')
    setFcat('Proyección')
    setFinc('')
    setFexp('')
    setFfreq('Mensual')
    setFend('')
    setNewVenMode(false)
    setNewCatMode(false)
    setNewVen('')
    setNewCat('')
    setEditing(null)
    setScopeAsk(false)
  }

  const nextOccurrence = (ruleId: string) => {
    const ds = proj
      .filter((p) => String(p.rule_id) === String(ruleId) && p.date >= today)
      .map((p) => p.date)
      .sort()
    return ds[0] || today
  }

  // Carga la regla en el formulario en modo edición (igual que la primera fila del register).
  const startEdit = (ruleId: string) => {
    const r = rules.find((x) => String(x.id) === String(ruleId))
    if (!r || busy) return
    const occ = nextOccurrence(String(r.id))
    const isInc = String(r.type || '').toLowerCase() === 'ingreso'
    setFdate(occ)
    setFdetail(r.concept || '')
    setFcat(r.category || 'Proyección')
    setFinc(isInc ? String(r.amount) : '')
    setFexp(!isInc ? String(r.amount) : '')
    setFfreq(r.frequency || 'Mensual')
    setFend(r.end_date || '')
    setNewVenMode(false)
    setNewCatMode(false)
    setNewVen('')
    setNewCat('')
    setScopeAsk(false)
    setEditing({ ruleId: String(r.id), occurrenceDate: occ, frequency: r.frequency || '' })
    setShowForm(true)
  }

  const commit = async (scope?: 'solo' | 'atras' | 'adelante' | 'todas') => {
    if (busy) return
    const useNewVen = newVenMode && newVen.trim().length > 0
    const useNewCat = newCatMode && newCat.trim().length > 0
    if (newVenMode && !useNewVen) setNewVenMode(false)
    if (newCatMode && !useNewCat) setNewCatMode(false)
    const venName = (useNewVen ? newVen : fdetail).trim()
    const catName = (useNewCat ? newCat : fcat).trim() || 'Proyección'
    const inc = Math.abs(Number(finc) || 0)
    const exp = Math.abs(Number(fexp) || 0)
    const amount = inc > 0 ? inc : exp
    if (!venName || !fdate) return
    if (!editing && amount <= 0) return // en edición se permite 0 (día sin trabajo)
    setBusy(true)
    try {
      await persistList('categories', catName)
      await persistList('vendors', venName)
      const isInc = inc > 0
      if (editing) {
        // En edición con regla recurrente, primero se pregunta el alcance.
        if (editing.frequency !== 'Un solo pago' && !scope) { setScopeAsk(true); setBusy(false); return }
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
              frequency: ffreq,
              pay_day: fdate,
              end_date: fend || null,
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
            date: fdate,
            detail: venName,
            category: catName,
            frequency: ffreq,
            debit: isInc ? 0 : amount,
            credit: isInc ? amount : 0,
            end_date: fend || null,
          }),
        }).then((r) => r.json())
        if (res?.error) throw new Error(res.error)
      }
      resetForm()
      setShowForm(false)
      await load()
      notify()
    } catch {
      // keep the form open so nothing is lost
    } finally {
      setBusy(false)
    }
  }

  // Borra la regla completa (optimista: la fila desaparece al instante).
  const del = async (id: string) => {
    const prev = rules
    setRules((p) => p.filter((r) => String(r.id) !== String(id)))
    try {
      await fetch(`/api/reconcile/data?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch { setRules(prev); return }
    await load()
    notify()
  }

  const _catBase = ['Proyección', ...catsList, ...CATS.filter((c) => c !== 'Proyección' && !catsList.includes(c))]
  const catOptions = [...new Set(_catBase.concat(editing && fcat && !_catBase.includes(fcat) ? [fcat] : []))]
  const _venBase = [...vendorsList, ...rules.map((r) => String(r.concept || '').trim()).filter(Boolean)]
  const venOptions = [...new Set(_venBase.concat(editing && fdetail.trim() && !_venBase.includes(fdetail.trim()) ? [fdetail.trim()] : []))].sort((a, b) => a.localeCompare(b, 'es'))
  const dateDisabled = !!editing && editing.frequency !== 'Un solo pago'

  return (
    <div className="rounded-2xl border border-[#dce5ef] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold">Recurring rules</h3>
          <p className="mt-1 text-xs text-slate-500">Recurring income and expenses. They feed the projection totals.</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm((s) => !s) }}
          className="rounded-xl bg-[#0b78e3] px-4 py-2 text-xs font-bold text-white"
        >
          {showForm ? 'Close' : '+ New rule'}
        </button>
      </div>

      {showForm && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">{editing ? 'Edit rule' : 'New rule'}</p>
            {editing && (<span className="rounded-full bg-[#40b9a1]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#0f766e]">Editing</span>)}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-[11px] font-bold text-slate-500">Start
              <input type="date" value={fdate} onChange={(e) => setFdate(e.target.value)} disabled={dateDisabled} title="Start" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-100 disabled:text-slate-400" />
            </label>
            <label className="text-[11px] font-bold text-slate-500">Vendor
              {newVenMode ? (
                <input value={newVen} onChange={(e) => setNewVen(e.target.value)} placeholder="New vendor" autoFocus title="New vendor" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
              ) : (
                <select value={fdetail} onChange={(e) => { const v = e.target.value; if (v === RR_NEW_VEN) { setNewVenMode(true); setNewVen('') } else setFdetail(v) }} title="Vendor" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
                  <option value="" disabled>— Vendor —</option>
                  {venOptions.map((v) => (<option key={v} value={v}>{v}</option>))}
                  <option value={RR_NEW_VEN}>+ Add new vendor</option>
                </select>
              )}
            </label>
            <label className="text-[11px] font-bold text-slate-500">Category
              {newCatMode ? (
                <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category…" autoFocus title="New category" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
              ) : (
                <select value={catOptions.includes(fcat) ? fcat : 'Proyección'} onChange={(e) => { const v = e.target.value; if (v === RR_NEW_CAT) { setNewCatMode(true); setNewCat('') } else setFcat(v) }} title="Category" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
                  {catOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                  <option value={RR_NEW_CAT}>+ Add new category</option>
                </select>
              )}
            </label>
            <label className="text-[11px] font-bold text-slate-500">Frequency
              <select value={ffreq} onChange={(e) => setFfreq(e.target.value)} title="Frequency" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold">
                {FREQS.map(([v, label]) => (<option key={v} value={v}>{label}</option>))}
              </select>
            </label>
            <label className="text-[11px] font-bold text-slate-500">Income
              <input type="number" inputMode="decimal" value={finc} onChange={(e) => setFinc(e.target.value)} placeholder="0.00" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right font-mono text-xs" />
            </label>
            <label className="text-[11px] font-bold text-slate-500">Expense
              <input type="number" inputMode="decimal" value={fexp} onChange={(e) => setFexp(e.target.value)} placeholder="0.00" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right font-mono text-xs" />
            </label>
            <label className="text-[11px] font-bold text-slate-500">Until <span className="font-normal text-slate-400">(optional)</span>
              <input type="date" value={fend} onChange={(e) => setFend(e.target.value)} title="Until (optional)" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-500" />
            </label>
            <div className="flex items-end justify-end gap-1.5">
              <button onClick={() => commit()} disabled={busy} title={editing ? 'Save changes' : 'Save rule'} className="rounded-lg bg-[#40b9a1] px-3 py-1.5 text-xs font-bold text-[#10243f] disabled:opacity-50">✓ Save</button>
              <button onClick={() => { resetForm(); setShowForm(false) }} title="Cancel" className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600">✕</button>
            </div>
          </div>
          {scopeAsk && editing && (
            <div className="mt-3 rounded-lg bg-sky-50/70 p-3">
              <div className="text-xs font-extrabold text-slate-700">Which entries does this change apply to?</div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <button onClick={() => commit('solo')} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Only this one</button>
                <button onClick={() => commit('atras')} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">This and past ones</button>
                <button onClick={() => commit('adelante')} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">This and future ones</button>
                <button onClick={() => commit('todas')} disabled={busy} className="rounded-lg bg-[#1c3d5e] px-2 py-2 text-xs font-bold text-white disabled:opacity-50">All</button>
              </div>
              <button onClick={() => setScopeAsk(false)} className="mt-1.5 text-xs font-semibold text-slate-400 underline">Cancel</button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-slate-200">
        {!loaded ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400">Loading rules…</p>
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="text-left text-[11px] text-slate-400">
                <th className="border-b border-slate-200 px-2 py-2 font-medium">Start</th>
                <th className="border-b border-slate-200 px-2 py-2 font-medium">Detail</th>
                <th className="border-b border-slate-200 px-2 py-2 font-medium">Category</th>
                <th className="border-b border-slate-200 px-2 py-2 font-medium">Type</th>
                <th className="border-b border-slate-200 px-2 py-2 text-right font-medium">Amount</th>
                <th className="border-b border-slate-200 px-2 py-2 font-medium">Frequency</th>
                <th className="border-b border-slate-200 px-2 py-2 font-medium">Until</th>
                <th className="border-b border-slate-200 px-2 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const t = String(r.type || '').toLowerCase()
                const isInc = t === 'ingreso' || t === 'income'
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-500">{fmtD(r.pay_day)}</td>
                    <td className="px-2 py-2 font-medium text-slate-700">{r.concept}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">{r.category || 'Proyección'}</td>
                    <td className={`whitespace-nowrap px-2 py-2 text-xs font-bold ${isInc ? 'text-[#16a34a]' : 'text-red-500'}`}>{isInc ? 'INGRESO' : 'GASTO'}</td>
                    <td className={`whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums ${isInc ? 'text-[#16a34a]' : 'text-slate-800'}`}>{money(r.amount)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs font-semibold text-slate-500">{freqLabel(r.frequency)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-slate-500">{r.end_date ? fmtD(r.end_date) : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <button onClick={() => startEdit(String(r.id))} title="Edit rule" className="rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:bg-blue-50 hover:text-blue-600">✎</button>
                      <button onClick={() => del(String(r.id))} title="Delete rule" className="rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:bg-red-50 hover:text-red-600">✕</button>
                    </td>
                  </tr>
                )
              })}
              {rules.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">No rules yet. Create one with “+ New rule”.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        Edits apply to projected entries only — real bank movements are never touched.
      </p>
    </div>
  )
}
