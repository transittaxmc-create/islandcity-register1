// app/components/bank-lists-manager.tsx
// Gestiona Cuentas, Categorías y Proveedores desde Ajustes → Cuentas y bancos.
// Todo se guarda solo; lo añadido aparece en los menús del Libro Diario.
'use client'
import { useEffect, useState } from 'react'

type Item = { id: string; name: string }

const SECTIONS = [
  { key: 'accounts', title: 'Cuentas', desc: 'Tus cuentas de banco', placeholder: 'Nombre de la cuenta…' },
  { key: 'categories', title: 'Categorías', desc: 'Categorías del Libro Diario', placeholder: 'Nueva categoría…' },
  { key: 'vendors', title: 'Proveedores', desc: 'Comercios y proveedores frecuentes', placeholder: 'Nombre del proveedor…' },
] as const

export default function BankListsManager() {
  const [lists, setLists] = useState<Record<string, Item[]>>({ accounts: [], categories: [], vendors: [] })
  const [inputs, setInputs] = useState<Record<string, string>>({ accounts: '', categories: '', vendors: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  async function load() {
    try {
      const r = await fetch('/api/reconcile/lists')
      const j = await r.json()
      if (!j.error) setLists({ accounts: j.accounts || [], categories: j.categories || [], vendors: j.vendors || [] })
    } catch { /* */ }
  }
  useEffect(() => { load() }, [])

  async function add(key: string) {
    const name = (inputs[key] || '').trim()
    if (!name || busy) return
    setBusy(key)
    try {
      const r = await fetch('/api/reconcile/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list: key, name }),
      })
      const j = await r.json()
      if (j.error) { setMsg(j.error); return }
      setLists((l) => ({ ...l, [key]: [...l[key], j.item].sort((a, b) => a.name.localeCompare(b.name)) }))
      setInputs((i) => ({ ...i, [key]: '' }))
      setMsg('')
    } catch (e: any) {
      setMsg('No se pudo añadir: ' + e.message)
    }
    setBusy(null)
  }

  async function del(key: string, id: string) {
    if (!confirm('¿Eliminar este elemento?')) return
    try {
      await fetch(`/api/reconcile/lists?list=${key}&id=${id}`, { method: 'DELETE' })
      setLists((l) => ({ ...l, [key]: l[key].filter((x) => x.id !== id) }))
    } catch { /* */ }
  }

  return (
    <div className="flex flex-col gap-5">
      {SECTIONS.map((s) => (
        <div key={s.key} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-bold">{s.title}</h3>
          <p className="mt-1 text-xs text-slate-500">{s.desc}. Lo que añadas aquí aparece en los menús del Libro Diario.</p>
          {s.key === 'accounts' && (
            <a
              href="https://agent.meta.ai/connectors/plaid/accounts/link"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block w-full rounded-xl bg-[#40b9a1] py-2.5 text-center text-sm font-bold text-[#10243f] hover:bg-[#35a48f]"
            >
              ＋ Añadir cuenta de banco (Plaid)
            </a>
          )}
          <div className="mt-4 flex gap-2">
            <input
              value={inputs[s.key]}
              onChange={(e) => setInputs((i) => ({ ...i, [s.key]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') add(s.key) }}
              placeholder={s.placeholder}
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              onClick={() => add(s.key)}
              disabled={busy === s.key || !(inputs[s.key] || '').trim()}
              className="rounded-xl bg-[#10243f] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              + Añadir
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {lists[s.key].map((x) => (
              <span key={x.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">
                {x.name}
                <button onClick={() => del(s.key, x.id)} className="ml-1 font-bold text-slate-400 hover:text-red-600" aria-label={`Eliminar ${x.name}`}>×</button>
              </span>
            ))}
            {lists[s.key].length === 0 && <p className="text-xs text-slate-400">Vacío.</p>}
          </div>
        </div>
      ))}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  )
}
