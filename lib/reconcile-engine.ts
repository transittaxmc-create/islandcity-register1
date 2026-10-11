// lib/reconcile-engine.ts
// Financial Reconciliation Engine — pure logic, no I/O, no framework.
// Pipeline per transaction: Match (A) -> Transfer filter (B) -> Classify (C) -> Liquidity Guard.
// Spec: "Dual Register" (Actual vs Projected), ±15% fuzzy band, 24h internal-transfer window:
//   Net_Liquidity = Current_Balance + Σ(Projected_Income) − Σ(Projected_Expenses) − Saving_Goal

export type MatchStatus = 'MATCHED' | 'SUGGESTED_MATCH' | 'UNLINKED'
export type Classification =
  | 'FIXED_EXPENSE'
  | 'VARIABLE_EXPENSE'
  | 'TRUE_INCOME'
  | 'INTERNAL_TRANSFER'

export type LiquidityLevel = 'ok' | 'yellow' | 'orange' | 'red'

export type RealTx = {
  id: string
  date: string // ISO YYYY-MM-DD
  bank_account: string
  detail: string
  debit: number | null
  credit: number | null
}

export type ProjRule = {
  id: string
  concept: string
  amount: number
  type: 'ingreso' | 'gasto'
  frequency: string
  pay_day: string
}

export type ProjOccurrence = ProjRule & { occurrence_date: string }

export const FUZZY_BAND = 0.15 // ±15% amount variance for SUGGESTED_MATCH
export const TRANSFER_WINDOW_MS = 24 * 3600 * 1000 // Step B: 24h

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function nameMatches(a: string, b: string): boolean {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  const xs = x.split(' ').filter((w) => w.length > 2)
  const ys = new Set(y.split(' '))
  const hit = xs.filter((w) => ys.has(w)).length
  return hit >= Math.min(2, xs.length) && hit / Math.max(1, xs.length) >= 0.5
}

// ---- Step A: Match one real tx against projected occurrences ----
export function matchOne(
  t: RealTx,
  occurrences: ProjOccurrence[]
): { status: MatchStatus; ruleId: string | null; occurrenceDate: string | null } {
  const amt = Math.abs(Number(t.credit) > 0 ? t.credit : t.debit) || 0
  if (!amt) return { status: 'UNLINKED', ruleId: null, occurrenceDate: null }
  let suggested: { ruleId: string; occurrenceDate: string } | null = null
  for (const o of occurrences) {
    if (!nameMatches(t.detail, o.concept)) continue
    const pa = Math.abs(Number(o.amount)) || 0
    if (!pa) continue
    if (Math.abs(amt - pa) < 0.005) {
      return { status: 'MATCHED', ruleId: o.id, occurrenceDate: o.occurrence_date }
    }
    if (!suggested && pa > 0 && Math.abs(amt - pa) / pa <= FUZZY_BAND) {
      suggested = { ruleId: o.id, occurrenceDate: o.occurrence_date }
    }
  }
  if (suggested) return { status: 'SUGGESTED_MATCH', ...suggested }
  return { status: 'UNLINKED', ruleId: null, occurrenceDate: null }
}

// ---- Step B: auto-detect internal transfer pairs (24h, opposite sides, same amount, different accounts) ----
export type TxPair = { fromId: string; toId: string }

export function detectTransfers(txs: RealTx[], alreadyLinked: Set<string>): TxPair[] {
  const mid = (iso: string) => new Date(iso + 'T12:00:00').getTime()
  const debits = txs.filter((t) => Number(t.debit) > 0 && !alreadyLinked.has(String(t.id)))
  const creditsByAmt = new Map<string, RealTx[]>()
  for (const t of txs) {
    const c = Number(t.credit) || 0
    if (c <= 0 || alreadyLinked.has(String(t.id))) continue
    const k = c.toFixed(2)
    if (!creditsByAmt.has(k)) creditsByAmt.set(k, [])
    creditsByAmt.get(k)!.push(t)
  }
  const pairs: TxPair[] = []
  const used = new Set<string>()
  for (const d of debits) {
    if (used.has(String(d.id))) continue
    const k = Number(d.debit).toFixed(2)
    for (const c of creditsByAmt.get(k) || []) {
      if (used.has(String(c.id))) continue
      if (c.bank_account === d.bank_account) continue
      if (String(c.id) === String(d.id)) continue
      if (Math.abs(mid(c.date) - mid(d.date)) > TRANSFER_WINDOW_MS) continue
      pairs.push({ fromId: String(d.id), toId: String(c.id) })
      used.add(String(d.id))
      used.add(String(c.id))
      break
    }
  }
  return pairs
}


// ---- Step C: classify (derived — needs no schema change) ----
export function classifyOne(args: {
  t: RealTx
  isTransfer: boolean
  match: { status: MatchStatus }
  ruleFrequency?: string | null
}): Classification {
  if (args.isTransfer) return 'INTERNAL_TRANSFER'
  const c = Number(args.t.credit) || 0
  if (c > 0) return 'TRUE_INCOME'
  if (args.match.status === 'MATCHED' && args.ruleFrequency && args.ruleFrequency !== 'Un solo pago') {
    return 'FIXED_EXPENSE'
  }
  return 'VARIABLE_EXPENSE'
}

// ---- Liquidity Guard ----
export function liquidityGuard(args: {
  currentBalance: number
  projectedIncome: number
  projectedExpenses: number
  savingGoal: number
  safetyBuffer: number
}): { net: number; level: LiquidityLevel; message: string | null } {
  const net =
    Number(args.currentBalance) +
    Number(args.projectedIncome) -
    Number(args.projectedExpenses) -
    Number(args.savingGoal)
  const buf = Math.max(0, Number(args.safetyBuffer) || 0)
  if (net < 0)
    return { net, level: 'red', message: 'Critical: Insufficient funds for projected obligations.' }
  if (net < buf / 2)
    return { net, level: 'orange', message: 'Risk: Saving Goal under threat.' }
  if (net < buf)
    return { net, level: 'yellow', message: 'Warning: Cash flow tightening.' }
  return { net, level: 'ok', message: null }
}

// ---- Occurrence expansion (mirrors /api/reconcile/data GET, pure) ----
export function expandOccurrences(
  rules: ProjRule[],
  start: string,
  end: string
): ProjOccurrence[] {
  const out: ProjOccurrence[] = []
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  const push = (r: ProjRule, d: Date) => {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (iso >= start && iso <= end) out.push({ ...r, occurrence_date: iso })
  }
  for (const r of rules) {
    if (r.frequency === 'Un solo pago') {
      const d = new Date(String(r.pay_day) + 'T12:00:00')
      if (!isNaN(d.getTime())) push(r, d)
      continue
    }
    let cursor: Date
    const asDate = new Date(String(r.pay_day) + 'T12:00:00')
    if (!isNaN(asDate.getTime())) cursor = new Date(asDate)
    else {
      const day = Math.min(parseInt(String(r.pay_day)) || 1, 28)
      cursor = new Date(s.getFullYear(), s.getMonth(), day, 12)
    }
    let guard = 0
    while (cursor <= e && guard++ < 400) {
      push(r, cursor)
      if (r.frequency === 'Diaria') cursor.setDate(cursor.getDate() + 1)
      else if (r.frequency === 'Semanal') cursor.setDate(cursor.getDate() + 7)
      else if (r.frequency === 'Mensual') cursor.setMonth(cursor.getMonth() + 1)
      else if (r.frequency === 'Anual') cursor.setFullYear(cursor.getFullYear() + 1)
      else break
    }
  }
  return out.sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date))
}

// ---- Server aggregation: one JSON for the whole Projection page ----
export type SummaryMonth = {
  ym: string
  inc: number
  exp: number
  byCat: [string, number][]
  matched: number
  suggested: number
  unlinked: number
  transfers: number
}

export type MatchRow = {
  id: string
  status: MatchStatus
  classification: Classification
  ruleId: string | null
  occurrenceDate: string | null
}

export function summarize(
  months: { ym: string; txs: RealTx[]; occurrences: ProjOccurrence[] }[],
  linked: Set<string>,
  rulesById: Map<string, ProjRule>
): { monthly: SummaryMonth[]; matches: MatchRow[] } {
  const monthly: SummaryMonth[] = []
  const matches: MatchRow[] = []
  for (const m of months) {
    const auto = detectTransfers(m.txs, linked)
    const autoIds = new Set<string>()
    for (const p of auto) {
      autoIds.add(p.fromId)
      autoIds.add(p.toId)
    }
    let inc = 0
    let exp = 0
    const byCat = new Map<string, number>()
    let matched = 0
    let suggested = 0
    let unlinked = 0
    let transfers = 0
    for (const t of m.txs) {
      const tid = String((t as any).id)
      const isTransfer = linked.has(tid) || autoIds.has(tid)
      const match = matchOne(t, m.occurrences)
      const cls = classifyOne({
        t,
        isTransfer,
        match,
        ruleFrequency: match.ruleId ? rulesById.get(match.ruleId)?.frequency ?? null : null,
      })
      matches.push({ id: tid, status: match.status, classification: cls, ruleId: match.ruleId, occurrenceDate: match.occurrenceDate })
      if (isTransfer) {
        transfers++
        continue // Step B: excluded from totals
      }
      if (match.status === 'MATCHED') matched++
      else if (match.status === 'SUGGESTED_MATCH') suggested++
      else unlinked++
      const c = Number(t.credit) || 0
      const db = Number(t.debit) || 0
      inc += c
      exp += db
      if (db > 0) {
        const k = (t as any).category || 'Otro'
        byCat.set(k, (byCat.get(k) || 0) + db)
      }
    }
    monthly.push({
      ym: m.ym,
      inc,
      exp,
      byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
      matched,
      suggested,
      unlinked,
      transfers,
    })
  }
  return { monthly, matches }
}


// ---- Comparative Ledger (final blueprint) ----
// Every row answers: "Did I spend/earn what I planned, and how does this affect my savings?"
// Processing order per real tx: (A) noise filter -> (B) match vs projected -> (C) variable buckets.

export type LedgerStatus =
  | 'MATCHED'
  | 'SUGGESTED'
  | 'UNPLANNED'
  | 'TRANSFER'
  | 'BONUS'
  | 'PLANNED_UNSPENT'

export type LedgerRow = {
  id: string
  date: string
  entity: string
  fullDetail: string
  category: string
  account: string
  actual: number // signed: +income, -expense
  projected: number // signed: +income, -expense (planned)
  variance: number
  status: LedgerStatus
  classification: Classification
  ruleId: string | null
  ruleFrequency: string | null
  txId: string | null // real tx id (null for planned-unspent rows)
  isRecurringRule: boolean
}

export type BucketSummary = {
  category: string
  actual: number // total spent this month (positive number)
  budget: number // monthly budget from matching rules
  remaining: number // budget - actual
  over: boolean
}

// Categories treated as monthly "buckets" instead of 1-to-1 matching.
export const VARIABLE_CATEGORIES = new Set([
  'Gasolina',
  'Peajes E-ZPass',
  'Mantenimiento',
  'Llantas',
  'Comida',
])

// Rules carry no category column: map rule concept -> category by keyword.
export function ruleCategory(concept: string): string {
  const c = norm(concept)
  if (/gas|gasolina|fuel|shell|exxon|sunoco/.test(c)) return 'Gasolina'
  if (/ez[\s-]?pass|peaje|toll|mta|triboro/.test(c)) return 'Peajes E-ZPass'
  if (/manten|mantenimiento|repar|taller|mecanico|frenos|aceite/.test(c)) return 'Mantenimiento'
  if (/llanta|tire|neumatico|goma/.test(c)) return 'Llantas'
  if (/comida|food|restaur|eats|doordash|grubhub|pizza|burger|taco|sushi/.test(c)) return 'Comida'
  if (/seguro|insurance|geico|progressive|allstate/.test(c)) return 'Seguro comercial'
  if (/pago|payment|toyota|honda|nissan|ford/.test(c)) return 'Pago del vehículo'
  return ''
}

export function buildLedger(args: {
  txs: (RealTx & { category?: string })[]
  rules: ProjRule[]
  linked: Set<string>
  monthStart: string
  monthEnd: string
}): { rows: LedgerRow[]; buckets: BucketSummary[]; totals: { actualNet: number; projectedNet: number; gap: number } } {
  const { txs, rules, linked, monthStart, monthEnd } = args
  const rulesById = new Map(rules.map((r) => [r.id, r]))
  const occurrences = expandOccurrences(rules, monthStart, monthEnd)

  const occByRule = new Map<string, ProjOccurrence[]>()
  for (const o of occurrences) {
    if (!occByRule.has(o.id)) occByRule.set(o.id, [])
    occByRule.get(o.id)!.push(o)
  }

  const auto = detectTransfers(txs, linked)
  const autoIds = new Set<string>()
  for (const p of auto) {
    autoIds.add(p.fromId)
    autoIds.add(p.toId)
  }

  const rows: LedgerRow[] = []
  const usedOcc = new Set<string>() // "ruleId::date" consumed by 1-to-1 matches
  const varActualByCat = new Map<string, number>()

  for (const t of txs) {
    const tid = String((t as any).id)
    const c = Number(t.credit) || 0
    const db = Number(t.debit) || 0
    const actual = c > 0 ? c : -db // signed
    const isIncome = c > 0
    const cat = (t as any).category || 'Otro'

    // Step A: noise filter
    const isTransfer = linked.has(tid) || autoIds.has(tid)
    if (isTransfer) {
      rows.push({
        id: tid, date: t.date, entity: t.detail, fullDetail: t.detail, category: cat,
        account: t.bank_account, actual, projected: actual, variance: 0,
        status: 'TRANSFER', classification: 'INTERNAL_TRANSFER',
        ruleId: null, ruleFrequency: null, txId: tid, isRecurringRule: false,
      })
      continue
    }

    // Step C first: variable-category expenses aggregate to the bucket.
    if (!isIncome && VARIABLE_CATEGORIES.has(cat)) {
      varActualByCat.set(cat, (varActualByCat.get(cat) || 0) + db)
      const match = matchOne(t, occurrences)
      const ruleFrequency = match.ruleId ? rulesById.get(match.ruleId)?.frequency ?? null : null
      const cls = classifyOne({ t, isTransfer: false, match, ruleFrequency })
      rows.push({
        id: tid, date: t.date, entity: t.detail, fullDetail: t.detail, category: cat,
        account: t.bank_account, actual, projected: 0, variance: 0,
        status: match.status === 'MATCHED' ? 'MATCHED' : match.status === 'SUGGESTED_MATCH' ? 'SUGGESTED' : 'UNPLANNED',
        classification: cls, ruleId: match.ruleId, ruleFrequency,
        txId: tid, isRecurringRule: false,
      })
      continue
    }

    // Step B: 1-to-1 match vs projected occurrences
    const match = matchOne(t, occurrences)
    const rule = match.ruleId ? rulesById.get(match.ruleId) ?? null : null
    const cls = classifyOne({ t, isTransfer: false, match, ruleFrequency: rule?.frequency ?? null })
    let projected = 0
    let status: LedgerStatus
    if (match.status === 'MATCHED' || match.status === 'SUGGESTED_MATCH') {
      const amt = Number(rule?.amount) || 0
      projected = rule?.type === 'ingreso' ? amt : -amt
      if (match.occurrenceDate && match.ruleId) usedOcc.add(`${match.ruleId}::${match.occurrenceDate}`)
      status = match.status === 'MATCHED' ? 'MATCHED' : 'SUGGESTED'
    } else {
      projected = 0
      status = isIncome ? 'BONUS' : 'UNPLANNED'
    }
    const variance = isIncome ? actual - projected : projected - actual
    rows.push({
      id: tid, date: t.date, entity: t.detail, fullDetail: t.detail, category: cat,
      account: t.bank_account, actual, projected, variance,
      status, classification: cls,
      ruleId: match.ruleId, ruleFrequency: rule?.frequency ?? null,
      txId: tid, isRecurringRule: false,
    })
  }

  // Planned-but-unspent: occurrences with no matched real tx.
  for (const o of occurrences) {
    const key = `${o.id}::${o.occurrence_date}`
    if (usedOcc.has(key)) continue
    const amt = Number(o.amount) || 0
    const isInc = o.type === 'ingreso'
    const signed = isInc ? amt : -amt
    const rcat = ruleCategory(o.concept)
    if (!isInc && rcat && VARIABLE_CATEGORIES.has(rcat)) continue // covered by bucket
    rows.push({
      id: `plan::${key}`, date: o.occurrence_date, entity: o.concept, fullDetail: o.concept,
      category: rcat || 'Proyección', account: 'Cuenta principal',
      actual: 0, projected: signed, variance: isInc ? -signed : signed,
      status: 'PLANNED_UNSPENT', classification: isInc ? 'TRUE_INCOME' : 'FIXED_EXPENSE',
      ruleId: o.id, ruleFrequency: o.frequency, txId: null, isRecurringRule: true,
    })
  }

  // Step C: bucket summaries + per-row projected/variance for bucket rows.
  const buckets: BucketSummary[] = []
  const monthlyFactor = (freq: string) =>
    freq === 'Semanal' ? 4.33 : freq === 'Diaria' ? 30 : freq === 'Anual' ? 1 / 12 : 1
  for (const cat of VARIABLE_CATEGORIES) {
    let budget = 0
    for (const r of rules) {
      if (r.type !== 'gasto') continue
      if (ruleCategory(r.concept) !== cat) continue
      budget += (Number(r.amount) || 0) * monthlyFactor(r.frequency)
    }
    const actualSpent = varActualByCat.get(cat) || 0
    if (!budget && !actualSpent) continue
    buckets.push({ category: cat, actual: actualSpent, budget, remaining: budget - actualSpent, over: actualSpent > budget })
  }
  const bucketByCat = new Map(buckets.map((b) => [b.category, b]))
  for (const r of rows) {
    if (r.classification === 'INTERNAL_TRANSFER') continue
    const b = bucketByCat.get(r.category)
    if (!b || r.txId == null) continue
    r.projected = -b.budget
    r.variance = b.remaining
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

  let actualNet = 0
  let projectedNet = 0
  for (const r of rows) {
    if (r.classification === 'INTERNAL_TRANSFER') continue
    actualNet += r.actual
    projectedNet += r.projected
  }
  return { rows, buckets, totals: { actualNet, projectedNet, gap: projectedNet - actualNet } }
}

