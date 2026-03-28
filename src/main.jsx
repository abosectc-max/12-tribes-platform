import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

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
