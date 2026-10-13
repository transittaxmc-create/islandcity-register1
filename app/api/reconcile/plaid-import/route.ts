// app/api/reconcile/plaid-import/route.ts
// Recibe movimientos de Plaid (enviados por el asistente) y los guarda
// en bank_transactions con deduplicación. Crea las cuentas si no existen.
// POST { transactions: [{ date, account, detail, debit, credit }] }
//   -> { imported, duplicates }
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { extractCounterparty, normSender, heuristicKind } from '@/lib/transfer-sender'

// Chequeo de seguridad (no-Zelle): patrones explícitos de transferencia interna.
// Conservador: solo marca con evidencia clara en el detalle.
function isInternalTransfer(detail: string): boolean {
  const dl = (detail || '').toLowerCase().trim()
  if (dl.includes('account unload to card')) return true
  if (dl.includes('money transfer') && (dl.includes('••••7693') || dl.includes('paypal debit card') || dl.includes('mastercard debit card'))) return true
  if (/^(\d{1,2}\/\d{1,2}\/\d{4}\s+)?backup balance$/.test(dl)) return true
  if (/\btransfer\b/i.test(dl) && /\b(shares|checking|savings)\b/i.test(dl)) return true
  return false
}

// Memoria de remitentes: sender -> 'transfer' | 'payment'. null si no hay memoria/tabla.
async function senderMemoryKind(sb: any, norm: string): Promise<'transfer' | 'payment' | null> {
  try {
    const { data } = await sb.from('transfer_senders').select('kind').eq('sender', norm).limit(1)
    const k = data?.[0]?.kind
    return k === 'transfer' || k === 'payment' ? k : null
  } catch {
    return null
  }
}

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

      // Balance del día (igual que la ruta data), POR CUENTA.
      const { data: prev } = await sb.from('bank_transactions')
        .select('daily_balance').eq('bank_account', account || 'Cuenta principal').lte('date', date)
        .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(1)
      const prevBal = prev?.[0]?.daily_balance ? Number(prev[0].daily_balance) : 0
      const bal = prevBal + (credit || 0) - (debit || 0)

      // Clasificación por REMITENTE (Miguel): de dónde viene el dinero.
      // - Remitente propio -> transferencia interna (nunca ingreso)
      // - Plataforma -> ingreso (solo créditos)
      // - Desconocido/ambiguo -> 'Por verificar' (él confirma en la app, la AI aprende)
      let category = 'Otro'
      const cp = extractCounterparty(String(detail))
      if (cp) {
        const norm = normSender(cp)
        const kind = (await senderMemoryKind(sb, norm)) || heuristicKind(norm)
        if (kind === 'transfer') category = 'Transferencias Internas'
        else if (kind === 'payment' && credit) category = 'Ingresos'
        else if (!kind) category = 'Por verificar'
      } else if (isInternalTransfer(String(detail))) {
        category = 'Transferencias Internas'
      }

      const { error: insErr } = await sb.from('bank_transactions').insert({
        date, bank_account: account || 'Cuenta principal',
        detail: String(detail).slice(0, 200),
        category,
        debit: debit || null, credit: credit || null, daily_balance: bal,
        source: 'plaid',
      })
      if (insErr) throw new Error('Insert: ' + insErr.message)
      imported++
    }
    // Auto-enlace de transferencias a su origen (no rompe el import si falla;
    // el enlace se puede reintentar con POST /api/reconcile/transfers/auto)
    let autoLinked = 0
    try {
      const { autoLinkTransfers } = await import('@/lib/auto-link')
      autoLinked = (await autoLinkTransfers()).linked
    } catch { /* el import ya quedó guardado */ }
    return NextResponse.json({ imported, duplicates, autoLinked })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
