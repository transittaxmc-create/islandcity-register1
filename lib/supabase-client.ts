// lib/supabase-client.ts
// Cliente Supabase para el navegador (solo cuando se necesite).
// Creación perezosa: no revienta el build si las NEXT_PUBLIC_* aún no existen.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function supabaseClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) {
      throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
    }
    _client = createClient(url, anon)
  }
  return _client
}
