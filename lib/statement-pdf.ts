// lib/statement-pdf.ts
// Genera un PDF profesional del estado de cuenta (Bank Transaction Statement)
// para el rango de meses que Miguel especifique en el chat de la AI.
// Se ejecuta en el navegador (client-side): descarga directa, sin carga al servidor.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface Tx {
  date: string
  bank_account: string
  detail: string
  category?: string | null
  debit?: number | null
  credit?: number | null
}

const NAVY: [number, number, number] = [16, 36, 63]
const GRAY: [number, number, number] = [100, 116, 139]
const RED: [number, number, number] = [190, 18, 60]
const LIGHT: [number, number, number] = [248, 250, 252]

const MESES: Record<string, number> = {
  enero: 1, january: 1, febrero: 2, february: 2, marzo: 3, march: 3,
  abril: 4, april: 4, mayo: 5, may: 5, junio: 6, june: 6,
  julio: 7, july: 7, agosto: 8, august: 8, septiembre: 9, setiembre: 9, september: 9,
  octubre: 10, october: 10, noviembre: 11, november: 11, diciembre: 12, december: 12,
}
const MES_NOMBRE = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const money = (n: number) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Extrae {from,to} en 'YYYY-MM' del texto que escribe Miguel. Null si no hay meses claros. */
export function parseReportRange(text: string): { from: string; to: string } | null {
  const t = norm(text)
  const yearMatch = t.match(/\b(20\d{2})\b/)
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear()

  // "todo el año 2026" / "año completo" / "full year"
  if (/todo el (a[ñn]o|2026)|a[ñn]o completo|full year|todo el a[ñn]o/.test(t)) {
    return { from: `${year}-01`, to: `${year}-12` }
  }

  // meses mencionados, en orden de aparición
  const found: number[] = []
  const words = t.split(/[^a-z]+/)
  for (const w of words) {
    const m = MESES[w]
    if (m && !found.includes(m)) found.push(m)
  }
  if (found.length === 0) return null
  if (found.length === 1) {
    const mm = String(found[0]).padStart(2, '0')
    return { from: `${year}-${mm}`, to: `${year}-${mm}` }
  }
  // "de X a Y" o lista: del primero al último mencionado
  const a = Math.min(...found), b = Math.max(...found)
  return { from: `${year}-${String(a).padStart(2, '0')}`, to: `${year}-${String(b).padStart(2, '0')}` }
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ey, em] = to.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

export function rangeLabel(from: string, to: string): string {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  if (from === to) return `${MES_NOMBRE[fm]} ${fy}`
  if (fy === ty) return `${MES_NOMBRE[fm]} – ${MES_NOMBRE[tm]} ${fy}`
  return `${MES_NOMBRE[fm]} ${fy} – ${MES_NOMBRE[tm]} ${ty}`
}

export interface MonthData { ym: string; txs: Tx[] }

export async function generateStatementPDF(
  months: MonthData[],
  institutions: Record<string, string>,
  from: string,
  to: string,
): Promise<string> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const M = 44 // margen

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  // ---------- encabezado ----------
  doc.setTextColor(...NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text('ISLAND CITY TRANSIT', M, 58)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...GRAY)
  doc.text('Bank Transaction Statement', M, 76)
  doc.setFontSize(9)
  doc.text(`Period: ${rangeLabel(from, to)}`, M, 92)
  doc.text(`Generated: ${today}`, W - M, 92, { align: 'right' })
  doc.setDrawColor(...NAVY)
  doc.setLineWidth(2)
  doc.line(M, 102, W - M, 102)

  let y = 122
  let grandInc = 0, grandExp = 0

  const needSpace = (h: number) => {
    if (y + h > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage()
      y = 60
    }
  }

  for (const { ym, txs } of months) {
    const [yy, mm] = ym.split('-').map(Number)
    // banda del mes
    needSpace(60)
    doc.setFillColor(...NAVY)
    doc.rect(M, y - 14, W - 2 * M, 24, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(`${MES_NOMBRE[mm]} ${yy}`, M + 10, y + 3)
    y += 22

    // agrupar por cuenta
    const byAcct = new Map<string, Tx[]>()
    for (const t of txs) {
      const k = t.bank_account || 'Sin cuenta'
      if (!byAcct.has(k)) byAcct.set(k, [])
      byAcct.get(k)!.push(t)
    }

    let mInc = 0, mExp = 0
    const acctNames = [...byAcct.keys()].sort()
    if (acctNames.length === 0) {
      doc.setTextColor(...GRAY)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(9)
      doc.text('No transactions this month.', M, y)
      y += 18
    }
    for (const acct of acctNames) {
      const rows = byAcct.get(acct)!.sort((a, b) => a.date.localeCompare(b.date))
      const inst = institutions[acct]
      needSpace(40)
      doc.setTextColor(...NAVY)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.text(inst ? `${inst} — ${acct}` : acct, M, y)
      y += 6

      let aInc = 0, aExp = 0
      const body = rows.map((t) => {
        const d = Number(t.debit) || 0, c = Number(t.credit) || 0
        aInc += c; aExp += d
        const dt = t.date.length >= 10 ? t.date.slice(5, 7) + '/' + t.date.slice(8, 10) + '/' + t.date.slice(0, 4) : t.date
        return [dt, t.detail || '', t.category || '—', d ? money(d) : '', c ? money(c) : '']
      })
      mInc += aInc; mExp += aExp

      autoTable(doc, {
        startY: y,
        head: [['Date', 'Detail', 'Category', 'Debit', 'Credit']],
        body,
        margin: { left: M, right: M },
        styles: { fontSize: 8, cellPadding: 4, textColor: [30, 41, 59] },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: LIGHT },
        columnStyles: {
          0: { cellWidth: 62 },
          2: { cellWidth: 84 },
          3: { cellWidth: 66, halign: 'right' },
          4: { cellWidth: 66, halign: 'right' },
        },
        didDrawPage: () => { /* el footer se dibuja al final */ },
      })
      y = (doc as any).lastAutoTable.finalY + 8

      // subtotal de la cuenta
      needSpace(24)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...GRAY)
      const net = aInc - aExp
      doc.text(
        `Subtotal — Income ${money(aInc)}    Expenses ${money(aExp)}    Net ${net < 0 ? '-' : ''}${money(net)}`,
        W - M, y, { align: 'right' },
      )
      if (net < 0) { /* el signo menos ya indica */ }
      y += 16
    }

    // totales del mes
    grandInc += mInc; grandExp += mExp
    needSpace(44)
    const mNet = mInc - mExp
    doc.setFillColor(...LIGHT)
    doc.rect(M, y - 14, W - 2 * M, 30, 'F')
    doc.setTextColor(...NAVY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(`${MES_NOMBRE[mm]} totals:`, M + 10, y + 6)
    doc.setFont('helvetica', 'normal')
    doc.text(`Income ${money(mInc)}`, M + 170, y + 6)
    doc.text(`Expenses ${money(mExp)}`, M + 300, y + 6)
    doc.setFont('helvetica', 'bold')
    if (mNet < 0) doc.setTextColor(...RED)
    doc.text(`Net ${mNet < 0 ? '-' : ''}${money(mNet)}`, W - M - 10, y + 6, { align: 'right' })
    doc.setTextColor(...NAVY)
    y += 40
  }

  // ---------- totales generales ----------
  needSpace(90)
  const gNet = grandInc - grandExp
  doc.setFillColor(...NAVY)
  doc.rect(M, y - 16, W - 2 * M, 56, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(`TOTALS — ${rangeLabel(from, to).toUpperCase()}`, M + 12, y + 6)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Total income: ${money(grandInc)}`, M + 12, y + 26)
  doc.text(`Total expenses: ${money(grandExp)}`, M + 220, y + 26)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(`Net: ${gNet < 0 ? '-' : ''}${money(gNet)}`, W - M - 12, y + 26, { align: 'right' })

  // ---------- footer en todas las páginas ----------
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'normal')
    doc.text('Island City Transit — Dual Register', M, doc.internal.pageSize.getHeight() - 28)
    doc.text(`Page ${i} of ${pages}`, W - M, doc.internal.pageSize.getHeight() - 28, { align: 'right' })
  }

  const fname = `IslandCityTransit-Statement-${from}_a_${to}.pdf`
  doc.save(fname)
  return fname
}
