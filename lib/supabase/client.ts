import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js'
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase/env'

let clientInstance: SupabaseClient | null = null

export function createClient(): SupabaseClient {
  if (clientInstance) return clientInstance

  const supabaseUrl = getSupabaseUrl() || 'https://placeholder.supabase.co'
  const supabasePublishableKey = getSupabasePublicKey() || 'placeholder-publishable-key'

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    clientInstance = createBrowserClient(supabaseUrl, supabasePublishableKey)
  } else {
    clientInstance = createSupabaseClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  return clientInstance
}
