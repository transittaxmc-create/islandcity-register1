// lib/supabase-server.ts
// Cliente Supabase SOLO para el servidor (Route Handlers).
// Usa la SERVICE ROLE KEY: nunca se expone al navegador.
import { createClient } from '@supabase/supabase-js'

export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Vercel.'
    )
  }
  return createClient(url, key)
}
