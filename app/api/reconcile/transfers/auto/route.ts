// app/api/reconcile/transfers/auto/route.ts
// POST -> ejecuta el auto-enlace de transferencias a su origen (solo emparejamientos únicos)
// GET  -> dry run: cuenta cuántos enlazaría sin guardar nada
import { NextRequest, NextResponse } from 'next/server'
import { autoLinkTransfers } from '@/lib/auto-link'

export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(await autoLinkTransfers())
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await autoLinkTransfers({ dryRun: true }))
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
