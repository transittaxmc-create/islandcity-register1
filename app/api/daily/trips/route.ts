// app/api/daily/trips/route.ts
// Lectura y verificación de los viajes del DAILY Entry Register (auto-sync desde claris).
// GET ?status=open|closed|all&date=YYYY-MM-DD -> { trips }
// PATCH { trip_id, deposit_date?, platform?, gross?, net?, tips?, toll?, extra_cash?, platform_fee? }
//   Solo viajes abiertos. Si cambia el toll, se recalcula el bill de EZ-Pass del día.
// DELETE ?trip_id= -> borra el viaje (solo si está abierto).
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

async function refreshEzPass(sb: any, date: string): Promise<void> {
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
    return
  }
  if (ex?.id) {
    const { error: uerr } = await sb.from(RP).update({ amount: total }).eq('id', ex.id)
    if (uerr) throw uerr
    return
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
}

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const sp = req.nextUrl.searchParams
    const status = sp.get('status') || 'open'
    const date = cleanDate(sp.get('date'))
    let q = sb.from(TABLE).select('*').order('trip_date', { ascending: false }).order('created_at', { ascending: true })
    if (status === 'open' || status === 'closed') q = q.eq('status', status)
    if (date) q = q.eq('trip_date', date)
    const { data, error } = await q.limit(500)
    if (error) {
      if (/relation|does not exist|schema cache/i.test(error.message || '')) {
        return NextResponse.json({ trips: [], needsSetup: true })
      }
      throw error
    }
    return NextResponse.json({ trips: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const b = await req.json()
    const tripId = String(b?.trip_id || '').trim()
    if (!tripId) return NextResponse.json({ error: 'trip_id requerido' }, { status: 400 })
    const { data: cur, error: gerr } = await sb.from(TABLE).select('*').eq('trip_id', tripId).single()
    if (gerr) throw gerr
    if (!cur || cur.status === 'closed') {
      return NextResponse.json({ error: 'El viaje ya está cerrado (edítalo en Proyecciones)' }, { status: 409 })
    }
    const patch: any = { updated_at: new Date().toISOString() }
    if (b.deposit_date !== undefined) {
      const d = cleanDate(b.deposit_date)
      if (!d) return NextResponse.json({ error: 'deposit_date inválida' }, { status: 400 })
      patch.deposit_date = d
    }
    if (b.platform !== undefined && String(b.platform).trim()) patch.platform = String(b.platform).trim()
    for (const k of ['gross', 'net', 'tips', 'toll', 'extra_cash', 'platform_fee'] as const) {
      if (b[k] !== undefined) patch[k] = num(b[k])
    }
    const { data, error } = await sb.from(TABLE).update(patch).eq('trip_id', tripId).select().single()
    if (error) throw error
    if (b.toll !== undefined) await refreshEzPass(sb, String(cur.trip_date))
    return NextResponse.json({ ok: true, trip: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const tripId = String(req.nextUrl.searchParams.get('trip_id') || '').trim()
    if (!tripId) return NextResponse.json({ error: 'trip_id requerido' }, { status: 400 })
    const { data: cur } = await sb.from(TABLE).select('trip_id,status,trip_date').eq('trip_id', tripId).single()
    if (!cur) return NextResponse.json({ ok: true, deleted: false })
    if (cur.status === 'closed') {
      return NextResponse.json({ error: 'El viaje ya está cerrado' }, { status: 409 })
    }
    const { error } = await sb.from(TABLE).delete().eq('trip_id', tripId)
    if (error) throw error
    await refreshEzPass(sb, String(cur.trip_date))
    return NextResponse.json({ ok: true, deleted: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error' }, { status: 500 })
  }
}
