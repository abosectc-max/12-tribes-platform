import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'

// Pages
import Landing from './pages/Landing.jsx'
import MissionControl from './pages/MissionControl.jsx'
import InvestorPortal from './pages/InvestorPortal.jsx'
import TradingEngine from './pages/TradingEngine.jsx'
import RiskAnalytics from './pages/RiskAnalytics.jsx'
import Performance from './pages/Performance.jsx'
import MarketIntel from './pages/MarketIntel.jsx'
import MobileApp from './pages/MobileApp.jsx'
import PaperTrading from './pages/PaperTrading.jsx'
import TermsConditions from './pages/TermsConditions.jsx'
import InstallPrompt from './components/InstallPrompt.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const glass = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 50%, rgba(220,230,255,0.12) 100%)",
  backdropFilter: "blur(80px) saturate(220%) brightness(1.15)",
  WebkitBackdropFilter: "blur(80px) saturate(220%) brightness(1.15)",
  border: "1px solid rgba(255,255,255,0.28)",
  boxShadow: "0 8px 40px rgba(0,0,0,0.08), 0 0 120px rgba(180,200,255,0.06), inset 0 1px 0 rgba(255,255,255,0.4)",
}

const NAV_ITEMS = [
  { path: '/', label: 'Home', icon: '⬡' },
  { path: '/mission-control', label: 'Command', icon: '◉' },
  { path: '/investor-portal', label: 'Portal', icon: '◈' },
  { path: '/trading-engine', label: 'Engine', icon: '◆' },
  { path: '/risk-analytics', label: 'Risk', icon: '◇' },
  { path: '/performance', label: 'Perf', icon: '▣' },
  { path: '/market-intel', label: 'Intel', icon: '▤' },
  { path: '/paper-trading', label: 'Paper', icon: '⬢' },
]

function AppNav() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)

  useEffect(() => {
    const h = () => setWidth(window.innerWidth)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  const isMobile = width < 768

  // Hide nav on landing page, mobile app, and investor portal (has its own sidebar nav)
  if (location.pathname === '/' || location.pathname === '/mobile' || location.pathname === '/investor-portal') return null

  // Mobile: hamburger-triggered slide-up menu
  if (isMobile) {
    return (
      <>
        {/* Mobile hamburger button */}
        <button onClick={() => setMobileOpen(!mobileOpen)} style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 10001,
          width: 52, height: 52, borderRadius: 16, border: 'none', cursor: 'pointer',
          ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, color: '#00D4FF',
        }}>
          {mobileOpen ? '✕' : '☰'}
        </button>

        {/* Mobile overlay */}
        {mobileOpen && (
          <div onClick={() => setMobileOpen(false)} style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.5)',
          }} />
        )}

        {/* Mobile nav panel */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10000,
          ...glass, borderRadius: '20px 20px 0 0', padding: '20px 16px',
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
          transform: mobileOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s ease',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {NAV_ITEMS.map(item => {
              const active = location.pathname === item.path
              return (
                <Link key={item.path} to={item.path}
                  onClick={() => setMobileOpen(false)}
                  style={{
                    padding: '12px 8px', borderRadius: 14, textAlign: 'center',
                    background: active ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.04)',
                    color: active ? '#00D4FF' : 'rgba(255,255,255,0.5)',
                    fontSize: 11, fontWeight: 600, textDecoration: 'none',
                  }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</div>
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      </>
    )
  }

  // Desktop: floating bar
  return (
    <div style={{
      ...glass,
      position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, borderRadius: 20, padding: '8px 12px',
      display: 'flex', gap: 4, alignItems: 'center',
    }}>
      {NAV_ITEMS.map(item => {
        const active = location.pathname === item.path
        return (
          <Link
            key={item.path}
            to={item.path}
            style={{
              padding: '8px 14px', borderRadius: 14,
              fontSize: 12, fontWeight: 500,
              background: active ? 'rgba(0,212,255,0.15)' : 'transparent',
              color: active ? '#00D4FF' : 'rgba(255,255,255,0.5)',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', gap: 5,
              whiteSpace: 'nowrap', textDecoration: 'none',
            }}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        )
      })}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ paddingBottom: 70 }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/mission-control" element={<ErrorBoundary><MissionControl /></ErrorBoundary>} />
          <Route path="/investor-portal" element={<ErrorBoundary><InvestorPortal /></ErrorBoundary>} />
          <Route path="/trading-engine" element={<ErrorBoundary><TradingEngine /></ErrorBoundary>} />
          <Route path="/risk-analytics" element={<ErrorBoundary><RiskAnalytics /></ErrorBoundary>} />
          <Route path="/performance" element={<ErrorBoundary><Performance /></ErrorBoundary>} />
          <Route path="/market-intel" element={<ErrorBoundary><MarketIntel /></ErrorBoundary>} />
          <Route path="/mobile" element={<ErrorBoundary><MobileApp /></ErrorBoundary>} />
          <Route path="/paper-trading" element={<ErrorBoundary><PaperTrading /></ErrorBoundary>} />
          <Route path="/terms" element={<TermsConditions />} />
        </Routes>
        <AppNav />
        <InstallPrompt />
      </div>
    </BrowserRouter>
  )
}