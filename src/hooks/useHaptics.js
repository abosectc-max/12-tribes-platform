// ═══════════════════════════════════════════
//   12 TRIBES — HAPTIC FEEDBACK ENGINE
//   Vibration API (Android/Chrome) +
//   AudioContext micro-click (iOS/Safari fallback)
//   Shared across all platform pages
// ═══════════════════════════════════════════

const haptics = {
  _ctx: null,
  _getCtx() {
    if (!this._ctx) {
      try { this._ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this._ctx = null; }
    }
    return this._ctx;
  },
  _vibrate(pattern) {
    try { if (navigator.vibrate) { navigator.vibrate(pattern); return true; } } catch {}
    return false;
  },
  _audioClick(freq = 1800, duration = 0.012, gain = 0.08) {
    try {
      const ctx = this._getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.stop(ctx.currentTime + duration + 0.01);
    } catch {}
  },
  light()   { if (!this._vibrate(10)) this._audioClick(2200, 0.008, 0.04); },
  medium()  { if (!this._vibrate(20)) this._audioClick(1800, 0.015, 0.06); },
  heavy()   { if (!this._vibrate([15, 30, 15])) this._audioClick(1200, 0.025, 0.1); },
  success() { if (!this._vibrate([10, 50, 20])) this._audioClick(2400, 0.02, 0.06); },
  error()   { if (!this._vibrate([30, 50, 30, 50, 30])) this._audioClick(400, 0.04, 0.12); },
  refresh() { if (!this._vibrate([8, 40, 12])) this._audioClick(1600, 0.015, 0.05); },
  select()  { if (!this._vibrate(6)) this._audioClick(2800, 0.006, 0.03); },
};

export default haptics;
export { haptics };
