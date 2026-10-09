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
      } else {
        results.push(`Acción no reconocida: ${p.action}`)
      }
    }
    return NextResponse.json({ answer: results.join('\n') })
  } catch (err: any) {
    return NextResponse.json({ error: 'No pude aplicar el cambio.' }, { status: 500 })
  }
}
