// app/api/reconcile/lists/route.ts
// Gestiona las listas de Cuentas, Categorías y Proveedores que aparecen
// en los menús del Libro Diario y en Ajustes → Cuentas y bancos.
// GET  -> { accounts: [{id,name}], categories: [...], vendors: [...] }
// POST { list: 'accounts'|'categories'|'vendors', name } -> { item }
// DELETE ?list=...&id=... -> { ok: true }
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

const TABLES: Record<string, string> = {
  accounts: 'bank_accounts',
  categories: 'categories',
  vendors: 'vendors',
}

export async function GET() {
  try {
    const sb = supabaseServer()
    const out: any = {}
    for (const [key, table] of Object.entries(TABLES)) {
      const { data, error } = await sb.from(table).select('id,name').order('name')
      if (error) throw error
      out[key] = data
    }
    return NextResponse.json(out)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { list, name } = await req.json()
    const table = TABLES[list]
    if (!table || !name?.trim()) {
      return NextResponse.json({ error: 'Lista o nombre inválido' }, { status: 400 })
    }
    const sb = supabaseServer()
    const { data, error } = await sb.from(table).insert({ name: name.trim() }).select().single()
    if (error) {
      if (String(error.message).includes('duplicate')) {
        return NextResponse.json({ error: 'Ya existe ese nombre' }, { status: 409 })
      }
      throw error
    }
    return NextResponse.json({ item: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const list = req.nextUrl.searchParams.get('list') || ''
    const id = req.nextUrl.searchParams.get('id') || ''
    const table = TABLES[list]
    if (!table || !id) {
      return NextResponse.json({ error: 'Lista o id inválido' }, { status: 400 })
    }
    const sb = supabaseServer()
    const { error } = await sb.from(table).delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
