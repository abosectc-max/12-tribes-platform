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
          // ── Vendor: React core + its transitive runtime deps ──
          // Must include scheduler, react-is, object-assign, loose-envify to
          // prevent circular chunk refs (vendor-misc → vendor-react → vendor-misc).
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router-dom/') ||
              id.includes('node_modules/react-router/') ||
              id.includes('node_modules/@remix-run/') ||
              id.includes('node_modules/scheduler/') ||
              id.includes('node_modules/react-is/') ||
              id.includes('node_modules/object-assign/') ||
              id.includes('node_modules/loose-envify/')) {
            return 'vendor-react';
          }

          // ── Vendor: recharts + all transitive deps ──
          // Must include react-transition-group, dom-helpers, decimal.js-light,
          // fast-equals, internmap to prevent circular chunk refs.
          if (id.includes('node_modules/recharts') ||
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-') ||
              id.includes('node_modules/eventemitter3') ||
              id.includes('node_modules/lodash') ||
              id.includes('node_modules/reduce-css-calc') ||
              id.includes('node_modules/prop-types') ||
              id.includes('node_modules/react-transition-group/') ||
              id.includes('node_modules/dom-helpers/') ||
              id.includes('node_modules/decimal.js-light/') ||
              id.includes('node_modules/fast-equals/') ||
              id.includes('node_modules/internmap/') ||
              id.includes('node_modules/clsx/') ||
              id.includes('node_modules/tiny-invariant/') ||
              id.includes('node_modules/react-smooth/') ||
              id.includes('node_modules/recharts-scale/')) {
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
