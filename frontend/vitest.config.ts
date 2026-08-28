import { defineConfig } from 'vitest/config'

// Standalone Vitest config (auto-detected, takes precedence over vite.config.ts
// for `vitest`). Kept separate from vite.config.ts on purpose: importing
// vitest/config there pulls in a second copy of Vite whose plugin types clash
// with Vite 8's. The app's Vite plugins aren't needed to run tests — esbuild
// handles the automatic JSX runtime below.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'vite/**/*.{test,spec}.ts'],
  },
})
