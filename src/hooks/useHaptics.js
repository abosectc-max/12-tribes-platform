// useHaptics.js — Cross-platform haptic feedback (iOS + Android)
// iOS: AudioContext micro-click (requires user gesture to initialize)
// Android/Chrome: Vibration API
// Fallback: CSS visual micro-pulse

import { useCallback, useRef, useEffect } from 'react';

let _audioCtx = null;
let _audioReady = false;
let _initAttempted = false;

// Initialize AudioContext — must be called from user gesture on iOS
function _initAudio() {
  if (_audioCtx && _audioReady) return true;

  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;

    if (!_audioCtx) {
      _audioCtx = new AC();
    }

    // iOS Safari starts AudioContext in 'suspended' state
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().then(() => {
        _audioReady = true;
      }).catch(() => {});
    }

    if (_audioCtx.state === 'running') {
      _audioReady = true;
    }

    return _audioReady;
  } catch (e) {
    return false;
  }
}

// Play a micro-click via AudioContext (works on iOS after user gesture)
function _playMicroClick(intensity = 'medium') {
  if (!_audioCtx || _audioCtx.state !== 'running') {
    // Try to resume on each call — iOS may have unlocked after a tap
    if (_audioCtx && _audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(() => {});
    }
    if (!_audioCtx || _audioCtx.state !== 'running') return false;
  }

  try {
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);

    // Intensity profiles
    const profiles = {
      light:  { freq: 4000, gainVal: 0.01, duration: 0.008 },
      medium: { freq: 3200, gainVal: 0.025, duration: 0.012 },
      heavy:  { freq: 2400, gainVal: 0.045, duration: 0.020 },
      success:{ freq: 2800, gainVal: 0.03, duration: 0.015 },
      error:  { freq: 200,  gainVal: 0.04, duration: 0.025 },
    };
    const p = profiles[intensity] || profiles.medium;

    osc.frequency.value = p.freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(p.gainVal, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + p.duration);

    osc.start(_audioCtx.currentTime);
    osc.stop(_audioCtx.currentTime + p.duration + 0.005);

    return true;
  } catch (e) {
    return false;
  }
}

export function useHaptics() {
  const lastFired = useRef(0);
  const initialized = useRef(false);

  // One-time setup: register user gesture listener to unlock AudioContext on iOS
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const unlockAudio = () => {
      if (!_initAttempted) {
        _initAttempted = true;
        _initAudio();
      } else if (_audioCtx && _audioCtx.state === 'suspended') {
        _audioCtx.resume().catch(() => {});
      }

      if (_audioReady) {
        // Successfully initialized — remove listeners
        document.removeEventListener('touchstart', unlockAudio, true);
        document.removeEventListener('touchend', unlockAudio, true);
        document.removeEventListener('click', unlockAudio, true);
      }
    };

    // Listen for first user gesture — iOS requires this before AudioContext works
    document.addEventListener('touchstart', unlockAudio, { capture: true, passive: true });
    document.addEventListener('touchend', unlockAudio, { capture: true, passive: true });
    document.addEventListener('click', unlockAudio, { capture: true, passive: true });

    // Also try immediately in case we're on Android/desktop where no gesture is needed
    _initAudio();

    return () => {
      document.removeEventListener('touchstart', unlockAudio, true);
      document.removeEventListener('touchend', unlockAudio, true);
      document.removeEventListener('click', unlockAudio, true);
    };
  }, []);

  const fire = useCallback((intensity = 'medium') => {
    // Throttle: minimum 40ms between haptic fires
    const now = Date.now();
    if (now - lastFired.current < 40) return;
    lastFired.current = now;

    // Strategy 1: Vibration API (Android/Chrome)
    if (navigator.vibrate) {
      const patterns = {
        light: [8],
        medium: [15],
        heavy: [30],
        success: [10, 30, 10],
        error: [20, 10, 20, 10, 20],
      };
      try {
        navigator.vibrate(patterns[intensity] || patterns.medium);
        return; // Vibration API succeeded — no need for audio fallback
      } catch (e) {}
    }

    // Strategy 2: AudioContext micro-click (iOS primary)
    if (_playMicroClick(intensity)) return;

    // Strategy 3: Visual micro-pulse fallback (last resort)
    try {
      const el = document.activeElement || document.body;
      el.style.transition = 'transform 0.05s ease-out';
      el.style.transform = 'scale(0.985)';
      requestAnimationFrame(() => {
        setTimeout(() => {
          el.style.transform = 'scale(1)';
        }, 50);
      });
    } catch (e) {}
  }, []);

  return { fire };
}

export default useHaptics;
