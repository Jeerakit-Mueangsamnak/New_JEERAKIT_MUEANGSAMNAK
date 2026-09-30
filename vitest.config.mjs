import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env.local manually if it exists
const envPath = path.resolve(__dirname, '.env.local')
const localEnv = {}

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim()
      const val = trimmed.slice(idx + 1).trim()
      localEnv[key] = val
    }
  }
}

// Resolution order: process.env (e.g. CI) > localEnv (.env.local) > ''
const resolveEnv = (key) => process.env[key] || localEnv[key] || ''

const supabaseUrl = resolveEnv('NEXT_PUBLIC_SUPABASE_URL')
const supabasePublishable = resolveEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
const hasRealSupabase = Boolean(
  supabaseUrl &&
  !supabaseUrl.includes('placeholder') &&
  (supabaseUrl.startsWith('http://') || supabaseUrl.startsWith('https://')) &&
  supabasePublishable &&
  !supabasePublishable.includes('placeholder')
)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    globals: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: resolveEnv('NEXT_PUBLIC_SUPABASE_URL'),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: resolveEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      SUPABASE_SECRET_KEY: resolveEnv('SUPABASE_SECRET_KEY'),
    },
    exclude: [
      ...configDefaults.exclude,
      '**/*.test.ts.bak',
      '**/*.bak',
      ...(hasRealSupabase ? [] : ['tests/split-payment-receipt-audit.test.ts']),
    ],
    testNamePattern: hasRealSupabase ? undefined : /^(?!.*(Split payment: records 1 transaction per channel)).*$/,
  },
})


