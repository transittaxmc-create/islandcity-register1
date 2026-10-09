// app/api/reconcile/plaid-import/route.ts
// Recibe movimientos de Plaid (enviados por el asistente) y los guarda
// en bank_transactions con deduplicación. Crea las cuentas si no existen.
// POST { transactions: [{ date, account, detail, debit, credit }] }
//   -> { imported, duplicates }
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const { transactions } = await req.json()
    if (!Array.isArray(transactions)) {
      return NextResponse.json({ error: 'Sin movimientos' }, { status: 400 })
    }
    const sb = supabaseServer()

    // Asegura las cuentas
    const accounts = [...new Set(transactions.map((t: any) => t.account).filter(Boolean))]
    const { data: existingAccs } = await sb.from('bank_accounts').select('name')
    const accNames = new Set((existingAccs || []).map((a: any) => a.name))
    for (const a of accounts) {
      if (!accNames.has(a)) {
        await sb.from('bank_accounts').insert({ name: a })
        accNames.add(a)
      }
    }

    let imported = 0, duplicates = 0
    for (const t of transactions) {
      const { date, account, detail, debit, credit } = t
      if (!date || !detail) continue
      const amt = debit || credit || 0
      if (!amt) continue
      const col = debit ? 'debit' : 'credit'

      // Dedup: ±2 días, ±1 centavo, detalle parecido
      const d0 = new Date(date + 'T12:00:00')
      const minus2 = new Date(d0); minus2.setDate(minus2.getDate() - 2)
      const plus2 = new Date(d0); plus2.setDate(plus2.getDate() + 2)
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const { data: cands } = await sb.from('bank_transactions')
        .select('id,detail')
        .gte('date', iso(minus2)).lte('date', iso(plus2))
        .gte(col, amt - 0.01).lte(col, amt + 0.01)
        .limit(10)
      const dl = detail.toLowerCase()
      const dup = (cands || []).some((c: any) => {
        const cl = (c.detail || '').toLowerCase()
        return cl && dl && (cl.slice(0, 15) === dl.slice(0, 15) || cl.includes(dl.slice(0, 12)) || dl.includes(cl.slice(0, 12)))
      })
      if (dup) { duplicates++; continue }

      const { error: insErr } = await sb.from('bank_transactions').insert({
        date, bank_account: account || 'Cuenta principal',
        detail: String(detail).slice(0, 200), category: 'Otro',
        debit: debit || null, credit: credit || null,
      })
      if (insErr) throw new Error('Insert: ' + insErr.message)
      imported++
    }
    return NextResponse.json({ imported, duplicates })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
