import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js'

let clientInstance: SupabaseClient | null = null

export function createClient(): SupabaseClient {
  if (clientInstance) return clientInstance

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'placeholder-publishable-key'

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    clientInstance = createBrowserClient(supabaseUrl, supabasePublishableKey)
  } else {
    clientInstance = createSupabaseClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  return clientInstance
}
