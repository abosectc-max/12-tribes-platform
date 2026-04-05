import { useState } from 'react';
import { haptics } from '../hooks/useHaptics';

export default function RefreshButton({ onRefresh, label = "Refresh", style = {} }) {
  const [spinning, setSpinning] = useState(false);
  const handleClick = async () => {
    haptics.refresh();
    setSpinning(true);
    try { await Promise.resolve(onRefresh()); } catch {}
    setTimeout(() => setSpinning(false), 600);
  };
  return (
    <button onClick={handleClick} disabled={spinning} style={{
      padding: '8px 18px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
      background: spinning ? 'rgba(0,212,255,0.08)' : 'transparent',
      color: spinning ? '#00D4FF' : 'rgba(255,255,255,0.5)',
      fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
      transition: 'all 0.2s', fontWeight: 500, ...style,
    }}>
      <span style={{
        display: 'inline-block',
        transition: 'transform 0.6s ease',
        transform: spinning ? 'rotate(360deg)' : 'rotate(0deg)',
        fontSize: 14,
      }}>↻</span>
      {label}
    </button>
  );
}
