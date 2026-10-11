// lib/transfer-sender.ts
// Regla del remitente (Miguel): un Zelle se clasifica por de dónde viene.
// - Remitente = cuenta propia (su nombre, su negocio, sus máscaras) -> transferencia interna
// - Remitente = plataforma (Uber, Lyft, dispatch) -> pago/ingreso
// - "Es Zelle" por sí solo NO decide nada (algunas plataformas también pagan por Zelle).
// La memoria de remitentes vive en la tabla `transfer_senders` (sender -> transfer|payment).

/** Extrae la contraparte (remitente en créditos, destinatario en débitos) del detalle. */
export function extractCounterparty(detail: string): string | null {
  const d = detail || ''
  // Patrón Zelle con NAME:
  let m = d.match(/NAME:([A-Z0-9 *.\-•]+)/i)
  if (m && m[1].trim()) return m[1].trim().replace(/\s+/g, ' ')
  // "ZELLE DB DANIEL CABRERA ..." / "ZELLE HARD POST - ZELLE DB ..."
  m = d.match(/ZELLE\s+(?:HARD POST\s*-\s*)?(?:DB|CR|DEBIT|CREDIT)\s+([A-Z][A-Z ]+?)(?:\s{2,}|\s+ZELLE|$)/i)
  if (m && m[1].trim()) return m[1].trim().replace(/\s+/g, ' ')
  // "debit card transfer credit NOMBRE ..."
  m = d.match(/debit card transfer (?:credit|debit)\s+([A-Za-z*][A-Za-z* ]+)/i)
  if (m && m[1].trim()) return m[1].trim().replace(/\s+/g, ' ')
  return null
}

/** Normaliza un remitente para la memoria (case-insensitive, sin dobles espacios). */
export function normSender(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9*• ]/g, '').replace(/\s+/g, ' ').trim()
}

// Patrones de cuentas propias (su nombre, su negocio, sus tarjetas/máscaras)
const OWN_PATTERNS = [
  /transittax/i,
  /miguel cabre/i, // el banco lo trunca ("MIGUEL CABRE")
  /cabrera migue/i, // truncado del banco
  /branch\*miguel/i,
  /pro card/i, // "UBER PRO CARD" es su tarjeta propia, no la plataforma
  /••••7693/,
  /…0817|…9298|…6393|…3830|…8289|…6887|…3822|…4995|…5034/,
]
// Patrones de plataformas (pagan = ingreso). OJO: se evalúan DESPUÉS de OWN,
// así "UBER PRO CARD" (propia) no se confunde con Uber plataforma.
const PLATFORM_PATTERNS = [
  /\buber\b/i,
  /\blyft\b/i,
  /\bcurb\b/i,
  /\barro\b/i,
]

/**
 * Heurística por remitente. Devuelve 'transfer' | 'payment' | null (desconocido).
 * null = no adivinar: marcar "Por verificar" para que Miguel confirme.
 */
export function heuristicKind(norm: string): 'transfer' | 'payment' | null {
  if (!norm) return null
  if (OWN_PATTERNS.some((re) => re.test(norm))) return 'transfer'
  if (PLATFORM_PATTERNS.some((re) => re.test(norm))) return 'payment'
  return null
}
