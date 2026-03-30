import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #0a0a1a 0%, #0d1117 50%, #0a0a1a 100%)',
          color: '#fff',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
        }}>
          <div style={{
            maxWidth: 600,
            background: "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 50%, rgba(239,68,68,0.06) 100%)",
            backdropFilter: "blur(60px) saturate(200%) brightness(1.1)",
            WebkitBackdropFilter: "blur(60px) saturate(200%) brightness(1.1)",
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 24,
            boxShadow: "0 8px 32px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.2)",
            padding: 40,
            textAlign: 'center',
          }}>
            <div style={{
              width: 60, height: 60, borderRadius: 16, margin: '0 auto 20px',
              background: 'rgba(239,68,68,0.15)', border: '2px solid rgba(239,68,68,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28,
            }}>⚠️</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#EF4444' }}>
              Component Error
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 20, lineHeight: 1.6 }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </div>
            <div style={{
              padding: 16, borderRadius: 14, background: 'rgba(0,0,0,0.3)',
              fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)',
              textAlign: 'left', maxHeight: 200, overflow: 'auto', marginBottom: 20,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {this.state.error?.stack?.slice(0, 500) || 'No stack trace available'}
            </div>
            <button
              onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
              style={{
                padding: '12px 32px', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #00D4FF, #A855F7)',
                color: '#fff', fontSize: 14, fontWeight: 600,
              }}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
