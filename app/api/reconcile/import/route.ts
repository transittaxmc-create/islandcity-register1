// app/api/reconcile/import/route.ts
// Importa un estado de cuenta del banco (CSV).
// - Los números de cuenta se OCULTAN: no se guardan ni se muestran.
// - Solo se importan fecha, detalle y montos.
// - No duplica movimientos que ya existen.
// POST FormData { file } -> { imported, duplicates, skipped }
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === ';' && row.length === 0 && field === '' && false) { /* no-op */ }
      else field += c
    }
  }
  if (field.trim() || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f.trim()))
}

function parseDate(s: string): string | null {
  const t = s.trim()
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    // Asume MM/DD/YYYY (formato de bancos de EE.UU.)
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}

function parseAmount(s: string): number {
  let t = s.trim().replace(/[$,\s]/g, '')
  const neg = /^\(.*\)$/.test(t)
  t = t.replace(/[()]/g, '')
  const n = parseFloat(t)
  if (isNaN(n)) return 0
  return neg ? -Math.abs(n) : n
}

// Oculta números de cuenta: secuencias de 8+ dígitos -> ••••
function redact(s: string): string {
  return s.replace(/\b\d{8,}\b/g, '••••').trim()
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Sin archivo' }, { status: 400 })

    const text = await file.text()
    const rows = parseCSV(text)
    if (rows.length < 2) return NextResponse.json({ error: 'El archivo no tiene datos.' }, { status: 400 })

    // Detecta columnas por el encabezado
    const header = rows[0].map((h) => h.toLowerCase())
    const findCol = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)))
    const dateCol = findCol('date', 'fecha')
    const detailCol = findCol('description', 'descripci', 'detail', 'detalle', 'concepto', 'memo')
    const debitCol = findCol('debit', 'débito', 'debito', 'withdrawal', 'retiro', 'cargo', 'egreso')
    const creditCol = findCol('credit', 'crédito', 'credito', 'deposit', 'depósito', 'deposito', 'abono', 'ingreso')
    const amountCol = findCol('amount', 'monto', 'importe')

    if (dateCol < 0 || detailCol < 0 || (debitCol < 0 && creditCol < 0 && amountCol < 0)) {
      return NextResponse.json({ error: 'No reconozco el formato del archivo. Usa el CSV de tu banco.' }, { status: 400 })
    }

    const sb = supabaseServer()
    let imported = 0, duplicates = 0, skipped = 0

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      const dateStr = parseDate(r[dateCol] || '')
      const detail = redact(r[detailCol] || '')
      if (!dateStr || !detail) { skipped++; continue }

      let debit = 0, credit = 0
      if (debitCol >= 0 || creditCol >= 0) {
        debit = debitCol >= 0 ? Math.abs(parseAmount(r[debitCol] || '0')) : 0
        credit = creditCol >= 0 ? Math.abs(parseAmount(r[creditCol] || '0')) : 0
      } else if (amountCol >= 0) {
        const amt = parseAmount(r[amountCol] || '0')
        if (amt < 0) debit = Math.abs(amt)
        else credit = amt
      }
      if (debit === 0 && credit === 0) { skipped++; continue }

      // Deduplicación: mismo monto ±1 centavo en ±2 días, detalle parecido
      const d0 = new Date(dateStr + 'T12:00:00')
      const minus2 = new Date(d0); minus2.setDate(minus2.getDate() - 2)
      const plus2 = new Date(d0); plus2.setDate(plus2.getDate() + 2)
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const amt = debit > 0 ? debit : credit
      const col = debit > 0 ? 'debit' : 'credit'
      const { data: cands } = await sb.from('bank_transactions')
        .select('id,detail')
        .gte('date', iso(minus2)).lte('date', iso(plus2))
        .gte(col, amt - 0.01).lte(col, amt + 0.01)
        .limit(10)
      const dlow = detail.toLowerCase()
      const dup = (cands || []).some((c: any) => {
        const clow = (c.detail || '').toLowerCase()
        return clow && (clow.includes(dlow.slice(0, 12)) || dlow.includes(clow.slice(0, 12)))
      })
      if (dup) { duplicates++; continue }

      const { error } = await sb.from('bank_transactions').insert({
        date: dateStr,
        bank_account: 'Cuenta principal',
        detail: detail.slice(0, 200),
        category: 'Otro',
        debit: debit > 0 ? debit : null,
        credit: credit > 0 ? credit : null,
      })
      if (error) { skipped++; continue }
      imported++
    }

    return NextResponse.json({ imported, duplicates, skipped })
  } catch (err: any) {
    return NextResponse.json({ error: 'No se pudo importar: ' + err.message }, { status: 500 })
  }
}
