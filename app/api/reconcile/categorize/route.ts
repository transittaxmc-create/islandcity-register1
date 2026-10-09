// app/api/reconcile/categorize/route.ts
// Sugiere la categoría correcta para un detalle de transacción.
// POST { detail } -> { category }
import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const CATEGORIES = ['Ingresos', 'Gasolina', 'Peajes E-ZPass', 'Mantenimiento', 'Llantas', 'Seguro comercial', 'Pago del vehículo', 'Comida', 'Otro']

export async function POST(req: NextRequest) {
  try {
    const { detail } = await req.json()
    if (!detail?.trim()) return NextResponse.json({ category: 'Otro' })

    const key = process.env.GEMINI_API_KEY || ''
    if (!key) return NextResponse.json({ category: 'Otro', note: 'sin llave' })

    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' })
    const prompt = `Clasifica este movimiento de un servicio de carro privado (chofer en Long Island, NY) en UNA sola de estas categorías exactas: ${CATEGORIES.join(', ')}.

Movimiento: "${detail}"

Responde SOLO con el nombre exacto de la categoría, sin explicaciones ni comillas.`
    const res = await model.generateContent(prompt)
    const cat = res.response.text().trim().replace(/["'.]/g, '')
    const match = CATEGORIES.find((c) => c.toLowerCase() === cat.toLowerCase())
    return NextResponse.json({ category: match || 'Otro' })
  } catch {
    return NextResponse.json({ category: 'Otro' })
  }
}
