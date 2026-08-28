import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { swBuildHash } from './vite/sw-build-hash.ts'

// https://vite.dev/config/
// Test config lives in vitest.config.ts (kept separate so the Vitest type
// world never collides with Vite 8's rolldown plugin types here).
export default defineConfig({
  plugins: [react(), tailwindcss(), swBuildHash()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the Laravel backend during development.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
