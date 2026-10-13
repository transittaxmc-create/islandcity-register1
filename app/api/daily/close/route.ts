// app/api/daily/close/route.ts
// Cierre POR GRUPO (plataforma) del DAILY Entry Register.
// POST { platform, deposit_date?, date_overrides?: { [trip_id]: YYYY-MM-DD } }:
//   - toma los viajes ABIERTOS de esa plataforma (filtrados por deposit_date si se da),
//   - aplica date_overrides primero (corrige fechas de depósito),
//   - los agrupa por deposit_date,
//   - crea UN depósito proyectado (pago único, concepto "DAILY · {platform}") por grupo,
//   - marca los viajes como cerrados (ya no editables en el DAILY).
// El ingreso nunca se duplica: la regla proyectada se empareja luego con el depósito real.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const TABLE = 'daily_trips'
const RP = 'recurring_projections'
const DAILY_PREFIX = 'DAILY \u00b7 '
const DAILY_CAT = 'Depósito plataforma'

const num = (v: any): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}
const cleanDate = (v: any): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null

async function createDepositRule(sb: any, platform: string, payDay: string, total: number): Promise<string> {
  const payload: any = {
    concept: `${DAILY_PREFIX}${platform}`,
    frequency: 'Un solo pago',
    pay_day: payDay,
    amount: total,
    type: 'ingreso',
    category: DAILY_CAT,
  }
  let ins = await sb.from(RP).insert(payload).select('id').single()
  if (ins.error && /category/i.test(ins.error.message || '')) {
    delete payload.category
    ins = await sb.from(RP).insert(payload).select('id').single()
  }
  if (ins.error) throw ins.error
  return String(ins.data.id)
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const b = await req.json()
    const platform = String(b?.platform || '').trim()
    if (!platform) return NextResponse.json({ error: 'platform requerida' }, { status: 400 })
    const depFilter = b?.deposit_date !== undefined ? cleanDate(b.deposit_date) : null
    if (b?.deposit_date !== undefined && !depFilter) {
      return NextResponse.json({ error: 'deposit_date inválida' }, { status: 400 })
    }

    let q = sb.from(TABLE).select('*').eq('platform', platform).eq('status', 'open')
    if (depFilter) q = q.eq('deposit_date', depFilter)
    const { data: trips, error } = await q
    if (error) {
      if (/relation|does not exist|schema cache/i.test(error.message || '')) {
        return NextResponse.json({ error: 'daily_trips table not found. Run the setup SQL first.', needsSetup: true }, { status: 503 })
      }
      throw error
    }
    if (!trips || trips.length === 0) {
      return NextResponse.json({ error: 'No hay viajes abiertos para esa plataforma' }, { status: 404 })
    }

    // Correcciones de fecha de depósito enviadas con el cierre.
    const overrides = b?.date_overrides && typeof b.date_overrides === 'object' ? b.date_overrides : {}
    for (const t of trips) {
      const od = cleanDate(overrides[t.trip_id])
      if (od && od !== t.deposit_date) t.deposit_date = od
    }
    const changed = trips.filter((t: any) => {
      const od = cleanDate(overrides[t.trip_id])
      return od !== null
    })
    for (const t of changed) {
      const { error: uerr } = await sb.from(TABLE).update({ deposit_date: t.deposit_date, updated_at: new Date().toISOString() }).eq('trip_id', t.trip_id)
      if (uerr) throw uerr
    }

    // Agrupa por fecha de depósito: un depósito proyectado por grupo.
    const groups = new Map<string, any[]>()
    for (const t of trips) {
      const d = cleanDate(t.deposit_date) || cleanDate(t.trip_date) || ''
      if (!groups.has(d)) groups.set(d, [])
      groups.get(d)!.push(t)
    }

    const closed: any[] = []
    for (const [depDate, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const total = Math.round(items.reduce((s: number, t: any) => s + num(t.net), 0) * 100) / 100
      if (total <= 0) continue
      const ruleId = await createDepositRule(sb, platform, depDate, total)
      const ids = items.map((t: any) => t.trip_id)
      const { error: uerr } = await sb
        .from(TABLE)
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .in('trip_id', ids)
      if (uerr) throw uerr
      closed.push({
        platform,
        deposit_date: depDate,
        total,
        count: items.length,
        rule_id: ruleId,
        trip_ids: ids,
      })
    }

    return NextResponse.json({ ok: true, closed })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error' }, { status: 500 })
  }
}
