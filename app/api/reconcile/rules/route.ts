// app/api/reconcile/rules/route.ts
// Edición de proyecciones guardadas con alcance (scope).
// POST { action?, ruleId, pivot, scope, values }
//   action 'delete-occurrence': borra UNA ocurrencia (solo esa fecha); la regla
//     sigue generando las demás. Si era 'Un solo pago' (o era la única), borra la regla.
//   action omitida (edición):
//     pivot: 'YYYY-MM-DD' — ocurrencia que se está editando.
//     scope:
//       'solo'     -> solo esa ocurrencia cambia (se parte la serie: un pago único + resto intacto)
//       'atras'    -> esta y las pasadas toman los valores nuevos; las futuras conservan los viejos
//       'adelante' -> esta y las futuras toman los valores nuevos; las pasadas conservan los viejos
//       'todas'    -> se actualiza la regla completa
//     values: { concept, amount, type: 'ingreso'|'gasto', frequency, pay_day, end_date, category }
// La división de la serie se hace con end_date / pay_day (columnas existentes).
// NUNCA toca bank_transactions: solo proyecciones.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

const RP = 'recurring_projections'

const cleanDate = (v: any): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoOf(d)
}

// Genera las fechas de ocurrencia de una regla en una ventana.
// Misma lógica que /api/reconcile/data (occurrences), con límite generoso.
function genOccurrences(rule: any, start: string, end: string): string[] {
  const out: string[] = []
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  let effEnd = e
  const rd = cleanDate(rule.end_date)
  if (rd) {
    const d = new Date(rd + 'T12:00:00')
    if (!isNaN(d.getTime()) && d < effEnd) effEnd = d
  }
  const push = (d: Date) => {
    const dIso = isoOf(d)
    if (dIso >= start && dIso <= end) out.push(dIso)
  }
  if (String(rule.frequency) === 'Un solo pago') {
    const d = new Date(String(rule.pay_day) + 'T12:00:00')
    if (!isNaN(d.getTime())) push(d)
    return out
  }
  let cursor: Date
  const asDate = new Date(String(rule.pay_day) + 'T12:00:00')
  if (!isNaN(asDate.getTime())) cursor = new Date(asDate)
  else {
    const day = Math.min(parseInt(String(rule.pay_day)) || 1, 28)
    cursor = new Date(s.getFullYear(), s.getMonth(), day, 12)
  }
  const freq = String(rule.frequency)
  let guard = 0
  while (cursor <= effEnd && guard++ < 5000) {
    push(cursor)
    if (freq === 'Diaria') cursor.setDate(cursor.getDate() + 1)
    else if (freq === 'Semanal') cursor.setDate(cursor.getDate() + 7)
    else if (freq === 'Mensual') cursor.setMonth(cursor.getMonth() + 1)
    else if (freq === 'Anual') cursor.setFullYear(cursor.getFullYear() + 1)
    else break
  }
  return out.sort()
}

// Vecinos del pivote dentro de la serie (para partirla sin tocar el resto).
function neighbors(rule: any, pivot: string): { prev: string | null; next: string | null } {
  if (String(rule.frequency) === 'Un solo pago') return { prev: null, next: null }
  const occs = genOccurrences(rule, addDays(pivot, -400), addDays(pivot, 400))
  let prev: string | null = null
  let next: string | null = null
  for (const d of occs) {
    if (d < pivot) prev = d
    else if (d > pivot && !next) next = d
  }
  return { prev, next }
}

async function insertRule(sb: any, payload: any) {
  let res = await sb.from(RP).insert(payload).select().single()
  if (res.error && /category/i.test(res.error.message || '')) {
    delete payload.category
    res = await sb.from(RP).insert(payload).select().single()
  }
  if (res.error) throw new Error(res.error.message)
  return res.data
}

async function updateRule(sb: any, id: string, patch: any) {
  let res = await sb.from(RP).update(patch).eq('id', id)
  if (res.error && /category/i.test(res.error.message || '')) {
    delete patch.category
    res = await sb.from(RP).update(patch).eq('id', id)
  }
  if (res.error) throw new Error(res.error.message)
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const b = await req.json()
    const { ruleId, pivot, scope, values, action } = b as {
      ruleId: string
      pivot: string
      scope: 'solo' | 'atras' | 'adelante' | 'todas'
      values: any
      action?: string
    }
    const D = cleanDate(pivot)
    if (!ruleId || !D) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    const { data: rule, error: e0 } = await sb.from(RP).select('*').eq('id', ruleId).single()
    if (e0 || !rule) return NextResponse.json({ error: 'Regla no encontrada' }, { status: 404 })
    const rid = String(rule.id)

    // Borrar una sola ocurrencia: se parte la serie sin reemplazo; la regla sigue generando el resto.
    if (action === 'delete-occurrence') {
      const freq = String(rule.frequency || '')
      if (freq === 'Un solo pago') {
        const { error: eDel } = await sb.from(RP).delete().eq('id', rid)
        if (eDel) throw new Error(eDel.message)
        return NextResponse.json({ ok: true, deleted: 'rule' })
      }
      const oldR = {
        concept: String(rule.concept || ''),
        amount: Math.abs(Number(rule.amount) || 0),
        type: rule.type === 'ingreso' ? 'ingreso' : 'gasto',
        frequency: freq,
        pay_day: String(rule.pay_day || ''),
        end_date: cleanDate(rule.end_date),
        category: rule.category ? String(rule.category) : undefined,
      }
      const { prev: Dprev, next: Dnext } = neighbors(oldR, D)
      if (!Dprev && !Dnext) {
        const { error: eDel } = await sb.from(RP).delete().eq('id', rid)
        if (eDel) throw new Error(eDel.message)
        return NextResponse.json({ ok: true, deleted: 'rule' })
      }
      const keepVals: any = {
        concept: oldR.concept,
        amount: oldR.amount,
        type: oldR.type,
        frequency: oldR.frequency,
        end_date: oldR.end_date,
      }
      if (oldR.category) keepVals.category = oldR.category
      if (Dprev && Dnext) {
        await updateRule(sb, rid, { end_date: Dprev })
        await insertRule(sb, { ...keepVals, pay_day: Dnext })
      } else if (Dprev) {
        await updateRule(sb, rid, { end_date: Dprev })
      } else {
        await updateRule(sb, rid, { pay_day: Dnext })
      }
      return NextResponse.json({ ok: true, deleted: 'occurrence' })
    }

    if (!['solo', 'atras', 'adelante', 'todas'].includes(scope)) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    const concept = String(values?.concept || '').trim()
    const amount = Math.abs(Number(values?.amount) || 0)
    const type = values?.type === 'ingreso' ? 'ingreso' : 'gasto'
    const frequency = String(values?.frequency || rule.frequency || 'Mensual')
    const endDate = cleanDate(values?.end_date)
    const cat = String(values?.category || '').trim()
    // Monto 0 permitido: día programado sin trabajo (la fila en 0 queda visible).
    if (!concept || Number.isNaN(amount)) {
      return NextResponse.json({ error: 'Concepto y monto requeridos' }, { status: 400 })
    }

    const old = {
      concept: String(rule.concept || ''),
      amount: Math.abs(Number(rule.amount) || 0),
      type: rule.type === 'ingreso' ? 'ingreso' : 'gasto',
      frequency: String(rule.frequency || ''),
      pay_day: String(rule.pay_day || ''),
      end_date: cleanDate(rule.end_date),
      category: rule.category ? String(rule.category) : undefined,
    }
    // Valores nuevos (lo que el usuario dejó en la fila de entrada).
    const newVals: any = { concept, amount, type, frequency, end_date: endDate }
    if (cat) newVals.category = cat
    // Valores viejos (para conservar el lado de la serie que no cambia).
    const oldVals: any = {
      concept: old.concept,
      amount: old.amount,
      type: old.type,
      frequency: old.frequency,
      end_date: old.end_date,
    }
    if (old.category) oldVals.category = old.category

    // 'Un solo pago' o 'todas': no hay serie que partir, se actualiza directo.
    if (old.frequency === 'Un solo pago' || scope === 'todas') {
      const patch: any = { ...newVals }
      patch.pay_day = old.frequency === 'Un solo pago' ? cleanDate(values?.pay_day) || old.pay_day : old.pay_day
      await updateRule(sb, rid, patch)
      return NextResponse.json({ ok: true, scope })
    }

    const { prev: Dprev, next: Dnext } = neighbors(old, D)

    if (scope === 'solo') {
      // Solo esa ocurrencia: un pago único con los valores nuevos + la serie vieja sin ese día.
      if (!Dprev && !Dnext) {
        await updateRule(sb, rid, { ...newVals })
        return NextResponse.json({ ok: true, scope })
      }
      await insertRule(sb, { ...newVals, frequency: 'Un solo pago', pay_day: D, end_date: D })
      if (Dprev && Dnext) {
        await updateRule(sb, rid, { end_date: Dprev })
        await insertRule(sb, { ...oldVals, pay_day: Dnext })
      } else if (Dprev) {
        await updateRule(sb, rid, { end_date: Dprev })
      } else {
        await updateRule(sb, rid, { pay_day: Dnext })
      }
      return NextResponse.json({ ok: true, scope })
    }

    if (scope === 'atras') {
      // Esta y las pasadas: valores nuevos hasta D; las futuras conservan los viejos.
      await updateRule(sb, rid, { ...newVals, end_date: D })
      if (Dnext) await insertRule(sb, { ...oldVals, pay_day: Dnext })
      return NextResponse.json({ ok: true, scope })
    }

    // 'adelante': esta y las futuras con valores nuevos; las pasadas conservan los viejos.
    if (!Dprev) {
      await updateRule(sb, rid, { ...newVals, pay_day: D, end_date: endDate || old.end_date })
      return NextResponse.json({ ok: true, scope })
    }
    await updateRule(sb, rid, { end_date: Dprev })
    await insertRule(sb, { ...newVals, pay_day: D, end_date: endDate || old.end_date })
    return NextResponse.json({ ok: true, scope })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error' }, { status: 500 })
  }
}
