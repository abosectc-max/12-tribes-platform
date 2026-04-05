import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// ═══════ CACHE INTEGRITY GUARD ═══════
// Detect if the entry module loaded but React failed to mount within 4 seconds.
// This catches the "HTML served as JS from poisoned disk cache" scenario:
// Vercel's catch-all rewrite was previously returning index.html for non-existent
// asset URLs, inheriting the /assets/ immutable cache header. Browsers cached the
// HTML as if it were JS (1-year immutable). Fix: vercel.json now excludes /assets/
// from the catch-all. Guard below self-heals any browser still holding a bad entry.
if (typeof window !== 'undefined') {
  setTimeout(() => {
    const root = document.getElementById('root');
    if (root && root.childNodes.length === 0) {
      // Root still empty — module likely cached as wrong MIME. Force fresh load.
      console.warn('[12Tribes] Root empty after 4s — clearing cache and reloading');
      if ('caches' in window) {
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).finally(() => {
          window.location.href = window.location.href.split('?')[0] + '?_reload=' + Date.now();
        });
      } else {
        window.location.href = window.location.href.split('?')[0] + '?_reload=' + Date.now();
      }
    }
  }, 4000);
}

// ═══════ SERVICE WORKER REGISTRATION ═══════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service worker registered, scope:', reg.scope)

        // Auto-update when new SW is available
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                console.log('[PWA] New version available — refresh to update')
              }
            })
          }
        })
      })
      .catch((err) => {
        console.warn('[PWA] Service worker registration failed:', err)
      })
  })
}
