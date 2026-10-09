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
      .select('date,detail,category,debit,credit')
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
      return `- ${x.date} | ${x.detail} | ${x.category || 'Sin categoría'} | ${amt}`
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
    const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' })
    const prompt = `Eres el asistente financiero de Island City Transit, un servicio de carro privado en Long Island, NY. Respondes SIEMPRE en español.

REGLAS DE FORMATO (obligatorias, sin excepción):
- Primera línea: la respuesta directa en UNA frase corta.
- Después: máximo 4 viñetas cortas con el detalle clave.
- Números siempre con $ y 2 decimales.
- PROHIBIDO escribir párrafos largos o más de 5 líneas en total.
- Si los datos no alcanzan para responder, dilo en una sola línea y sugiere qué dato falta.
- TIENES el detalle individual de cada movimiento arriba: úsalo para listar, filtrar por nombre/categoría y sumar al centavo.

DATOS REALES DEL NEGOCIO:
${context}`

    const res = await model.generateContent([prompt, `Pregunta del dueño: ${question}`])
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
