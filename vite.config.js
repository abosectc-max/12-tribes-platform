import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Raise the warning threshold — we now split aggressively so individual chunks
    // should be well under 500 KB; the default 500 KB warning still applies.
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── Vendor: React core ──
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router-dom/') ||
              id.includes('node_modules/react-router/') ||
              id.includes('node_modules/@remix-run/')) {
            return 'vendor-react';
          }

          // ── Vendor: recharts (largest dep — 5.2 MB source) ──
          if (id.includes('node_modules/recharts') ||
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-') ||
              id.includes('node_modules/eventemitter3') ||
              id.includes('node_modules/lodash') ||
              id.includes('node_modules/reduce-css-calc') ||
              id.includes('node_modules/prop-types')) {
            return 'vendor-charts';
          }

          // ── Remaining node_modules ──
          if (id.includes('node_modules/')) {
            return 'vendor-misc';
          }
        },
      },
    },
  },
})
