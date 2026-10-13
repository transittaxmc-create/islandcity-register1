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
        {
          name: 'cambiar_monto',
          description: 'Cambia el monto débito o crédito de un movimiento.',
          parameters: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'ID del movimiento' },
              campo: { type: 'STRING', description: '"debit" o "credit"' },
              monto: { type: 'NUMBER', description: 'Nuevo monto' },
            },
            required: ['id', 'campo', 'monto'],
          },
        },
        {
          name: 'cambiar_fecha',
          description: 'Cambia la fecha de un movimiento (formato YYYY-MM-DD).',
          parameters: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'ID del movimiento' },
              fecha: { type: 'STRING', description: 'Nueva fecha YYYY-MM-DD' },
            },
            required: ['id', 'fecha'],
          },
        },
        {
          name: 'eliminar_movimiento',
          description: 'Elimina un movimiento del libro.',
          parameters: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'ID del movimiento' },
            },
            required: ['id'],
          },
        },
        {
          name: 'agregar_transaccion',
          description: 'Agrega un movimiento nuevo al libro. Solo cuando Miguel lo pide explícitamente.',
          parameters: {
            type: 'OBJECT',
            properties: {
              fecha: { type: 'STRING', description: 'Fecha YYYY-MM-DD' },
              cuenta: { type: 'STRING', description: 'Cuenta bancaria (nombre como aparece en la app)' },
              detalle: { type: 'STRING', description: 'Descripción del movimiento' },
              categoria: { type: 'STRING', description: 'Categoría' },
              tipo: { type: 'STRING', description: '"ingreso" o "gasto"' },
              monto: { type: 'NUMBER', description: 'Monto' },
            },
            required: ['fecha', 'detalle', 'tipo', 'monto'],
          },
        },
      ],
    }]
    const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash', tools } as any)
    const prompt = `Eres el asistente financiero personal de Miguel, dueño de Island City Transit (servicio de carro privado en Long Island, NY). Esta conversación ocurre DENTRO de su aplicación bancaria. Respondes SIEMPRE en español.

ACCESO TOTAL A LOS DATOS:
- Tienes acceso completo de lectura a todo lo de la app: balances, transacciones, cuentas, proyecciones, recibos, reglas programadas.
- Responde CUALQUIER pregunta sobre sus datos. PROHIBIDO negarte a responder o decir que no tienes acceso.
- Si los datos no alcanzan para responder, dilo claro en una línea y pide el dato que falta.
- TIENES el detalle individual de cada movimiento abajo: úsalo para listar, filtrar por nombre/categoría y sumar al centavo.

ACCIONES (solo con su orden):
- PUEDES PROPONER: agregar transacciones, cambiar categoría/monto/fecha/detalle, eliminar movimientos, y hacer cálculos.
- REGLA DE ORO: solo actúas cuando Miguel lo ordena explícitamente, acción por acción. NUNCA cambias, agregas ni borras nada por iniciativa propia.
- Cada propuesta se le presenta para que la APRUEBE antes de ejecutarse: el sistema le pedirá que confirme.

CONFIDENCIALIDAD:
- Sus datos no salen de esta app. Jamás los compartes, publicas ni envías a nadie fuera de aquí. Todo tu trabajo ocurre dentro de la aplicación.

REGLAS CONTABLES DE MIGUEL (las aplicas siempre al asistir):
1. Cada cuenta tiene su balance propio; el cierre de un mes = la apertura del siguiente.
2. Las transferencias internas son entradas con ORIGEN trazado: nunca inflan ingresos. Cada depósito original se cuenta UNA sola vez — esto es clave para los taxes (no es lo mismo pagar por 50 que por 100 duplicado).
3. Clasificación por remitente: cuenta propia = transferencia; plataforma = ingreso/pago; remitente desconocido o ambiguo = le preguntas a Miguel, nunca adivinas; aprendes de sus respuestas para la próxima vez.
4. Banco vs proyecciones: en el BANCO cada gasto pagado se rastrea a un depósito (ingreso o transferencia de otra cuenta); en PROYECCIONES puede haber más gastos que ingresos (es futuro).
5. Conciliación: inicial + ingresos reales + transfers recibidos − gastos reales − transfers enviados = final. Si hay diferencia, la muestras explícita, no la escondes.
6. Evidencia: cada transacción debe tener su recibo o screenshot como prueba, conectado a la transacción y al statement, para cualquier auditoría futura.

TONO:
- Natural y directo, como un asistente personal: responde completo lo que pregunte, sin rodeos y sin muros de texto innecesarios.
- Números siempre con $ y 2 decimales.

DATOS REALES DEL NEGOCIO:
${context}`

    const res = await model.generateContent([prompt, `Pregunta del dueño: ${question}`])
    const cand = res.response.candidates?.[0]
    const parts = (cand?.content as any)?.parts || []
    const fns = parts.filter((p: any) => p.functionCall)
    if (fns.length) {
      // NO ejecuta: devuelve la propuesta para que Miguel la apruebe
      const proposals = fns.map((f: any) => {
        const { name, args } = f.functionCall
        let desc = ''
        if (name === 'cambiar_categoria') desc = `Cambiar categoría a "${args.categoria}" en ${args.ids.length} movimiento(s)`
        else if (name === 'renombrar_detalle') desc = `Renombrar detalle a "${args.detalle}"`
        else if (name === 'cambiar_monto') desc = `Cambiar ${args.campo} a $${args.monto}`
        else if (name === 'cambiar_fecha') desc = `Cambiar fecha a ${args.fecha}`
        else if (name === 'eliminar_movimiento') desc = `⚠️ Eliminar este movimiento`
        else if (name === 'agregar_transaccion') desc = `Agregar ${args.tipo} de $${Number(args.monto).toFixed(2)} — "${args.detalle}" (${args.fecha}${args.cuenta ? ', ' + args.cuenta : ''})`
        return { action: name, args, desc }
      })
      return NextResponse.json({ pending: proposals })
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
