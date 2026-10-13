import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const vendor = typeof json.vendor === 'string' ? json.vendor.trim() : ''
    const amount = Number(json.amount)
    const date = typeof json.date === 'string' ? json.date : ''
    const dueDate = typeof json.dueDate === 'string' ? json.dueDate : ''
    const category = typeof json.category === 'string' ? json.category : ''
    const notes = typeof json.notes === 'string' ? json.notes : ''
    const source = typeof json.source === 'string' ? json.source : 'claris-scan'
    const externalId = typeof json.externalId === 'string' ? json.externalId : null

    if (!vendor || typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid payload: vendor and positive amount required' }, { status: 400 })
    }
    if (!dueDate && !date) {
      return NextResponse.json({ error: 'Invalid payload: dueDate or date required' }, { status: 400 })
    }

    const sb = supabaseServer()
    const pay_day = dueDate || date || new Date().toISOString().slice(0,10)
    const end_date = dueDate || pay_day

    // Insert as a one-time gasto projection with pending status semantics
    const concept = category ? `${vendor} • ${category}` : vendor
    const base = {
      concept,
      amount: Math.round(amount * 100) / 100,
      type: 'gasto',
      frequency: 'Un solo pago',
      pay_day,
      end_date,
    }

    // Try with traceability columns first (added via migration_add_source_status.sql).
    // If the migration hasn't been applied yet, fall back to the base columns so
    // the scan push still succeeds.
    const withMeta = {
      ...base,
      source,
      external_id: externalId,
      status: 'pending',
    }

    let insert = await sb.from('recurring_projections').insert(withMeta).select().single()
    if (insert.error && /column|does not exist|source|external_id|status/i.test(insert.error.message)) {
      insert = await sb.from('recurring_projections').insert(base).select().single()
    }

    if (insert.error) {
      console.error('[ingest/bill-scan] Supabase insert error', insert.error)
      return NextResponse.json({ error: 'DB insert failed', details: insert.error.message }, { status: 500 })
    }

    const data = insert.data

    return NextResponse.json({
      success: true,
      projectionId: data.id,
      vendor,
      amount,
      dueDate: pay_day,
      category,
      notes,
      source,
      externalId,
      status: 'pending',
    })
  } catch (err: any) {
    console.error('[ingest/bill-scan] error', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
