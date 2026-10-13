// app/api/daily/import/route.ts
// Recibe viajes cerrados desde la app claris (auto-sync) para el DAILY Entry Register.
// POST: objeto viaje o arreglo (o { trips: [...] }).
//   { tripId, platform, gross, net, tips, toll, extraCash, platformFee, time, date, source }
// Idempotente por tripId (upsert). No toca viajes ya cerrados.
// Además mantiene al día el bill de EZ-Pass: por cada fecha afectada suma los tolls
// de los viajes y crea/actualiza UN gasto proyectado ("EZ-Pass", Un solo pago).
// Requiere la tabla daily_trips (ver SQL de setup); sin ella responde 503 sin inventar nada.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const TABLE = 'daily_trips'
const RP = 'recurring_projections'
const EZ_CONCEPT = 'EZ-Pass'
const EZ_CAT = 'Tolls'

const num = (v: any): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}
const cleanDate = (v: any): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null

async function upsertEzPass(sb: any, date: string): Promise<{ date: string; total: number } | null> {
  const { data: rows, error } = await sb.from(TABLE).select('toll').eq('trip_date', date)
  if (error) throw error
  const total = Math.round((rows || []).reduce((s: number, r: any) => s + num(r.toll), 0) * 100) / 100
  const { data: ex } = await sb
    .from(RP)
    .select('id')
    .eq('concept', EZ_CONCEPT)
    .eq('pay_day', date)
    .eq('frequency', 'Un solo pago')
    .maybeSingle()
  if (total <= 0) {
    if (ex?.id) await sb.from(RP).delete().eq('id', ex.id)
    return null
  }
  if (ex?.id) {
    const { error: uerr } = await sb.from(RP).update({ amount: total }).eq('id', ex.id)
    if (uerr) throw uerr
    return { date, total }
  }
  const payload: any = {
    concept: EZ_CONCEPT,
    frequency: 'Un solo pago',
    pay_day: date,
    amount: total,
    type: 'gasto',
    category: EZ_CAT,
  }
  let ins = await sb.from(RP).insert(payload).select('id').single()
  if (ins.error && /category/i.test(ins.error.message || '')) {
    delete payload.category
    ins = await sb.from(RP).insert(payload).select('id').single()
  }
  if (ins.error) throw ins.error
  return { date, total }
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer()
    // La tabla debe existir; si no, 503 claro (el que llama reintenta después).
    const probe = await sb.from(TABLE).select('trip_id').limit(1)
    if (probe.error) {
      if (/relation|does not exist|schema cache/i.test(probe.error.message || '')) {
        return NextResponse.json(
          { error: 'daily_trips table not found. Run the setup SQL first.', needsSetup: true },
          { status: 503 }
        )
      }
      throw probe.error
    }

    const body = await req.json()
    const list: any[] = Array.isArray(body) ? body : Array.isArray(body?.trips) ? body.trips : [body]

    const dates = new Set<string>()
    let imported = 0
    let skipped = 0
    for (const t of list) {
      const tripId = String(t?.tripId || t?.trip_id || '').trim()
      const date = cleanDate(t?.date)
      const platform = String(t?.platform || '').trim()
      if (!tripId || !date || !platform) {
        skipped++
        continue
      }
      // No tocar viajes ya cerrados: las correcciones posteriores se hacen en Proyecciones.
      const { data: existing } = await sb.from(TABLE).select('trip_id,status').eq('trip_id', tripId).maybeSingle()
      if (existing?.status === 'closed') {
        skipped++
        continue
      }
      const row = {
        trip_id: tripId,
        platform,
        gross: num(t.gross),
        net: num(t.net),
        tips: num(t.tips),
        toll: num(t.toll),
        extra_cash: num(t.extraCash ?? t.extra_cash),
        platform_fee: num(t.platformFee ?? t.platform_fee),
        trip_time: String(t.time || ''),
        trip_date: date,
        deposit_date: cleanDate(t.depositDate) || date,
        status: 'open',
        updated_at: new Date().toISOString(),
      }
      const { error } = await sb.from(TABLE).upsert(row, { onConflict: 'trip_id' })
      if (error) throw error
      imported++
      dates.add(date)
    }

    const ezpass: any[] = []
    for (const d of dates) {
      const r = await upsertEzPass(sb, d)
      if (r) ezpass.push(r)
    }

    return NextResponse.json({ ok: true, imported, skipped, ezpass })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error' }, { status: 500 })
  }
}
