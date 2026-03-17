import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Cliente Supabase para uso em componentes React (browser).
 * Usa a anon key — seguro para o client-side.
 */
export function getSupabaseBrowser() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

/**
 * Cliente Supabase para uso em API Routes (server-side).
 * Usa a service role key — NUNCA expor no browser.
 */
export function getSupabaseServer() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not defined. This client can only be used in API Routes.'
    )
  }

  return createClient(supabaseUrl, serviceRoleKey)
}
