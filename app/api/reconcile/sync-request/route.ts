// app/api/reconcile/sync-request/route.ts
// Solicita una sincronización manual con el banco (Plaid).
// POST -> { id } (crea solicitud pendiente)
// GET ?id= -> { status, result }
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST() {
  try {
    const sb = supabaseServer()
    const { data, error } = await sb.from('sync_requests')
      .insert({ status: 'pending' }).select('id').single()
    if (error) throw error
    return NextResponse.json({ id: data.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status, result } = await req.json()
    if (!id || !status) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 })
    const sb = supabaseServer()
    const { error } = await sb.from('sync_requests').update({
      status, result: result || null,
      completed_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseServer()
    if (req.nextUrl.searchParams.get('pending') === 'true') {
      const { data, error } = await sb.from('sync_requests')
        .select('id,created_at').eq('status', 'pending')
        .order('created_at', { ascending: true }).limit(5)
      if (error) throw error
      return NextResponse.json({ pending: data || [] })
    }
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Sin id' }, { status: 400 })
    const { data, error } = await sb.from('sync_requests')
      .select('status,result').eq('id', id).single()
    if (error) throw error
    return NextResponse.json({ status: data.status, result: data.result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
