// app/api/reconcile/ask/route.ts
// Asistente de finanzas: responde preguntas sobre los datos del mes.
// Respuestas CONCISAS y ORGANIZADAS: máximo 5 viñetas, sin muros de texto.
import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const { question, month } = await req.json()
    if (!question?.trim()) return NextResponse.json({ error: 'Sin pregunta' }, { status: 400 })

    const sb = supabaseServer()
    const ym = month || new Date().toISOString().slice(0, 7)
    const [y, m] = ym.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    const start = `${ym}-01`
    const end = `${ym}-${String(last).padStart(2, '0')}`

    const { data: txs } = await sb.from('bank_transactions')
      .select('id,date,detail,category,debit,credit')
      .gte('date', start).lte('date', end).order('date', { ascending: true })
    const { data: rules } = await sb.from('recurring_projections')
      .select('concept,frequency,amount,type')

    let dReal = 0, cReal = 0
    const byCat: Record<string, number> = {}
    for (const t of txs || []) {
      const d = Number(t.debit) || 0, c = Number(t.credit) || 0
      dReal += d; cReal += c
      const k = t.category || 'Otro'
      byCat[k] = (byCat[k] || 0) + (c - d)
    }
    const catLines = Object.entries(byCat)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 10)
      .map(([k, v]) => `- ${k}: $${v.toFixed(2)}`)
      .join('\n')
    const progLines = (rules || [])
      .map((r: any) => `- ${r.concept} (${r.frequency}): $${Number(r.amount).toFixed(2)} [${r.type}]`)
      .join('\n')

    const txLines = (txs || []).slice(0, 150).map((x: any) => {
      const amt = Number(x.credit) ? `+$${Number(x.credit).toFixed(2)}` : `-$${Number(x.debit).toFixed(2)}`
      return `- [id:${x.id}] ${x.date} | ${x.detail} | ${x.category || 'Sin categoría'} | ${amt}`
    }).join('\n')
    const context = `MES: ${ym}
BALANCE REAL: $${(cReal - dReal).toFixed(2)} (ingresos $${cReal.toFixed(2)}, gastos $${dReal.toFixed(2)})
MOVIMIENTOS: ${(txs || []).length}
POR CATEGORÍA (neto):
${catLines || '(sin datos)'}
PROGRAMADOS (reglas):
${progLines || '(ninguno)'}
DETALLE DE MOVIMIENTOS (fecha | detalle | categoría | monto):
${txLines || '(sin movimientos)'}`

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
    const tools = [{
      functionDeclarations: [
        {
          name: 'cambiar_categoria',
          description: 'Cambia la categoría de uno o más movimientos. Usa los id de la lista.',
          parameters: {
            type: 'OBJECT',
            properties: {
              ids: { type: 'ARRAY', items: { type: 'STRING' }, description: 'IDs de los movimientos' },
              categoria: { type: 'STRING', description: 'Nueva categoría' },
            },
            required: ['ids', 'categoria'],
          },
        },
        {
          name: 'renombrar_detalle',
          description: 'Cambia el nombre/detalle de un movimiento.',
          parameters: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'ID del movimiento' },
              detalle: { type: 'STRING', description: 'Nuevo nombre' },
            },
            required: ['id', 'detalle'],
          },
        },
      ],
    }]
    const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash', tools } as any)
    const prompt = `Eres el asistente financiero de Island City Transit, un servicio de carro privado en Long Island, NY. Respondes SIEMPRE en español.

REGLAS DE FORMATO (obligatorias, sin excepción):
- Primera línea: la respuesta directa en UNA frase corta.
- Después: máximo 4 viñetas cortas con el detalle clave.
- Números siempre con $ y 2 decimales.
- PROHIBIDO escribir párrafos largos o más de 5 líneas en total.
- Si los datos no alcanzan para responder, dilo en una sola línea y sugiere qué dato falta.
- TIENES el detalle individual de cada movimiento arriba: úsalo para listar, filtrar por nombre/categoría y sumar al centavo.
- PUEDES MODIFICAR: si el dueño pide cambiar una categoría o renombrar un detalle, usa las funciones cambiar_categoria o renombrar_detalle con los id correctos.

DATOS REALES DEL NEGOCIO:
${context}`

    const res = await model.generateContent([prompt, `Pregunta del dueño: ${question}`])
    const cand = res.response.candidates?.[0]
    const parts = (cand?.content as any)?.parts || []
    const fns = parts.filter((p: any) => p.functionCall)
    if (fns.length) {
      const results: string[] = []
      for (const f of fns) {
        const { name, args } = f.functionCall
        if (name === 'cambiar_categoria') {
          const { error, count } = await sb.from('bank_transactions').update({ category: args.categoria }).in('id', args.ids)
          results.push(error ? `Error al cambiar categoría: ${error.message}` : `Categoría cambiada a "${args.categoria}" en ${count ?? args.ids.length} movimiento(s).`)
        } else if (name === 'renombrar_detalle') {
          const { error } = await sb.from('bank_transactions').update({ detail: args.detalle }).eq('id', args.id)
          results.push(error ? `Error al renombrar: ${error.message}` : `Detalle cambiado a "${args.detalle}".`)
        }
      }
      return NextResponse.json({ answer: results.join('\n') })
    }
    const answer = res.response.text().trim()
    return NextResponse.json({ answer })
  } catch (err: any) {
    const msg = String(err.message || err)
    const low = msg.toLowerCase()
    if (low.includes('gemini_api_key') || low.includes('api key') || low.includes('unregistered') || low.includes('403')) {
      return NextResponse.json({ error: 'Falta la llave de Gemini en Vercel. Agrégala como GEMINI_API_KEY en Settings → Environment Variables y vuelve a desplegar.' }, { status: 500 })
    }
    return NextResponse.json({ error: 'No pude responder. Intenta de nuevo.' }, { status: 500 })
  }
}
