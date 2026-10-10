// app/api/reconcile/account-balances/route.ts
// Guarda los balances reales reportados por Plaid en bank_accounts.
// POST { balances: [{ account, current }] }
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const { balances } = await req.json()
    if (!Array.isArray(balances)) return NextResponse.json({ error: 'Sin balances' }, { status: 400 })
    const sb = supabaseServer()
    let updated = 0
    for (const b of balances) {
      const name = String(b.account || '').trim()
      const cur = Number(b.current)
      if (!name || !isFinite(cur)) continue
      const now = new Date().toISOString()
      const inst = String(b.institution || '').trim() || null
      const { data: ex } = await sb.from('bank_accounts').select('id').eq('name', name).limit(1)
      if (ex && ex.length) {
        await sb.from('bank_accounts').update({ current_balance: cur, balance_updated_at: now, ...(inst ? { institution: inst } : {}) }).eq('id', ex[0].id)
      } else {
        await sb.from('bank_accounts').insert({ name, current_balance: cur, balance_updated_at: now, institution: inst })
      }
      updated++
    }
    return NextResponse.json({ updated })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
