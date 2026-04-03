/**
 * useHaptics.js — Apple-first haptic feedback engine
 *
 * Priority chain (per Apple HIG + Web standards as of iOS 18 / Safari 18):
 *
 *   1. Web Haptics API  — navigator.haptics  (Safari 17.5+ / iOS 18+, most native feel)
 *   2. Vibration API    — navigator.vibrate  (Android / Chrome; blocked on iOS Safari)
 *   3. Taptic Engine sim— AudioContext with filtered-noise bursts (iOS primary fallback)
 *      → White noise → BiquadFilter(bandpass) → GainNode with ADSR envelope
 *      → Sounds/feels far closer to UIImpactFeedbackGenerator than a sine oscillator
 *   4. Visual micro-pulse — CSS scale spring (last resort, no audio/vibration available)
 *
 * Haptic vocabulary matches Apple's UIKit generators:
 *   UIImpactFeedbackGenerator  → light | medium | heavy | rigid | soft
 *   UINotificationFeedbackGenerator → success | warning | error | notification
 *   UISelectionFeedbackGenerator    → select
 *   Custom / compound           → refresh
 */

import { useCallback, useRef, useEffect } from 'react';

// ─── AUDIO CONTEXT STATE ───
let _audioCtx    = null;
let _audioReady  = false;
let _initAttempted = false;

// ─── TAPTIC ENGINE SIMULATION PROFILES ───────────────────────────────────────
// Each profile mimics an Apple HIG feedback type via filtered noise.
// Noise (white) → BiquadFilter(bandpass, freq, Q) → GainNode (attack + decay)
//
// Tuning rationale:
//   • Higher filterFreq = lighter, crisper tap  (UIImpactFeedbackGenerator .light / .rigid)
//   • Lower  filterFreq = deeper, heavier tap   (UIImpactFeedbackGenerator .heavy)
//   • Shorter decay     = rigid / snappy        (.rigid style)
//   • Longer  decay     = soft / pillowy        (.soft style)
// ─────────────────────────────────────────────────────────────────────────────
const TAPTIC_PROFILES = {
  //  name        filterFreq  Q     gain   decay(s)
  light:      { freq:  900, Q: 0.85, gain: 0.14, decay: 0.011 },
  medium:     { freq:  580, Q: 0.75, gain: 0.26, decay: 0.017 },
  heavy:      { freq:  360, Q: 0.65, gain: 0.38, decay: 0.028 },
  rigid:      { freq: 1300, Q: 1.10, gain: 0.20, decay: 0.007 }, // sharp crisp snap
  soft:       { freq:  280, Q: 0.55, gain: 0.16, decay: 0.024 }, // pillowy, gentle
  select:     { freq:  800, Q: 0.80, gain: 0.11, decay: 0.010 }, // UISelectionFeedbackGenerator
  warning:    { freq:  500, Q: 0.70, gain: 0.22, decay: 0.018 },
};

// Compound patterns: array of [profileKey, delayMs] tuples
const COMPOUND_PATTERNS = {
  success:      [['medium', 0], ['light', 90]],
  error:        [['heavy', 0], ['heavy', 60], ['heavy', 120]],
  notification: [['medium', 0], ['light', 80]],
  warning:      [['medium', 0], ['soft', 110]],
  refresh:      [['light', 0], ['medium', 80], ['light', 160]],
};

// ─── VIBRATION API PATTERNS (Android / Chrome) ───────────────────────────────
const VIBRATION_PATTERNS = {
  light:        [8],
  medium:       [15],
  heavy:        [30],
  rigid:        [6],
  soft:         [20],
  select:       [10],
  success:      [10, 40, 10],
  error:        [25, 20, 25, 20, 25],
  warning:      [15, 50, 15],
  notification: [10, 40, 10],
  refresh:      [8, 30, 8, 30, 8],
};

// ─── WEB HAPTICS API PATTERNS ────────────────────────────────────────────────
// navigator.haptics — Web Haptics API (Safari 17.5+ / iOS 18+)
// Specification: https://wicg.github.io/web-haptics-api/
// Apple ships this as window.navigator.haptics; pattern objects follow the spec.
const WEB_HAPTICS_PATTERNS = {
  light:        [{ type: 'transient', intensity: 0.35, sharpness: 0.75 }],
  medium:       [{ type: 'transient', intensity: 0.60, sharpness: 0.55 }],
  heavy:        [{ type: 'transient', intensity: 0.90, sharpness: 0.30 }],
  rigid:        [{ type: 'transient', intensity: 0.70, sharpness: 1.00 }],
  soft:         [{ type: 'transient', intensity: 0.40, sharpness: 0.10 }],
  select:       [{ type: 'transient', intensity: 0.30, sharpness: 0.70 }],
  success:      [
    { type: 'transient', intensity: 0.60, sharpness: 0.50, relativeTime: 0 },
    { type: 'transient', intensity: 0.30, sharpness: 0.60, relativeTime: 0.09 },
  ],
  error:        [
    { type: 'transient', intensity: 0.90, sharpness: 0.25, relativeTime: 0 },
    { type: 'transient', intensity: 0.90, sharpness: 0.25, relativeTime: 0.065 },
    { type: 'transient', intensity: 0.90, sharpness: 0.25, relativeTime: 0.130 },
  ],
  warning:      [
    { type: 'transient', intensity: 0.60, sharpness: 0.40, relativeTime: 0 },
    { type: 'transient', intensity: 0.40, sharpness: 0.20, relativeTime: 0.110 },
  ],
  notification: [
    { type: 'transient', intensity: 0.55, sharpness: 0.50, relativeTime: 0 },
    { type: 'transient', intensity: 0.28, sharpness: 0.60, relativeTime: 0.085 },
  ],
  refresh:      [
    { type: 'transient', intensity: 0.30, sharpness: 0.70, relativeTime: 0 },
    { type: 'transient', intensity: 0.55, sharpness: 0.55, relativeTime: 0.085 },
    { type: 'transient', intensity: 0.25, sharpness: 0.65, relativeTime: 0.165 },
  ],
};

// ─── AUDIO CONTEXT INIT ───────────────────────────────────────────────────────
function _initAudio() {
  if (_audioCtx && _audioReady) return true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!_audioCtx) _audioCtx = new AC();
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().then(() => { _audioReady = true; }).catch(() => {});
    }
    if (_audioCtx.state === 'running') _audioReady = true;
    return _audioReady;
  } catch (e) {
    return false;
  }
}

// ─── TAPTIC ENGINE SIMULATION ────────────────────────────────────────────────
// Plays a single noise burst. Returns true on success.
function _playTapticBurst(profileKey = 'medium') {
  if (!_audioCtx) return false;
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  if (_audioCtx.state !== 'running') return false;

  const p = TAPTIC_PROFILES[profileKey] || TAPTIC_PROFILES.medium;

  try {
    const ctx = _audioCtx;

    // 25ms of white noise — enough for a crisp transient
    const bufferFrames = Math.round(ctx.sampleRate * 0.025);
    const noiseBuffer  = ctx.createBuffer(1, bufferFrames, ctx.sampleRate);
    const noiseData    = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferFrames; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;

    // Bandpass filter shapes the noise into the target frequency character
    const filter = ctx.createBiquadFilter();
    filter.type            = 'bandpass';
    filter.frequency.value = p.freq;
    filter.Q.value         = p.Q;

    // Gain envelope: instant attack, exponential decay
    const gainNode = ctx.createGain();
    const t = ctx.currentTime;
    gainNode.gain.setValueAtTime(p.gain, t);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.start(t);
    source.stop(t + p.decay + 0.005);

    return true;
  } catch (e) {
    return false;
  }
}

// Schedules compound multi-tap patterns via setTimeout
function _playTapticPattern(patternKey) {
  const pattern = COMPOUND_PATTERNS[patternKey];
  if (!pattern) {
    // Single-tap fallback for unknown keys
    return _playTapticBurst(patternKey);
  }
  pattern.forEach(([profileKey, delayMs]) => {
    if (delayMs === 0) {
      _playTapticBurst(profileKey);
    } else {
      setTimeout(() => _playTapticBurst(profileKey), delayMs);
    }
  });
  return true;
}

// ─── WEB HAPTICS API (navigator.haptics) ─────────────────────────────────────
function _tryWebHaptics(intensityKey) {
  try {
    const h = navigator.haptics;
    if (!h || typeof h.vibrate !== 'function') return false;
    const pattern = WEB_HAPTICS_PATTERNS[intensityKey];
    if (!pattern) return false;
    // Fire-and-forget; the promise rejection is silently handled
    h.vibrate(pattern).catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

// ─── VISUAL FALLBACK ─────────────────────────────────────────────────────────
function _visualPulse() {
  try {
    const el = document.activeElement || document.body;
    el.style.transition = 'transform 0.06s cubic-bezier(0.34, 1.56, 0.64, 1)';
    el.style.transform  = 'scale(0.982)';
    requestAnimationFrame(() => {
      setTimeout(() => {
        el.style.transform = 'scale(1)';
      }, 60);
    });
  } catch (e) {}
}

// ─── CORE FIRE FUNCTION ───────────────────────────────────────────────────────
// Throttle buckets: lighter intensities can fire more frequently
const _lastFired = {};
const THROTTLE_MS = {
  light: 30, select: 30, rigid: 30,
  medium: 45, soft: 45, warning: 45,
  heavy: 60, success: 80, error: 80,
  notification: 80, refresh: 100,
};

function _fire(intensityKey = 'medium') {
  // Throttle per intensity type
  const now = Date.now();
  const throttle = THROTTLE_MS[intensityKey] ?? 45;
  if (now - (_lastFired[intensityKey] || 0) < throttle) return;
  _lastFired[intensityKey] = now;

  // Ensure AudioContext is initialized (no-op if already done)
  if (!_initAttempted) {
    _initAttempted = true;
    _initAudio();
  }

  // ── Strategy 1: Web Haptics API (iOS 18+ / Safari 17.5+) ──────────────────
  if (_tryWebHaptics(intensityKey)) return;

  // ── Strategy 2: Vibration API (Android / Chromium) ────────────────────────
  if (navigator.vibrate) {
    const pattern = VIBRATION_PATTERNS[intensityKey];
    if (pattern) {
      try {
        if (navigator.vibrate(pattern) !== false) return;
      } catch (e) {}
    }
  }

  // ── Strategy 3: Taptic Engine simulation via AudioContext (iOS primary) ────
  const isCompound = intensityKey in COMPOUND_PATTERNS;
  const isSingle   = intensityKey in TAPTIC_PROFILES;

  if (isCompound) {
    if (_playTapticPattern(intensityKey)) return;
  } else if (isSingle) {
    if (_playTapticBurst(intensityKey)) return;
  }

  // ── Strategy 4: Visual micro-pulse ────────────────────────────────────────
  _visualPulse();
}

// ─── GLOBAL GESTURE UNLOCK (iOS AudioContext policy) ────────────────────────
// iOS Safari requires a user gesture before AudioContext can produce sound.
// We listen for any pointer/touch event and attempt to resume.
if (typeof document !== 'undefined') {
  const _unlockOnGesture = () => {
    if (!_initAttempted) { _initAttempted = true; _initAudio(); }
    else if (_audioCtx && _audioCtx.state === 'suspended') {
      _audioCtx.resume().then(() => { _audioReady = true; }).catch(() => {});
    }
    if (_audioReady) {
      document.removeEventListener('touchstart',  _unlockOnGesture, true);
      document.removeEventListener('touchend',    _unlockOnGesture, true);
      document.removeEventListener('pointerdown', _unlockOnGesture, true);
      document.removeEventListener('click',       _unlockOnGesture, true);
    }
  };
  document.addEventListener('touchstart',  _unlockOnGesture, { capture: true, passive: true });
  document.addEventListener('touchend',    _unlockOnGesture, { capture: true, passive: true });
  document.addEventListener('pointerdown', _unlockOnGesture, { capture: true, passive: true });
  document.addEventListener('click',       _unlockOnGesture, { capture: true, passive: true });
}

// ─── REACT HOOK ───────────────────────────────────────────────────────────────
export function useHaptics() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Pre-warm AudioContext on mount (gesture unlock handled globally above)
    if (!_initAttempted) { _initAttempted = true; _initAudio(); }
  }, []);

  const fire = useCallback((intensity = 'medium') => _fire(intensity), []);

  return { fire };
}

// ─── STATIC API ──────────────────────────────────────────────────────────────
// Drop-in replacement for the previous haptics object.
// All pages importing { haptics } continue to work without modification.
export const haptics = {
  // UIImpactFeedbackGenerator equivalents
  light:        () => _fire('light'),
  medium:       () => _fire('medium'),
  heavy:        () => _fire('heavy'),
  rigid:        () => _fire('rigid'),        // NEW — UIImpactFeedbackGenerator .rigid
  soft:         () => _fire('soft'),         // NEW — UIImpactFeedbackGenerator .soft

  // UINotificationFeedbackGenerator equivalents
  success:      () => _fire('success'),
  error:        () => _fire('error'),
  warning:      () => _fire('warning'),      // NEW — UINotificationFeedbackGenerator .warning
  notification: () => _fire('notification'), // NEW — compound success-style

  // UISelectionFeedbackGenerator equivalent
  select:       () => _fire('select'),

  // Compound / custom
  refresh:      () => _fire('refresh'),

  // Generic fire with intensity string
  fire:         _fire,
};

export default useHaptics;
