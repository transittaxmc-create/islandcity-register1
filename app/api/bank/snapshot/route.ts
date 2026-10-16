// app/api/bank/snapshot/route.ts
// Read-only bank snapshot for the claris DUAL REGISTER panel (shared Supabase).
// GET /api/bank/snapshot?key=... — protected by BANK_FEED_KEY.
// The key never reaches a browser: claris calls this server-side through its
// own /api/bank/snapshot proxy route.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const num = (v: any): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

export async function GET(req: NextRequest) {
  try {
    const feedKey = process.env.BANK_FEED_KEY
    const key = new URL(req.url).searchParams.get('key')
    if (!feedKey || key !== feedKey) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const sb = supabaseServer()
    const { data: accs, error: aerr } = await sb
      .from('bank_accounts')
      .select('name,current_balance,institution,balance_updated_at')
      .order('name')
    if (aerr) throw aerr
    const { data: txs, error: terr } = await sb
      .from('bank_transactions')
      .select('date,bank_account,detail,category,debit,credit,daily_balance')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(40)
    if (terr) throw terr
    const accounts = (accs || []).map((a: any) => ({
      name: a.name,
      current_balance: num(a.current_balance),
      institution: a.institution || null,
      balance_updated_at: a.balance_updated_at || null,
    }))
    const total_balance = Math.round(accounts.reduce((s: number, a: any) => s + a.current_balance, 0) * 100) / 100
    const transactions = (txs || []).map((t: any) => ({
      date: t.date,
      bank_account: t.bank_account,
      detail: t.detail,
      category: t.category || null,
      amount: Math.round(((num(t.credit) - num(t.debit)) * 100)) / 100,
      daily_balance: t.daily_balance === null || t.daily_balance === undefined ? null : num(t.daily_balance),
    }))
    return NextResponse.json(
      { as_of: new Date().toISOString(), total_balance, accounts, transactions },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'snapshot failed' }, { status: 500 })
  }
}
