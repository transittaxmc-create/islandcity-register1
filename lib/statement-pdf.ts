// lib/statement-pdf.ts
// Genera un PDF profesional del estado de cuenta (Bank Transaction Statement)
// para el rango de meses que Miguel especifique en el chat de la AI.
// Se ejecuta en el navegador (client-side): descarga directa, sin carga al servidor.
// Usa pdf-lib (sin postinstall scripts: compatible con pnpm frozen-lockfile).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface Tx {
  date: string
  bank_account: string
  detail: string
  category?: string | null
  debit?: number | null
  credit?: number | null
}

const NAVY = rgb(0.063, 0.141, 0.247) // #10243f
const GRAY = rgb(0.392, 0.455, 0.545) // #64748b
const DARK = rgb(0.118, 0.161, 0.227) // #1e293b
const RED = rgb(0.745, 0.071, 0.235) // #be123c
const LIGHT = rgb(0.973, 0.98, 0.992) // #f8fafc
const WHITE = rgb(1, 1, 1)

const MESES: Record<string, number> = {
  enero: 1, january: 1, febrero: 2, february: 2, marzo: 3, march: 3,
  abril: 4, april: 4, mayo: 5, may: 5, junio: 6, june: 6,
  julio: 7, july: 7, agosto: 8, august: 8, septiembre: 9, setiembre: 9, september: 9,
  octubre: 10, october: 10, noviembre: 11, november: 11, diciembre: 12, december: 12,
}
const MES_NOMBRE = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const money = (n: number) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Extrae {from,to} en 'YYYY-MM' del texto que escribe Miguel. Null si no hay meses claros. */
export function parseReportRange(text: string): { from: string; to: string } | null {
  const t = norm(text)
  const yearMatch = t.match(/\b(20\d{2})\b/)
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear()

  if (/todo el (a[ñn]o|2026)|a[ñn]o completo|full year|todo el a[ñn]o/.test(t)) {
    return { from: `${year}-01`, to: `${year}-12` }
  }

  const found: number[] = []
  for (const w of t.split(/[^a-z]+/)) {
    const m = MESES[w]
    if (m && !found.includes(m)) found.push(m)
  }
  if (found.length === 0) return null
  if (found.length === 1) {
    const mm = String(found[0]).padStart(2, '0')
    return { from: `${year}-${mm}`, to: `${year}-${mm}` }
  }
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
  order?: Record<string, number>,
): Promise<string> {
  const doc = await PDFDocument.create()
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)

  const PW = 612, PH = 792 // letter
  const M = 44
  const CW = PW - 2 * M

  let page = doc.addPage([PW, PH])
  let y = PH - 58

  const fit = (text: string, font: any, size: number, maxW: number) => {
    let t = text || ''
    if (font.widthOfTextAtSize(t, size) <= maxW) return t
    while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxW) t = t.slice(0, -1)
    return t + '…'
  }
  const newPage = () => {
    page = doc.addPage([PW, PH])
    y = PH - 60
  }
  const need = (h: number) => { if (y - h < 58) newPage() }
  const fmtDate = (d: string) =>
    d && d.length >= 10 ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : d || ''

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  // ---------- encabezado ----------
  page.drawText('ISLAND CITY TRANSIT', { x: M, y, size: 19, font: helvB, color: NAVY })
  y -= 20
  page.drawText('Bank Transaction Statement', { x: M, y, size: 11, font: helv, color: GRAY })
  y -= 16
  page.drawText(`Period: ${rangeLabel(from, to)}`, { x: M, y, size: 9, font: helv, color: GRAY })
  const genW = helv.widthOfTextAtSize(`Generated: ${today}`, 9)
  page.drawText(`Generated: ${today}`, { x: PW - M - genW, y, size: 9, font: helv, color: GRAY })
  y -= 10
  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 2, color: NAVY })
  y -= 22

  let grandInc = 0, grandExp = 0

  // columnas: Date 62 | Detail flex | Category 84 | Debit 66 | Credit 66
  const cDate = 62, cCat = 84, cAmt = 66
  const cDetail = CW - cDate - cCat - cAmt * 2
  const xDate = M, xDetail = M + cDate, xCat = xDetail + cDetail, xDeb = xCat + cCat, xCre = xDeb + cAmt

  const drawTableHead = () => {
    need(24)
    page.drawRectangle({ x: M, y: y - 15, width: CW, height: 20, color: NAVY })
    const hy = y - 2
    page.drawText('Date', { x: xDate + 6, y: hy, size: 8, font: helvB, color: WHITE })
    page.drawText('Detail', { x: xDetail + 6, y: hy, size: 8, font: helvB, color: WHITE })
    page.drawText('Category', { x: xCat + 6, y: hy, size: 8, font: helvB, color: WHITE })
    const dw = helvB.widthOfTextAtSize('Debit', 8)
    page.drawText('Debit', { x: xDeb + cAmt - 6 - dw, y: hy, size: 8, font: helvB, color: WHITE })
    const cw2 = helvB.widthOfTextAtSize('Credit', 8)
    page.drawText('Credit', { x: xCre + cAmt - 6 - cw2, y: hy, size: 8, font: helvB, color: WHITE })
    y -= 20
  }

  for (const { ym, txs } of months) {
    const [yy, mm] = ym.split('-').map(Number)
    // banda del mes
    need(40)
    page.drawRectangle({ x: M, y: y - 16, width: CW, height: 24, color: NAVY })
    page.drawText(`${MES_NOMBRE[mm]} ${yy}`, { x: M + 10, y: y - 1, size: 11, font: helvB, color: WHITE })
    y -= 30

    const byAcct = new Map<string, Tx[]>()
    for (const t of txs) {
      const k = t.bank_account || 'Sin cuenta'
      if (!byAcct.has(k)) byAcct.set(k, [])
      byAcct.get(k)!.push(t)
    }

    let mInc = 0, mExp = 0
    const acctNames = [...byAcct.keys()].sort((a, b) => (order?.[a] ?? 100) - (order?.[b] ?? 100) || a.localeCompare(b))
    if (acctNames.length === 0) {
      page.drawText('No transactions this month.', { x: M, y, size: 9, font: helv, color: GRAY })
      y -= 20
    }
    for (const acct of acctNames) {
      const rows = byAcct.get(acct)!.sort((a, b) => a.date.localeCompare(b.date))
      const inst = institutions[acct]
      need(34)
      page.drawText(inst ? `${inst} — ${acct}` : acct, { x: M, y, size: 10, font: helvB, color: NAVY })
      y -= 8

      drawTableHead()
      let aInc = 0, aExp = 0, alt = false
      for (const t of rows) {
        const d = Number(t.debit) || 0, c = Number(t.credit) || 0
        aInc += c; aExp += d
        need(18)
        if (alt) page.drawRectangle({ x: M, y: y - 13, width: CW, height: 17, color: LIGHT })
        alt = !alt
        const ry = y
        page.drawText(fmtDate(t.date), { x: xDate + 6, y: ry, size: 8, font: helv, color: DARK })
        page.drawText(fit(t.detail || '', helv, 8, cDetail - 12), { x: xDetail + 6, y: ry, size: 8, font: helv, color: DARK })
        page.drawText(fit(t.category || '—', helv, 8, cCat - 12), { x: xCat + 6, y: ry, size: 8, font: helv, color: DARK })
        if (d) {
          const s = money(d), w = helv.widthOfTextAtSize(s, 8)
          page.drawText(s, { x: xDeb + cAmt - 6 - w, y: ry, size: 8, font: helv, color: DARK })
        }
        if (c) {
          const s = money(c), w = helv.widthOfTextAtSize(s, 8)
          page.drawText(s, { x: xCre + cAmt - 6 - w, y: ry, size: 8, font: helv, color: DARK })
        }
        y -= 17
      }
      mInc += aInc; mExp += aExp

      // subtotal cuenta
      need(20)
      const net = aInc - aExp
      const sub = `Subtotal — Income ${money(aInc)}    Expenses ${money(aExp)}    Net ${net < 0 ? '-' : ''}${money(net)}`
      const sw = helvB.widthOfTextAtSize(sub, 9)
      page.drawText(sub, { x: PW - M - sw, y, size: 9, font: helvB, color: GRAY })
      y -= 20
    }

    // totales del mes
    grandInc += mInc; grandExp += mExp
    need(40)
    const mNet = mInc - mExp
    page.drawRectangle({ x: M, y: y - 16, width: CW, height: 30, color: LIGHT })
    page.drawText(`${MES_NOMBRE[mm]} totals:`, { x: M + 10, y: y + 2, size: 10, font: helvB, color: NAVY })
    page.drawText(`Income ${money(mInc)}`, { x: M + 170, y: y + 2, size: 10, font: helv, color: DARK })
    page.drawText(`Expenses ${money(mExp)}`, { x: M + 300, y: y + 2, size: 10, font: helv, color: DARK })
    const ns = `Net ${mNet < 0 ? '-' : ''}${money(mNet)}`
    const nw = helvB.widthOfTextAtSize(ns, 10)
    page.drawText(ns, { x: PW - M - 10 - nw, y: y + 2, size: 10, font: helvB, color: mNet < 0 ? RED : NAVY })
    y -= 44
  }

  // ---------- totales generales ----------
  need(80)
  const gNet = grandInc - grandExp
  page.drawRectangle({ x: M, y: y - 18, width: CW, height: 56, color: NAVY })
  page.drawText(`TOTALS — ${rangeLabel(from, to).toUpperCase()}`, { x: M + 12, y: y + 4, size: 12, font: helvB, color: WHITE })
  page.drawText(`Total income: ${money(grandInc)}`, { x: M + 12, y: y - 16, size: 10, font: helv, color: WHITE })
  page.drawText(`Total expenses: ${money(grandExp)}`, { x: M + 220, y: y - 16, size: 10, font: helv, color: WHITE })
  const gs = `Net: ${gNet < 0 ? '-' : ''}${money(gNet)}`
  const gw = helvB.widthOfTextAtSize(gs, 11)
  page.drawText(gs, { x: PW - M - 12 - gw, y: y - 16, size: 11, font: helvB, color: WHITE })

  // ---------- footer ----------
  const pages = doc.getPageCount()
  for (let i = 0; i < pages; i++) {
    const p = doc.getPage(i)
    p.drawText('Island City Transit — Dual Register', { x: M, y: 30, size: 8, font: helv, color: GRAY })
    const pn = `Page ${i + 1} of ${pages}`
    const pw = helv.widthOfTextAtSize(pn, 8)
    p.drawText(pn, { x: PW - M - pw, y: 30, size: 8, font: helv, color: GRAY })
  }

  const fname = `IslandCityTransit-Statement-${from}_a_${to}.pdf`
  const bytes = await doc.save()
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  // La URL vive 10 minutos: suficiente para descargarlo desde el mensaje del chat.
  setTimeout(() => URL.revokeObjectURL(url), 600000)
  return { fname, url }
}
