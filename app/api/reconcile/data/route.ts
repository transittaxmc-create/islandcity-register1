// app/api/reconcile/data/route.ts
// CRUD del Estado Bancario.
// GET: movimientos reales del mes + filas proyectadas del mes (generadas en vivo).
// POST: crea una fila (real o proyectada). Si la frecuencia es recurrente, genera el mes.
// PATCH: edita una fila inline (real o proyectada).
// DELETE: borra una fila real (o una ocurrencia proyectada, que solo vive en memoria).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

const TX = 'bank_transactions'
const RP = 'recurring_projections'

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const start = `${ym}-01`
  const last = new Date(y, m, 0).getDate()
  return { start, end: `${ym}-${String(last).padStart(2, '0')}` }
}

function occurrences(rule: any, start: string, end: string) {
  // Genera las ocurrencias del mes para una regla recurrente.
  // 'Hasta cuándo': si la regla trae end_date, no genera más allá de esa fecha.
  const out: any[] = []
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  let effEnd = e
  if (rule.end_date && typeof rule.end_date === 'string') {
    const rd = new Date(rule.end_date + 'T12:00:00')
    if (!isNaN(rd.getTime()) && rd < effEnd) effEnd = rd
  }
  const push = (d: Date) => {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (iso >= start && iso <= end) out.push({ ...rule, occurrence_date: iso })
  }
  if (rule.frequency === 'Un solo pago') {
    const d = new Date(rule.pay_day + 'T12:00:00')
    if (!isNaN(d.getTime())) push(d)
    return out
  }
  // pay_day puede ser 'YYYY-MM-DD' (inicio) o número de día del mes.
  let cursor: Date
  const asDate = new Date(rule.pay_day + 'T12:00:00')
  if (!isNaN(asDate.getTime())) cursor = new Date(asDate)
  else {
    const day = Math.min(parseInt(rule.pay_day) || 1, 28)
    cursor = new Date(s.getFullYear(), s.getMonth(), day, 12)
  }
  let guard = 0
  while (cursor <= effEnd && guard++ < 400) {
    push(cursor)
    if (rule.frequency === 'Diaria') cursor.setDate(cursor.getDate() + 1)
    else if (rule.frequency === 'Semanal') cursor.setDate(cursor.getDate() + 7)
    else if (rule.frequency === 'Mensual') cursor.setMonth(cursor.getMonth() + 1)
    else if (rule.frequency === 'Anual') cursor.setFullYear(cursor.getFullYear() + 1)
    else break
  }
  return out
}

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const ym = req.nextUrl.searchParams.get('month') || new Date().toISOString().slice(0, 7)
    const { start, end } = monthRange(ym)

    const { data: txs, error: e1 } = await sb.from(TX)
      .select('*').gte('date', start).lte('date', end).order('date', { ascending: true })
    if (e1) throw e1

    const { data: rules, error: e2 } = await sb.from(RP).select('*')
    if (e2) throw e2

    const projected: any[] = []
    for (const r of rules || []) {
      for (const o of occurrences(r, start, end)) {
        projected.push({
          id: o.id + '::' + o.occurrence_date,
          rule_id: o.id,
          date: o.occurrence_date,
          bank_account: 'Cuenta principal',
          detail: o.concept,
          category: (r as any).category || 'Proyección',
          frequency: o.frequency,
          entry_type: 'proyectado',
          debit: o.type === 'gasto' ? Number(o.amount) : 0,
          credit: o.type === 'ingreso' ? Number(o.amount) : 0,
          daily_balance: 0,
          has_receipt: false,
        })
      }
    }
    projected.sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({ transactions: txs || [], projected })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const b = await req.json()
    const {
      date, bank_account = 'Cuenta principal', detail = '', category = 'Otro',
      frequency = 'Un solo pago', debit = 0, credit = 0, entry_type = 'real',
    } = b

    if (entry_type === 'proyectado') {
      // Se guarda como REGLA recurrente; las filas del mes se generan en el GET.
      const type = Number(credit) > 0 ? 'ingreso' : 'gasto'
      const amount = Math.abs(Number(credit) > 0 ? credit : debit)
      const end_date = (b as any).end_date && String((b as any).end_date).match(/^\d{4}-\d{2}-\d{2}$/)
        ? String((b as any).end_date)
        : null
      // end_date y category pueden no existir aún como columnas: se intenta con ellas y se reintenta sin ellas.
      const payload: any = { concept: detail, frequency, pay_day: date, amount, type }
      const cat = String(category || '').trim()
      if (cat) payload.category = cat
      if (end_date) payload.end_date = end_date
      let data: any = null
      let error: any = null
      ;({ data, error } = await sb.from(RP).insert(payload).select().single())
      if (error && /category/i.test(error.message || '')) {
        delete payload.category
        ;({ data, error } = await sb.from(RP).insert(payload).select().single())
      }
      if (error && end_date && /end_date/i.test(error.message || '')) {
        delete payload.end_date
        ;({ data, error } = await sb.from(RP).insert(payload).select().single())
      }
      if (error) throw error
      return NextResponse.json({ rule: data })
    }

    // Fila real: calcula el balance del día, POR CUENTA.
    const { data: prev } = await sb.from(TX)
      .select('daily_balance').eq('bank_account', bank_account).lte('date', date)
      .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(1)
    const prevBal = prev?.[0]?.daily_balance ? Number(prev[0].daily_balance) : 0
    const bal = prevBal + Number(credit) - Number(debit)

    const { data, error } = await sb.from(TX).insert({
      date, bank_account, detail, category, frequency, entry_type: 'real',
      debit: Number(debit), credit: Number(credit), daily_balance: bal,
    }).select().single()
    if (error) throw error
    return NextResponse.json({ transaction: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const b = await req.json()
    const { id, field, value } = b as { id: string; field: string; value: any }
    const allowed = ['date', 'bank_account', 'detail', 'category', 'frequency', 'debit', 'credit', 'pb_class', 'daily_balance', 'end_date']
    if (!allowed.includes(field)) return NextResponse.json({ error: 'Campo no permitido' }, { status: 400 })

    if (String(id).includes('::')) {
      // Editar una ocurrencia proyectada = editar la regla base.
      const ruleId = String(id).split('::')[0]
      const patch: any = {}
      if (field === 'detail') patch.concept = value
      else if (field === 'date') patch.pay_day = value
      else if (field === 'frequency') patch.frequency = value
      else if (field === 'end_date') patch.end_date = value || null
      else if (field === 'debit' || field === 'credit') {
        patch.amount = Math.abs(Number(value))
        patch.type = field === 'credit' ? 'ingreso' : 'gasto'
      } else patch[field] = value
      const { error } = await sb.from(RP).update(patch).eq('id', ruleId)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    const patch: any = { [field]: value, updated_at: new Date().toISOString() }
    const { error } = await sb.from(TX).update(patch).eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sb = supabaseServer()
    const id = req.nextUrl.searchParams.get('id') || ''
    // ID de regla: con '::' (ocurrencia) o sin él (borrado directo desde Proyecciones).
    const ruleId = id.includes('::') ? id.split('::')[0] : id
    const { data: rpDel } = await sb.from(RP).delete().eq('id', ruleId).select('id')
    if (rpDel && rpDel.length > 0) return NextResponse.json({ ok: true, deleted: 'rule' })
    const { error } = await sb.from(TX).delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true, deleted: 'transaction' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
