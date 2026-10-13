// app/api/reconcile/apply/route.ts
// Ejecuta cambios APROBADOS por Miguel (el asistente solo propone, él confirma).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const { proposals } = await req.json()
    if (!Array.isArray(proposals) || !proposals.length)
      return NextResponse.json({ error: 'Sin propuestas' }, { status: 400 })

    const sb = supabaseServer()
    const results: string[] = []
    for (const p of proposals) {
      if (p.action === 'cambiar_categoria' && p.args?.ids?.length && p.args?.categoria) {
        const { error, count } = await sb.from('bank_transactions')
          .update({ category: p.args.categoria }).in('id', p.args.ids)
        results.push(error ? `Error: ${error.message}` : `✅ Categoría "${p.args.categoria}" aplicada en ${count ?? p.args.ids.length} movimiento(s).`)
      } else if (p.action === 'renombrar_detalle' && p.args?.id && p.args?.detalle) {
        const { error } = await sb.from('bank_transactions')
          .update({ detail: p.args.detalle }).eq('id', p.args.id)
        results.push(error ? `Error: ${error.message}` : `✅ Detalle cambiado a "${p.args.detalle}".`)
      } else if (p.action === 'cambiar_monto' && p.args?.id && p.args?.campo && p.args?.monto != null) {
        const campo = p.args.campo === 'credit' ? 'credit' : 'debit'
        const { error } = await sb.from('bank_transactions')
          .update({ [campo]: p.args.monto }).eq('id', p.args.id)
        results.push(error ? `Error: ${error.message}` : `✅ ${campo} cambiado a $${p.args.monto}.`)
      } else if (p.action === 'cambiar_fecha' && p.args?.id && p.args?.fecha) {
        const { error } = await sb.from('bank_transactions')
          .update({ date: p.args.fecha }).eq('id', p.args.id)
        results.push(error ? `Error: ${error.message}` : `✅ Fecha cambiada a ${p.args.fecha}.`)
      } else if (p.action === 'eliminar_movimiento' && p.args?.id) {
        const { error } = await sb.from('bank_transactions').delete().eq('id', p.args.id)
        results.push(error ? `Error: ${error.message}` : `✅ Movimiento eliminado.`)
      } else if (p.action === 'agregar_transaccion' && p.args?.fecha && p.args?.detalle && p.args?.monto != null && p.args?.tipo) {
        const bank_account = p.args.cuenta || 'Cuenta principal'
        const isCredit = p.args.tipo === 'ingreso'
        const debit = isCredit ? 0 : Number(p.args.monto)
        const credit = isCredit ? Number(p.args.monto) : 0
        // Balance por cuenta (igual que el alta manual en data/route.ts).
        const { data: prev } = await sb.from('bank_transactions')
          .select('daily_balance').eq('bank_account', bank_account).lte('date', p.args.fecha)
          .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(1)
        const prevBal = prev?.[0]?.daily_balance ? Number(prev[0].daily_balance) : 0
        const bal = prevBal + credit - debit
        const { error } = await sb.from('bank_transactions').insert({
          date: p.args.fecha, bank_account, detail: p.args.detalle,
          category: p.args.categoria || 'Otro', frequency: 'Un solo pago', entry_type: 'real',
          debit, credit, daily_balance: bal,
        })
        results.push(error ? `Error: ${error.message}` : `✅ Movimiento agregado: ${isCredit ? '+' : '−'}$${Number(p.args.monto).toFixed(2)} — "${p.args.detalle}".`)
      } else {
        results.push(`Acción no reconocida: ${p.action}`)
      }
    }
    return NextResponse.json({ answer: results.join('\n') })
  } catch (err: any) {
    return NextResponse.json({ error: 'No pude aplicar el cambio.' }, { status: 500 })
  }
}
