import { useState, useEffect } from 'react'

// ═══════════════════════════════════════════
//   12 TRIBES — PWA INSTALL PROMPT
//   iOS: "Add to Home Screen" instruction banner
//   Android/Desktop: native install prompt
//   Apple Liquid Glass UI
// ═══════════════════════════════════════════

const glass = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 20,
  boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4)",
}

function isIOSSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua)
}

function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false)
  const [platform, setPlatform] = useState('ios') // 'ios' | 'android' | null
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Don't show if already installed as PWA
    if (isStandalone()) return

    // Check if previously dismissed this session
    try {
      if (sessionStorage.getItem('12tribes-install-dismissed')) return
    } catch { /* ignore */ }

    // iOS Safari detection
    if (isIOSSafari()) {
      setPlatform('ios')
      // Delay showing by 3 seconds so it doesn't overwhelm on first load
      const timer = setTimeout(() => setShow(true), 3000)
      return () => clearTimeout(timer)
    }

    // Android / Desktop: listen for native install prompt
    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setPlatform('android')
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleDismiss = () => {
    setShow(false)
    setDismissed(true)
    try { sessionStorage.setItem('12tribes-install-dismissed', '1') } catch { /* ignore */ }
  }

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const result = await deferredPrompt.userChoice
      if (result.outcome === 'accepted') {
        setShow(false)
      }
      setDeferredPrompt(null)
    }
  }

  if (!show || dismissed) return null

  // iOS: Show "Add to Home Screen" instructions
  if (platform === 'ios') {
    return (
      <>
        {/* Backdrop */}
        <div onClick={handleDismiss} style={{
          position: 'fixed', inset: 0, zIndex: 99998,
          background: 'rgba(0,0,0,0.5)',
        }} />

        {/* Banner */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 99999,
          ...glass,
          borderRadius: '24px 24px 0 0',
          padding: '28px 24px',
          paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
        }}>
          {/* Close button */}
          <button onClick={handleDismiss} style={{
            position: 'absolute', top: 14, right: 18,
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
            fontSize: 20, cursor: 'pointer', padding: 4,
          }}>✕</button>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: 'linear-gradient(135deg, #00D4FF, #A855F7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 900, color: '#fff',
              boxShadow: '0 4px 16px rgba(0,212,255,0.3)',
            }}>12</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Install 12 Tribes</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Add to your Home Screen for the full app experience</div>
            </div>
          </div>

          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
            <Step number={1}>
              Tap the <ShareIcon /> <span style={{ fontWeight: 600, color: '#00D4FF' }}>Share</span> button in Safari's toolbar
            </Step>
            <Step number={2}>
              Scroll down and tap <span style={{ fontWeight: 600, color: '#00D4FF' }}>"Add to Home Screen"</span>
            </Step>
            <Step number={3}>
              Tap <span style={{ fontWeight: 600, color: '#00D4FF' }}>"Add"</span> in the top right corner
            </Step>
          </div>

          {/* Benefits */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
          }}>
            {[
              { icon: '📱', label: 'Full Screen' },
              { icon: '⚡', label: 'Fast Launch' },
              { icon: '🔔', label: 'Offline Ready' },
            ].map(b => (
              <div key={b.label} style={{
                textAlign: 'center', padding: '10px 6px', borderRadius: 12,
                background: 'rgba(255,255,255,0.04)',
              }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{b.icon}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{b.label}</div>
              </div>
            ))}
          </div>

          {/* Arrow pointing down to Safari share button */}
          <div style={{
            position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '10px solid transparent', borderRight: '10px solid transparent',
            borderTop: '10px solid rgba(255,255,255,0.04)',
          }} />
        </div>
      </>
    )
  }

  // Android / Desktop: Native install button
  if (platform === 'android' && deferredPrompt) {
    return (
      <div style={{
        position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
        zIndex: 99999, ...glass, padding: '16px 24px',
        display: 'flex', alignItems: 'center', gap: 16,
        maxWidth: 420, width: 'calc(100% - 32px)',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: 'linear-gradient(135deg, #00D4FF, #A855F7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 900, color: '#fff',
        }}>12</div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Install 12 Tribes</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Get the full app experience</div>
        </div>

        <button onClick={handleInstall} style={{
          padding: '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #00D4FF, #A855F7)',
          color: '#fff', fontSize: 13, fontWeight: 700,
          boxShadow: '0 4px 16px rgba(0,212,255,0.3)',
        }}>Install</button>

        <button onClick={handleDismiss} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
          fontSize: 16, cursor: 'pointer', padding: 4,
        }}>✕</button>
      </div>
    )
  }

  return null
}

// Sub-components
function Step({ number, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 9, flexShrink: 0,
        background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: '#00D4FF',
      }}>{number}</div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
        {children}
      </div>
    </div>
  )
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D4FF" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: 'middle', margin: '0 2px' }}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  )
}
