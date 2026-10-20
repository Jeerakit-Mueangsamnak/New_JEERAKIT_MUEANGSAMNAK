import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Tests never use the real Supabase project: .env.local is not read here, and these fixed
// local-only values replace any NEXT_PUBLIC_SUPABASE_* / SUPABASE_SECRET_KEY in the shell.
// tests/setup/no-network.ts blocks every connection that leaves this machine.
const TEST_SUPABASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
  SUPABASE_SECRET_KEY: 'test-secret-key',
}

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
    env: TEST_SUPABASE_ENV,
    setupFiles: ['./tests/setup/no-network.ts'],
    exclude: [
      ...configDefaults.exclude,
      '**/*.test.ts.bak',
      '**/*.bak',
    ],
  },
})


