// app/components/guia-content.ts
// Structured content for the Guide (Help Center → Guide).
// Everything the Guide shows lives here, so documenting a new feature
// means adding one entry below. English. Keep each entry SHORT.
'use client'

export type GuideGo = { view: string; tab?: string; href?: string; label: string }

export type GuideEntry = {
  id: string
  section: string // matches a GUIDE_SECTIONS id
  title: string // exact label as it appears in the app
  keywords: string[]
  what: string
  how?: string
  calc?: string
  source?: string
  go?: GuideGo
}

export const GUIDE_SECTIONS: { id: string; title: string }[] = [
  { id: 'views', title: 'Bank & Projections views' },
  { id: 'register', title: 'Projections register' },
  { id: 'daily', title: 'Daily panel' },
  { id: 'kpis', title: 'KPIs & charts' },
  { id: 'settings', title: 'Settings' },
  { id: 'sync', title: 'Bank sync' },
  { id: 'rules', title: 'Accounting rules' },
  { id: 'pages', title: 'Other pages' },
]

export const GUIDE_ENTRIES: GuideEntry[] = [
  // ---------- views ----------
  {
    id: 'bank-view',
    section: 'views',
    title: 'Bank view (🏦 Bank)',
    keywords: ['bank', 'actual', 'real', 'statement', 'last 30 days', 'transactions'],
    what: 'Your actual bank movements for the last 30 days, statement-style. No projections here.',
    how: 'Tap 🏦 Bank at the top of the Projections page. Pick the bank with the Bank dropdown.',
    source: 'Live from Plaid (bank_transactions). Balances are the bank\'s own current balances.',
    go: { view: 'Projections', label: 'Go to Projections' },
  },
  {
    id: 'projections-view',
    section: 'views',
    title: 'Projections view (🔮 Projections)',
    keywords: ['projections', 'forecast', 'combined', 'register', 'future'],
    what: 'One combined register from today through Dec 31: actual bank rows (🏦) plus your projected rows (🔮/Proj). The app opens here.',
    how: 'Tap 🔮 Projections at the top. Everything below — rules, Daily, the register — feeds it.',
    calc: 'Bank balance column always shows the real bank balance (Plaid). Projected balance = bank ± projected rows.',
    go: { view: 'Projections', label: 'Go to Projections' },
  },
  // ---------- register ----------
  {
    id: 'entry-row',
    section: 'register',
    title: 'First row: quick entry',
    keywords: ['add', 'new', 'entry', 'row', 'create', 'projection', 'vendor', 'category', 'frequency'],
    what: 'The first row of the register IS the entry form. No popups.',
    how: 'Fill date, vendor, category, frequency (+ until), then Income or Expense, and tap ✓. ✕ clears the row. Tapping a saved projected row loads it here for editing.',
    go: { view: 'Projections', label: 'Go to the register' },
  },
  {
    id: 'columns',
    section: 'register',
    title: 'Register columns',
    keywords: ['columns', 'date', 'vendor', 'category', 'frequency', 'income', 'expense', 'bank balance', 'projected balance', 'weekday'],
    what: 'Date (with weekday) · Vendor · Category · Frequency · Income · Expense · Bank balance · Projected balance.',
    calc: 'Bank balance = real Plaid balance of the selected bank — never negative unless the bank truly is. Projected balance may go negative: that is your early warning to earn more before that day.',
    go: { view: 'Projections', label: 'See the columns' },
  },
  {
    id: 'edit-scope',
    section: 'register',
    title: 'Editing: which entries change',
    keywords: ['edit', 'scope', 'only this', 'future', 'past', 'all', 'recurring'],
    what: 'When you save an edit to a projected row, the app asks which occurrences change.',
    how: 'Only this one · This and past ones · This and future ones · All. The edit applies in place — it never duplicates. Actual bank rows (🏦) can never be edited.',
    go: { view: 'Projections', label: 'Go to the register' },
  },
  {
    id: 'delete-row',
    section: 'register',
    title: '× Delete (projected rows only)',
    keywords: ['delete', 'remove', 'x', 'occurrence'],
    what: 'Each projected row has a × that deletes only that occurrence.',
    how: 'The rule keeps generating the other occurrences. Actual bank rows (🏦) have no ×. The screen updates instantly.',
    go: { view: 'Projections', label: 'Go to the register' },
  },
  {
    id: 'zero-rows',
    section: 'register',
    title: '$0 rows stay visible',
    keywords: ['zero', '0', 'day off', 'no work'],
    what: 'A projected row edited to $0.00 stays in the register.',
    how: 'Use it to mark a day you did not work: the row remains as proof of the plan vs. reality.',
  },
  {
    id: 'sticky-totals',
    section: 'register',
    title: 'Sticky totals footer',
    keywords: ['totals', 'footer', 'opening', 'closing', 'sticky'],
    what: 'The totals bar is pinned to the bottom of the register — always visible.',
    calc: 'Opening balance + income − expenses = Closing. Shows "+$X other" when Other funds are active (tap it to adjust).',
  },
  {
    id: 'recurring-rules',
    section: 'register',
    title: 'Recurring rules',
    keywords: ['recurring', 'rules', 'repeat', 'daily', 'weekly', 'monthly', 'until'],
    what: 'The list above the register: income and expenses that repeat (e.g. $400 daily deposit, $924 weekly leasing, $1,500 rent on the 19th).',
    how: 'Each rule has a start date, a frequency, and an optional until date. They feed the totals and the register rows.',
  },
  {
    id: 'sort-hide',
    section: 'register',
    title: 'Sort & Hide transfers',
    keywords: ['sort', 'order', 'hide transfers', 'filter'],
    what: 'Sort the register by date, detail, or amount. "Hide transfers" removes internal bank-to-bank moves from view.',
    how: 'Transfers are never income — hiding them only cleans the view.',
  },
  // ---------- daily ----------
  {
    id: 'daily-entry',
    section: 'daily',
    title: 'Daily: quick entry',
    keywords: ['daily', 'jobs', 'platform', 'entry', 'today'],
    what: 'Enter each job of the day: platform + amount. The date is always today.',
    how: 'Pick the platform (or add a new one), type the amount, tap +. The mini-list below is editable; drafts auto-save per day.',
    go: { view: 'Projections', label: 'Go to Daily' },
  },
  {
    id: 'close-day',
    section: 'daily',
    title: 'Close day',
    keywords: ['close day', 'finish', 'pay date', 'pending'],
    what: 'When the day is done, "Close day" turns each platform total into a pending deposit.',
    how: 'The app asks one pay date per platform, then creates projected income rows (DAILY · {platform}) for those dates.',
    go: { view: 'Projections', label: 'Go to Daily' },
  },
  {
    id: 'pending-deposits',
    section: 'daily',
    title: 'Pending deposits → Match',
    keywords: ['pending', 'deposits', 'match', 'fulfill', 'adjust', 'reconcile'],
    what: 'Deposits you are still waiting for. When the money lands, "Match" pairs the projection with the actual bank credit.',
    how: 'Pick the actual deposit; then "Adjust to $X and mark fulfilled" (if the amount differs) or "Mark fulfilled". Marking fulfilled deletes the rule — the real deposit stays — so income is never double-counted.',
    go: { view: 'Projections', label: 'Go to Daily' },
  },
  {
    id: 'closed-days',
    section: 'daily',
    title: 'Closed days',
    keywords: ['closed', 'history', 'past days'],
    what: 'History of every day you closed, with its platform totals.',
    source: 'Saved on this device per day.',
  },
  // ---------- kpis ----------
  {
    id: 'kpi-income',
    section: 'kpis',
    title: 'Projected income',
    keywords: ['kpi', 'projected income', 'total income'],
    what: 'Total income projected from today through Dec 31.',
    calc: 'Sum of all projected income rows in the window. The subtitle shows how many items.',
  },
  {
    id: 'kpi-expenses',
    section: 'kpis',
    title: 'Projected expenses',
    keywords: ['kpi', 'projected expenses', 'total expenses'],
    what: 'Total expenses projected from today through Dec 31.',
    calc: 'Sum of all projected expense rows in the window. The subtitle shows how many items.',
  },
  {
    id: 'kpi-bank',
    section: 'kpis',
    title: 'Bank balance · All accounts',
    keywords: ['kpi', 'bank balance', 'all accounts', 'total balance'],
    what: 'The sum of the current balances of ALL your bank accounts.',
    calc: 'Adds Plaid current_balance across every connected account. NOTE: Miguel is still deciding whether this should follow the bank filter instead.',
    source: 'Plaid, live.',
  },
  {
    id: 'kpi-closing',
    section: 'kpis',
    title: 'Projected closing',
    keywords: ['kpi', 'closing', 'final', 'balance total', 'formula'],
    what: 'Where you land on Dec 31 if everything projected happens.',
    calc: 'Bank + other funds + projected income − projected expenses.',
  },
  {
    id: 'kpi-lowest',
    section: 'kpis',
    title: 'Lowest point',
    keywords: ['kpi', 'lowest', 'critical', 'minimum', 'worst day'],
    what: 'Your worst projected day between today and Dec 31.',
    how: 'If it falls below your minimum (safety floor), the date is flagged — earn more before that day.',
  },
  {
    id: 'duo-chart',
    section: 'kpis',
    title: 'Income vs expenses by month',
    keywords: ['chart', 'graph', 'duo', 'monthly', 'income vs expenses'],
    what: 'Blue bars = income, orange bars = expenses, per month. Actuals so far, projected ahead.',
    source: 'Bank transactions + projections.',
  },
  // ---------- settings ----------
  {
    id: 'other-funds',
    section: 'settings',
    title: 'Other funds (Settings → Projections)',
    keywords: ['other funds', 'extra', 'cash', 'accounts', 'opening balance', 'adjust'],
    what: 'Adds cash from your other accounts into the projection\'s opening balance. Projections only — Bank is untouched.',
    how: 'Check the accounts you want to include (only positive balances appear; the main bank is excluded to avoid double-counting). The footer shows "+$X other" — tap it to adjust.',
    source: 'Live Plaid balances.',
    go: { view: 'Settings', tab: 'proyecciones', label: 'Go to Settings → Projections' },
  },
  {
    id: 'accounts-banks',
    section: 'settings',
    title: 'Accounts & banks (Settings → Accounts & banks)',
    keywords: ['accounts', 'banks', 'categories', 'vendors', 'lists', 'manage', 'plaid'],
    what: 'Manage your lists: bank accounts, journal categories, vendors.',
    how: 'Type a name and tap + Add. Anything added here appears in the register menus. "+ Add bank account (Plaid)" links a new bank.',
    go: { view: 'Settings', tab: 'cuentas', label: 'Go to Settings → Accounts & banks' },
  },
  {
    id: 'settings-general',
    section: 'settings',
    title: 'Settings → General',
    keywords: ['settings', 'general', 'display', 'period', 'preferences'],
    what: 'Display preferences and the default analysis period (Last 6 months / Last 12 months / Current year).',
    go: { view: 'Settings', tab: 'general', label: 'Go to Settings → General' },
  },
  // ---------- sync ----------
  {
    id: 'plaid-sync',
    section: 'sync',
    title: 'Bank sync',
    keywords: ['sync', 'plaid', 'update', 'refresh', 'automatic', 'manual'],
    what: 'Your bank data arrives automatically every morning (~7:45am), new movements only.',
    how: 'To pull right now: Bank statement page → "Synced bank" → sync. Pending transactions are included — you see what is truly committed.',
    source: 'Plaid.',
    go: { href: '/bancos/conciliacion', view: '', label: 'Go to Bank statement' },
  },
  // ---------- rules ----------
  {
    id: 'rule-transfers',
    section: 'rules',
    title: 'Rule 1 — Transfers are never income',
    keywords: ['rule', 'transfers', 'never income', 'accounting'],
    what: 'Moving money between your own accounts changes nothing: it is not income and not an expense.',
  },
  {
    id: 'rule-bank-balance',
    section: 'rules',
    title: 'Rule 2 — Bank balance is always the real bank',
    keywords: ['rule', 'bank balance', 'real', 'negative', 'projected'],
    what: 'The "Bank balance" column always shows the real bank balance (Plaid) — never negative unless the bank truly is. Only "Projected balance" may go negative, as your early warning to earn more.',
  },
  {
    id: 'rule-origin',
    section: 'rules',
    title: 'Rule 3 — Every transfer keeps its origin',
    keywords: ['rule', 'origin', 'traced', 'transfer'],
    what: 'Each transfer carries its traced origin, so the original deposit and the movement between accounts are never confused or double-counted.',
  },
  {
    id: 'rule-zelle',
    section: 'rules',
    title: 'Rule 4 — Zelle is classified by sender',
    keywords: ['rule', 'zelle', 'sender', 'verify'],
    what: 'A Zelle from your own account is a transfer; from a platform it is income. Unknown senders go to "Zelles to verify" — your answer is saved and auto-applies next time.',
  },
  {
    id: 'rule-reconcile',
    section: 'rules',
    title: 'Rule 5 — Projections may exceed income; the Bank must reconcile',
    keywords: ['rule', 'reconcile', 'cent', 'expenses exceed'],
    what: 'In Projections, expenses may exceed income. In the Bank, everything must reconcile to the cent.',
  },
  // ---------- pages ----------
  {
    id: 'overview-page',
    section: 'pages',
    title: 'Overview page',
    keywords: ['overview', 'dashboard', 'summary'],
    what: 'Summary widgets: available balance, month income/expenses, net flow, actual-vs-projected chart, balance breakdown, and the cash-flow pulse.',
    go: { view: 'Overview', label: 'Go to Overview' },
  },
  {
    id: 'movements-page',
    section: 'pages',
    title: 'Movements page',
    keywords: ['movements', 'list', 'actual vs projected'],
    what: 'Every movement with its account, actual vs projected amounts, and edit/delete actions. "New movement" opens the entry form.',
    go: { view: 'Movements', label: 'Go to Movements' },
  },
  {
    id: 'bank-statement-page',
    section: 'pages',
    title: 'Bank statement page',
    keywords: ['bank statement', 'reconciliation', 'journal', 'transfers', 'zelles', 'receipts'],
    what: 'The accounting back office: reconciliation bridge (opening + income + transfers in − expenses − transfers out = closing), the editable Journal, bank-to-bank transfers with origin trails, Zelles to verify, receipts, and bank sync/import.',
    go: { href: '/bancos/conciliacion', view: '', label: 'Go to Bank statement' },
  },
]

export function searchGuide(q: string): GuideEntry[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  const words = needle.split(/\s+/)
  return GUIDE_ENTRIES.filter((e) => {
    const hay = `${e.title} ${e.section} ${e.keywords.join(' ')} ${e.what} ${e.how || ''} ${e.calc || ''} ${e.source || ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
