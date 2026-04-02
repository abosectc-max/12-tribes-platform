// useNotifications.js — PWA Push Notification support
// Handles permission requests, subscription management, and local notifications
// Works on iOS (16.4+), Android, and desktop browsers

const API_BASE = (() => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `http://${hostname}:4000/api`;
  return 'https://one2-tribes-api.onrender.com/api';
})();

// Check if push notifications are supported
export function isPushSupported() {
  return 'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
}

// Get current permission state: 'granted', 'denied', 'default'
export function getPermissionState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// Request notification permission
export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  const result = await Notification.requestPermission();
  return result; // 'granted', 'denied', or 'default'
}

// Subscribe to push notifications via service worker
export async function subscribeToPush(userId) {
  if (!isPushSupported()) return { success: false, error: 'Push not supported on this device' };

  try {
    const permission = await requestPermission();
    if (permission !== 'granted') {
      return { success: false, error: 'Notification permission denied' };
    }

    const reg = await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      // Create new subscription — use VAPID public key if available
      // For now, use a local notification approach since VAPID requires server-side key generation
      console.log('[Notifications] Push subscription would require VAPID keys. Using local notifications.');
    }

    return { success: true, permission: 'granted', subscription: subscription ? 'active' : 'local-only' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Send a local notification (works without push server)
export async function sendLocalNotification(title, body, options = {}) {
  if (getPermissionState() !== 'granted') {
    const perm = await requestPermission();
    if (perm !== 'granted') return false;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: options.tag || 'default',
      vibrate: [100, 50, 100],
      data: { url: options.url || '/investor-portal' },
      ...options,
    });
    return true;
  } catch (e) {
    // Fallback: browser Notification API
    try {
      new Notification(title, { body, icon: '/icons/icon-192.png' });
      return true;
    } catch {
      return false;
    }
  }
}

// Pre-built notification types for the platform
export const notifications = {
  tradeExecuted: (symbol, side, pnl) =>
    sendLocalNotification('Trade Executed', `${side.toUpperCase()} ${symbol} — P&L: $${pnl}`, {
      tag: 'trade', url: '/investor-portal',
    }),
  signalGenerated: (symbol, direction) =>
    sendLocalNotification('New Signal', `${direction} signal on ${symbol}`, {
      tag: 'signal', url: '/investor-portal',
    }),
  riskAlert: (message) =>
    sendLocalNotification('Risk Alert', message, {
      tag: 'risk', url: '/investor-portal',
      vibrate: [200, 100, 200, 100, 200],
    }),
  portfolioUpdate: (balance) =>
    sendLocalNotification('Portfolio Update', `Current value: $${Number(balance).toLocaleString()}`, {
      tag: 'portfolio', url: '/investor-portal',
    }),
  systemAlert: (message) =>
    sendLocalNotification('12 Tribes', message, { tag: 'system' }),
};

export default { isPushSupported, getPermissionState, requestPermission, subscribeToPush, sendLocalNotification, notifications };
