/// <reference types="vitest/config" />
import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
const config: UserConfig & { test?: unknown } = {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: '/goa2-drafter/',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Force the local (no-backend) store during tests so the suite never
    // touches a real Supabase project (deterministic + no DB pollution),
    // even when a developer has VITE_SUPABASE_* set in .env.local.
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
}

export default defineConfig(config)
