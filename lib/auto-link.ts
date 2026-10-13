// lib/auto-link.ts
// Enlace automático de transferencias internas a su ORIGEN.
// Regla de Miguel: cada transferencia lleva su origen conectado (el depósito original);
// el ingreso del mes/año cuenta cada depósito original UNA sola vez (clave para taxes).
// Solo enlaza cuando el emparejamiento es ÚNICO: mismo monto, cuentas distintas, ±3 días.
// Si es ambiguo (varios candidatos), NO adivina: se devuelve para que Miguel lo confirme.
import { supabaseServer } from './supabase-server'

const isTransferCat = (c: any) => {
  const s = String(c || '').trim().toLowerCase()
  return s === 'transfer' || s === 'transferencias internas'
}

export async function autoLinkTransfers(opts?: { dryRun?: boolean }) {
  const sb = supabaseServer()

  const { data: links } = await sb.from('transfer_links').select('from_tx,to_tx')
  const linked = new Set<string>()
  for (const l of links || []) { linked.add(String(l.from_tx)); linked.add(String(l.to_tx)) }

  // Paginado: PostgREST limita a 1000 filas por defecto
  const txs: any[] = []
  const PAGE = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await sb.from('bank_transactions')
      .select('id,date,bank_account,detail,debit,credit,category')
      .order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    txs.push(...(data || []))
    if (!data || data.length < PAGE) break
  }

  // Solo movimientos ya clasificados como transferencia interna y sin vincular.
  // 'Por verificar' se excluye: remitente ambiguo, Miguel lo confirma primero.
  const pool = (txs || []).filter((t: any) => !linked.has(String(t.id)) && isTransferCat(t.category))
  const debits = pool.filter((t: any) => Number(t.debit) > 0)
  const creditsByAmt = new Map<string, any[]>()
  for (const t of pool) {
    const c = Number(t.credit) || 0
    if (c <= 0) continue
    const k = c.toFixed(2)
    if (!creditsByAmt.has(k)) creditsByAmt.set(k, [])
    creditsByAmt.get(k)!.push(t)
  }

  const pairs: { from: any; to: any }[] = []
  for (const d of debits) {
    const k = Number(d.debit).toFixed(2)
    const dd = new Date(d.date + 'T12:00:00').getTime()
    for (const c of creditsByAmt.get(k) || []) {
      if (c.bank_account === d.bank_account) continue
      if (String(c.id) === String(d.id)) continue
      const cd = new Date(c.date + 'T12:00:00').getTime()
      if (Math.abs(cd - dd) > 3 * 86400000) continue
      pairs.push({ from: d, to: c })
    }
  }

  const fromCount = new Map<string, number>()
  const toCount = new Map<string, number>()
  for (const p of pairs) {
    fromCount.set(String(p.from.id), (fromCount.get(String(p.from.id)) || 0) + 1)
    toCount.set(String(p.to.id), (toCount.get(String(p.to.id)) || 0) + 1)
  }
  const isUnique = (p: { from: any; to: any }) =>
    fromCount.get(String(p.from.id)) === 1 && toCount.get(String(p.to.id)) === 1
  const unique = pairs.filter(isUnique)
  const seen = new Set<string>()
  const ambiguous = pairs.filter((p) => {
    if (isUnique(p)) return false
    const k = `${p.from.id}>${p.to.id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  let inserted = 0
  if (!opts?.dryRun && unique.length) {
    const { error: insErr } = await sb.from('transfer_links').insert(
      unique.map((p) => ({ from_tx: p.from.id, to_tx: p.to.id }))
    )
    if (insErr) throw new Error('Insert links: ' + insErr.message)
    inserted = unique.length
  }

  const slim = (t: any, side: 'debit' | 'credit') => ({
    id: t.id, date: t.date, bank_account: t.bank_account, detail: t.detail,
    ...(side === 'debit' ? { debit: t.debit } : { credit: t.credit }),
  })

  return {
    linked: inserted,
    scanned: pool.length,
    uniqueMatches: unique.map((p) => ({
      from_id: p.from.id, to_id: p.to.id,
      from_acct: p.from.bank_account, to_acct: p.to.bank_account,
      amount: Number(p.from.debit), from_date: p.from.date, to_date: p.to.date,
    })),
    ambiguous: ambiguous.map((p) => ({ from: slim(p.from, 'debit'), to: slim(p.to, 'credit') })),
  }
}
