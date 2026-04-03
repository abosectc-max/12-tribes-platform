// ═══════════════════════════════════════════
//   12 TRIBES — AUTH STORE v4.0
//   Real Users Only | $100K Virtual Wallet | Login Timestamps
//   Backend Sync: Registers/logins sync to server for cross-device access
//   Falls back to localStorage-only if server unreachable
// ═══════════════════════════════════════════

// ═══════ BACKEND API SYNC LAYER ═══════
const API_BASE = (() => {
  // Production: VITE_API_URL points to Render backend
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
  // Local dev: same hostname, port 4000
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${hostname}:4000/api`;
})();

const STORAGE_KEY_TOKEN = '12tribes_auth_token';

let authToken = (() => {
  try { return localStorage.getItem(STORAGE_KEY_TOKEN) || null; } catch { return null; }
})();

function saveToken(token) {
  authToken = token;
  try { localStorage.setItem(STORAGE_KEY_TOKEN, token); } catch {}
}

function clearToken() {
  authToken = null;
  try { localStorage.removeItem(STORAGE_KEY_TOKEN); } catch {}
}

// ─── JWT expiration check (decode payload without verification) ───
function isTokenExpired(token) {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return true;
    // Expire 60s early to avoid edge-case race conditions
    return payload.exp < (Date.now() / 1000) - 60;
  } catch { return true; }
}

async function apiFetch(path, options = {}) {
  // Auto-clear expired tokens before making requests
  if (authToken && isTokenExpired(authToken)) {
    clearToken();
    // Notify listeners of forced logout
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('12tribes:token-expired'));
    }
    return { ok: false, status: 401, data: { error: 'Session expired. Please sign in again.' }, expired: true };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout
  try {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, status: 0, data: null, offline: true, error: err.message };
  }
}

// Track server availability — avoid hammering a down server
let serverAvailable = null; // null = unknown, true/false = last known state
let lastServerCheck = 0;

async function isServerUp() {
  const now = Date.now();
  // Re-check every 30s or if unknown
  if (serverAvailable !== null && (now - lastServerCheck) < 30000) return serverAvailable;
  const result = await apiFetch('/health');
  serverAvailable = result.ok;
  lastServerCheck = now;
  return serverAvailable;
}

// Storage helpers — persist across page refreshes
const STORAGE_KEY_USERS = '12tribes_users';
const STORAGE_KEY_SESSION = '12tribes_session';
const STORAGE_KEY_LOGIN_LOG = '12tribes_login_log';
const STORAGE_KEY_VERIFICATION = '12tribes_verification';

function loadFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function removeFromStorage(key) {
  try { localStorage.removeItem(key); } catch {}
}

// ═══════ USER DATABASE ═══════
// Hydrate from localStorage — NO fake seed investors
const userDB = new Map();

const storedUsers = loadFromStorage(STORAGE_KEY_USERS);
if (storedUsers && Array.isArray(storedUsers)) {
  storedUsers.forEach(u => userDB.set(u.email.toLowerCase(), u));
}

// Current session — restore from localStorage if available
let currentSession = loadFromStorage(STORAGE_KEY_SESSION);

// Login activity log
let loginLog = loadFromStorage(STORAGE_KEY_LOGIN_LOG) || [];

// Email verification codes — { email: { code, expiresAt } }
let verificationCodes = loadFromStorage(STORAGE_KEY_VERIFICATION) || {};

// Persist helpers
function persistUsers() {
  saveToStorage(STORAGE_KEY_USERS, Array.from(userDB.values()));
}

function persistLoginLog() {
  saveToStorage(STORAGE_KEY_LOGIN_LOG, loginLog);
}

function persistVerificationCodes() {
  saveToStorage(STORAGE_KEY_VERIFICATION, verificationCodes);
}

// ═══════ PASSWORD HASHING (SHA-256 with fallback) ═══════
// crypto.subtle is only available in secure contexts (HTTPS / localhost).
// Mobile browsers on HTTP (e.g. phone accessing LAN IP) need a fallback.
function fallbackHash(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    hash = ((hash << 5) - hash + c) | 0;
  }
  // Make it look like a hex string and add a prefix so we know it's a fallback
  const n = Math.abs(hash).toString(16).padStart(8, '0');
  return `fb:${n}${n}${n}${n}${n}${n}${n}${n}`;
}

async function hashPassword(password) {
  try {
    if (crypto?.subtle?.digest) {
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* SubtleCrypto unavailable in insecure context */ }
  return fallbackHash(password);
}

async function verifyPassword(password, hash) {
  const hashOfInput = await hashPassword(password);
  if (hashOfInput === hash) return true;
  // Also check fallback hash if the stored hash is a fallback
  if (hash?.startsWith('fb:')) return fallbackHash(password) === hash;
  return false;
}

// ═══════ EMAIL VERIFICATION ═══════
function generateVerificationCode() {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  return code;
}

function setVerificationCode(email, code) {
  const emailKey = email.toLowerCase().trim();
  verificationCodes[emailKey] = {
    code,
    expiresAt: Date.now() + (10 * 60 * 1000), // 10 minutes
  };
  persistVerificationCodes();
}

export function getVerificationCode(email) {
  const emailKey = email.toLowerCase().trim();
  const entry = verificationCodes[emailKey];
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    delete verificationCodes[emailKey];
    persistVerificationCodes();
    return null;
  }
  return entry.code;
}

export async function verifyEmail(email, code) {
  const emailKey = email.toLowerCase().trim();

  // Try server-side verification first
  try {
    const serverUp = await isServerUp();
    if (serverUp) {
      const res = await apiFetch('/auth/verify-email/confirm', {
        method: 'POST',
        body: JSON.stringify({ email: emailKey, code }),
      });
      if (!res.ok) return { success: false, error: res.data?.error || 'Verification failed' };

      // Update local cache
      const user = userDB.get(emailKey);
      if (user) {
        user.emailVerified = true;
        userDB.set(emailKey, user);
        persistUsers();
      }
      return { success: true, user: res.data?.user || user };
    }
  } catch { /* Server unreachable */ }

  // Fallback: verify locally
  const user = userDB.get(emailKey);
  if (!user) return { success: false, error: 'User not found' };

  const entry = verificationCodes[emailKey];
  if (!entry) return { success: false, error: 'No verification code found' };
  if (entry.expiresAt < Date.now()) {
    delete verificationCodes[emailKey];
    persistVerificationCodes();
    return { success: false, error: 'Verification code has expired' };
  }
  if (entry.code !== code) {
    return { success: false, error: 'Invalid verification code' };
  }

  user.emailVerified = true;
  userDB.set(emailKey, user);
  delete verificationCodes[emailKey];
  persistUsers();
  persistVerificationCodes();
  return { success: true, user };
}

export function isEmailVerified(email) {
  const emailKey = email.toLowerCase().trim();
  const user = userDB.get(emailKey);
  return user ? user.emailVerified === true : false;
}

export async function resendVerificationCode(email) {
  const emailKey = email.toLowerCase().trim();

  // Try server-side — it generates the code AND sends the email
  try {
    const serverUp = await isServerUp();
    if (serverUp) {
      const res = await apiFetch('/auth/verify-email/send', {
        method: 'POST',
        body: JSON.stringify({ email: emailKey }),
      });
      if (res.status === 429) return { success: false, error: res.data?.error || 'Too many requests' };
      if (res.ok) return { success: true, message: 'Verification code sent to your email.' };
    }
  } catch { /* Server unreachable */ }

  // Fallback: generate locally (no email sent, but code works for offline verification)
  const user = userDB.get(emailKey);
  if (!user) return { success: false, error: 'User not found' };

  const code = generateVerificationCode();
  setVerificationCode(email, code);
  console.log(`[EmailVerify] Offline code for ${emailKey}: ${code}`);
  return { success: true, code };
}

// ═══════ LOGIN TIMESTAMP RECORDING ═══════
function recordLogin(user) {
  const entry = {
    userId: user.id,
    email: user.email,
    name: user.name || `${user.firstName} ${user.lastName}`,
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    method: 'email', // Will be overridden by passkey auth
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : 'unknown',
  };
  loginLog.push(entry);

  // Also update user's last login and login count
  const dbUser = userDB.get(user.email.toLowerCase());
  if (dbUser) {
    dbUser.lastLoginAt = entry.timestamp;
    dbUser.loginCount = (dbUser.loginCount || 0) + 1;
    userDB.set(user.email.toLowerCase(), dbUser);
    persistUsers();
  }

  persistLoginLog();
  return entry;
}

// ═══════ REGISTRATION ═══════
export async function registerUser({ firstName, lastName, email, phone, password, tosAccepted, privacyConsent }) {
  const emailKey = email.toLowerCase().trim();

  if (!password || password.length < 12) {
    return { success: false, error: 'Password must be at least 12 characters long.' };
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return { success: false, error: 'Password must contain uppercase, lowercase, and a number.' };
  }

  // ─── SERVER-FIRST REGISTRATION: Server is the source of truth ───
  // NOTE: We do NOT block on local userDB — the server may have been reset
  // while stale browser data still exists. Server is the authority.
  try {
    const serverUp = await isServerUp();
    if (serverUp) {
      const apiResult = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: emailKey, password, firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), tosAccepted: !!tosAccepted, privacyConsent: !!privacyConsent }),
      });

      // Server says account exists (409) — this is a real duplicate
      if (apiResult.status === 409) {
        return { success: false, error: apiResult.data?.error || 'An account with this email already exists. Please sign in.' };
      }

      // If server rejects (403 = access not approved, 429 = rate limited, other errors), block registration
      if (!apiResult.ok) {
        const serverError = apiResult.data?.error || 'Registration failed. Please try again.';
        return { success: false, error: serverError };
      }
      // Server accepted — now create local user
      const id = apiResult.data?.user?.id || `INV_${String(userDB.size + 1).padStart(2, '0')}_${Date.now().toString(36)}`;
      const avatar = `${firstName[0]}${lastName[0]}`.toUpperCase();
      const now = new Date();
      const passwordHash = await hashPassword(password);
      const verificationCode = generateVerificationCode();

      const user = {
        id,
        serverId: apiResult.data?.user?.id,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        name: `${firstName.trim()} ${lastName.trim()}`,
        email: emailKey,
        phone: phone.trim(),
        avatar,
        role: apiResult.data?.user?.role || 'investor',
        virtualBalance: 100_000,
        initialDeposit: 100_000,
        depositTimestamp: now.toISOString(),
        registeredAt: now.toISOString(),
        registeredDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        registeredTime: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        lastLoginAt: now.toISOString(),
        loginCount: 1,
        passwordHash,
        hasPasskey: false,
        passkeyCredentialId: null,
        isNewUser: true,
        emailVerified: false,
      };

      userDB.set(emailKey, user);
      setVerificationCode(email, verificationCode);
      persistUsers();
      recordLogin({ ...user, method: 'registration' });

      if (apiResult.data?.accessToken) {
        saveToken(apiResult.data.accessToken);
      }

      return { success: true, user, verificationCode };
    }
  } catch (err) {
    console.warn('[registerUser] Server registration error:', err.message);
  }

  // ─── FALLBACK: Server unreachable — allow local-only registration ───
  const id = `INV_${String(userDB.size + 1).padStart(2, '0')}_${Date.now().toString(36)}`;
  const avatar = `${firstName[0]}${lastName[0]}`.toUpperCase();
  const now = new Date();
  const passwordHash = await hashPassword(password);
  const verificationCode = generateVerificationCode();

  const user = {
    id,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    name: `${firstName.trim()} ${lastName.trim()}`,
    email: emailKey,
    phone: phone.trim(),
    avatar,
    virtualBalance: 100_000,
    initialDeposit: 100_000,
    depositTimestamp: now.toISOString(),
    registeredAt: now.toISOString(),
    registeredDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    registeredTime: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    lastLoginAt: now.toISOString(),
    loginCount: 1,
    passwordHash,
    hasPasskey: false,
    passkeyCredentialId: null,
    isNewUser: true,
    emailVerified: false,
  };

  userDB.set(emailKey, user);
  setVerificationCode(email, verificationCode);
  persistUsers();
  recordLogin({ ...user, method: 'registration' });

  return { success: true, user, verificationCode };
}

// ═══════ PASSKEY (WebAuthn) — Server-Verified ═══════

export function isPasskeySupported() {
  return !!(window.PublicKeyCredential &&
    typeof window.PublicKeyCredential === 'function');
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach(b => str += String.fromCharCode(b));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Check if user has passkey on server
export async function getPasskeyStatus() {
  const res = await apiFetch('/auth/passkey/status');
  if (res.ok) return res.data;
  return { hasPasskey: false, count: 0, credentials: [] };
}

export async function registerPasskey(email, deviceName) {
  if (!isPasskeySupported()) {
    return { success: false, error: 'Passkeys are not supported on this device/browser' };
  }

  try {
    // 1. Get registration options from server
    const optionsRes = await apiFetch('/auth/passkey/register/options', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (!optionsRes.ok) {
      return { success: false, error: optionsRes.data?.error || 'Failed to get registration options' };
    }

    const options = optionsRes.data;

    // 2. Convert server challenge and user.id from base64url to ArrayBuffer
    const publicKeyOptions = {
      challenge: base64urlToBuffer(options.challenge),
      rp: {
        name: options.rp.name,
        id: window.location.hostname,
      },
      user: {
        id: base64urlToBuffer(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      authenticatorSelection: options.authenticatorSelection,
      timeout: options.timeout,
      attestation: options.attestation,
      excludeCredentials: (options.excludeCredentials || []).map(c => ({
        ...c,
        id: base64urlToBuffer(c.id),
      })),
    };

    // 3. Create credential via browser WebAuthn API
    const credential = await navigator.credentials.create({
      publicKey: publicKeyOptions,
    });

    const credentialId = bufferToBase64url(credential.rawId);
    const attestationObject = bufferToBase64url(credential.response.attestationObject);
    const clientDataJSON = bufferToBase64url(credential.response.clientDataJSON);

    // Extract public key if available
    let publicKey = null;
    if (credential.response.getPublicKey) {
      const pkBytes = credential.response.getPublicKey();
      if (pkBytes) publicKey = bufferToBase64url(pkBytes);
    }

    // 4. Send credential to server for storage
    const verifyRes = await apiFetch('/auth/passkey/register/verify', {
      method: 'POST',
      body: JSON.stringify({
        challenge: options.challenge,
        credentialId,
        publicKey,
        clientDataJSON,
        attestationObject,
        deviceName: deviceName || detectDeviceName(),
      }),
    });

    if (!verifyRes.ok) {
      return { success: false, error: verifyRes.data?.error || 'Failed to register passkey on server' };
    }

    // 5. Update local user state
    const emailKey = email.toLowerCase().trim();
    const user = userDB.get(emailKey);
    if (user) {
      user.hasPasskey = true;
      userDB.set(emailKey, user);
      persistUsers();
    }
    if (currentSession) {
      currentSession.hasPasskey = true;
      saveToStorage(STORAGE_KEY_SESSION, currentSession);
    }

    return { success: true, credentialId, credential: verifyRes.data.credential };
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      return { success: false, error: 'Passkey creation was cancelled' };
    }
    if (err.name === 'InvalidStateError') {
      return { success: false, error: 'A passkey for this device is already registered' };
    }
    return { success: false, error: `Passkey error: ${err.message}` };
  }
}

function detectDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Android/.test(ua)) return 'Android Device';
  if (/Linux/.test(ua)) return 'Linux Device';
  return 'Unknown Device';
}

export async function authenticateWithPasskey(email) {
  if (!isPasskeySupported()) return { success: false, error: 'Passkeys not supported' };

  const emailKey = email.toLowerCase().trim();

  try {
    // 1. Get authentication options from server (no auth required)
    const optionsRes = await apiFetch('/auth/passkey/authenticate/options', {
      method: 'POST',
      body: JSON.stringify({ email: emailKey }),
    });

    if (!optionsRes.ok) {
      return { success: false, error: optionsRes.data?.error || 'No passkey found for this account' };
    }

    const options = optionsRes.data;

    // 2. Convert server data to WebAuthn format
    const publicKeyOptions = {
      challenge: base64urlToBuffer(options.challenge),
      rpId: window.location.hostname,
      allowCredentials: (options.allowCredentials || []).map(c => ({
        id: base64urlToBuffer(c.id),
        type: c.type,
        transports: c.transports,
      })),
      userVerification: options.userVerification,
      timeout: options.timeout,
    };

    // 3. Get assertion from browser
    const assertion = await navigator.credentials.get({
      publicKey: publicKeyOptions,
    });

    const credentialId = bufferToBase64url(assertion.rawId);
    const authenticatorData = bufferToBase64url(assertion.response.authenticatorData);
    const clientDataJSON = bufferToBase64url(assertion.response.clientDataJSON);
    const signature = bufferToBase64url(assertion.response.signature);

    // 4. Send assertion to server for verification — returns JWT
    const verifyRes = await apiFetch('/auth/passkey/authenticate/verify', {
      method: 'POST',
      body: JSON.stringify({
        challenge: options.challenge,
        credentialId,
        authenticatorData,
        clientDataJSON,
        signature,
      }),
    });

    if (!verifyRes.ok) {
      return { success: false, error: verifyRes.data?.error || 'Passkey verification failed' };
    }

    // 5. Store JWT token and hydrate session (same as email login)
    const { accessToken, user: serverUser } = verifyRes.data;
    saveToken(accessToken);

    // Hydrate local user
    let localUser = userDB.get(emailKey);
    if (!localUser) {
      localUser = {
        id: serverUser.id,
        firstName: serverUser.firstName,
        lastName: serverUser.lastName,
        name: serverUser.name || `${serverUser.firstName} ${serverUser.lastName}`,
        email: emailKey,
        phone: serverUser.phone || '',
        avatar: serverUser.avatar || `${serverUser.firstName?.[0] || ''}${serverUser.lastName?.[0] || ''}`.toUpperCase(),
        virtualBalance: 100_000,
        initialDeposit: 100_000,
        registeredAt: serverUser.created_at || new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        loginCount: serverUser.loginCount || 1,
        hasPasskey: true,
        isNewUser: false,
        emailVerified: true,
        serverId: serverUser.id,
        role: serverUser.role || 'investor',
      };
      userDB.set(emailKey, localUser);
      persistUsers();
    } else {
      localUser.hasPasskey = true;
      if (serverUser.role) localUser.role = serverUser.role;
      userDB.set(emailKey, localUser);
      persistUsers();
    }

    recordLogin({ ...localUser, method: 'passkey' });

    currentSession = { ...localUser, role: serverUser.role || localUser.role || 'investor', isNewUser: false };
    saveToStorage(STORAGE_KEY_SESSION, currentSession);
    return { success: true, user: currentSession };
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      return { success: false, error: 'Authentication was cancelled' };
    }
    return { success: false, error: `Auth error: ${err.message}` };
  }
}

export async function removePasskey(credentialId) {
  const res = await apiFetch('/auth/passkey/remove', {
    method: 'POST',
    body: JSON.stringify({ credentialId: credentialId || null }),
  });
  if (res.ok) {
    // Update local state if no passkeys remain
    if (res.data.remaining === 0 && currentSession) {
      currentSession.hasPasskey = false;
      saveToStorage(STORAGE_KEY_SESSION, currentSession);
      const emailKey = currentSession.email?.toLowerCase().trim();
      const user = userDB.get(emailKey);
      if (user) {
        user.hasPasskey = false;
        userDB.set(emailKey, user);
        persistUsers();
      }
    }
    return { success: true, remaining: res.data.remaining };
  }
  return { success: false, error: res.data?.error || 'Failed to remove passkey' };
}

// ═══════ EMAIL/PASSWORD LOGIN ═══════
// Tries backend first (cross-device), falls back to localStorage
export async function loginWithEmail(email, password) {
  const emailKey = email.toLowerCase().trim();

  // ─── BACKEND LOGIN: Try server first for cross-device support ───
  let serverUser = null;
  try {
    const serverUp = await isServerUp();
    if (serverUp) {
      const apiResult = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: emailKey, password }),
      });
      if (apiResult.ok && apiResult.data?.user) {
        saveToken(apiResult.data.accessToken);
        serverUser = apiResult.data.user;
      } else if (apiResult.status === 401) {
        // Server says invalid password — check if we also have local user
        const localUser = userDB.get(emailKey);
        if (!localUser) {
          return { success: false, error: 'Invalid email or password.' };
        }
        // Fall through to local auth
      } else if (apiResult.status === 0 || apiResult.offline) {
        // Server unreachable — fall through to local auth
      } else {
        // Other server error — fall through to local auth
      }
    }
  } catch { /* Server sync is best-effort */ }

  // If server authenticated successfully, hydrate local user from server data
  if (serverUser) {
    let localUser = userDB.get(emailKey);
    if (!localUser) {
      // User exists on server but not locally — create local entry (cross-device scenario)
      const passwordHash = await hashPassword(password);
      localUser = {
        id: serverUser.id,
        firstName: serverUser.firstName,
        lastName: serverUser.lastName,
        name: `${serverUser.firstName} ${serverUser.lastName}`,
        email: emailKey,
        phone: serverUser.phone || '',
        avatar: serverUser.avatar || `${serverUser.firstName[0]}${serverUser.lastName[0]}`.toUpperCase(),
        virtualBalance: 100_000,
        initialDeposit: 100_000,
        depositTimestamp: new Date().toISOString(),
        registeredAt: serverUser.registeredAt || new Date().toISOString(),
        registeredDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        registeredTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        lastLoginAt: new Date().toISOString(),
        loginCount: serverUser.loginCount || 1,
        passwordHash,
        hasPasskey: false,
        passkeyCredentialId: null,
        isNewUser: false,
        emailVerified: true, // Server-verified
        serverId: serverUser.id,
        role: serverUser.role || 'investor',
      };
      userDB.set(emailKey, localUser);
      persistUsers();
    } else if (serverUser.role) {
      // Update role from server if changed (e.g. promoted to admin)
      localUser.role = serverUser.role;
      userDB.set(emailKey, localUser);
      persistUsers();
    }

    // Record login
    recordLogin({ ...localUser, method: 'email' });

    currentSession = { ...localUser, role: serverUser.role || localUser.role || 'investor', isNewUser: false };
    saveToStorage(STORAGE_KEY_SESSION, currentSession);
    return { success: true, user: currentSession };
  }

  // ─── LOCAL LOGIN: Fallback when server is unreachable ───
  const user = userDB.get(emailKey);

  if (!user) {
    return { success: false, error: 'No account found. Please create an account first.' };
  }

  if (!user.passwordHash) {
    return { success: false, error: 'This account does not have a password set. Please use passkey authentication or register with a password.' };
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    return { success: false, error: 'Invalid password.' };
  }

  // ─── SYNC TO SERVER: Push local-only accounts so other devices can log in ───
  try {
    const serverUp = await isServerUp();
    if (serverUp) {
      const syncResult = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: emailKey,
          password,
          firstName: user.firstName || user.name?.split(' ')[0] || '',
          lastName: user.lastName || user.name?.split(' ').slice(1).join(' ') || '',
          phone: user.phone || '',
        }),
      });
      if (syncResult.ok && syncResult.data?.accessToken) {
        saveToken(syncResult.data.accessToken);
      }
      // 409 = already exists, which is fine — means it was already synced
    }
  } catch { /* Best-effort sync */ }

  // Record login with timestamp
  recordLogin({ ...user, method: 'email' });

  currentSession = { ...user, isNewUser: false };
  saveToStorage(STORAGE_KEY_SESSION, currentSession);
  return { success: true, user: currentSession };
}

// ═══════ CHANGE PASSWORD ═══════
export async function changePassword(email, currentPassword, newPassword) {
  const emailKey = email.toLowerCase().trim();
  const user = userDB.get(emailKey);

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (!user.passwordHash) {
    return { success: false, error: 'This account does not have a password set.' };
  }

  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: 'New password must be at least 6 characters long.' };
  }

  const passwordValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!passwordValid) {
    return { success: false, error: 'Current password is incorrect.' };
  }

  const newHash = await hashPassword(newPassword);
  user.passwordHash = newHash;
  userDB.set(emailKey, user);
  persistUsers();

  // Update current session if this is the logged-in user
  if (currentSession && currentSession.email === emailKey) {
    currentSession.passwordHash = newHash;
    saveToStorage(STORAGE_KEY_SESSION, currentSession);
  }

  // ─── BACKEND SYNC: Push password change to server ───
  try {
    if (authToken) {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    }
  } catch { /* Best-effort sync */ }

  return { success: true, message: 'Password changed successfully.' };
}

// ═══════ PASSWORD RESET (server-side code generation + email delivery) ═══════
export async function requestPasswordReset(email) {
  const emailKey = email.toLowerCase().trim();

  // Send request to server — it generates the code, stores it in DB, and emails it
  try {
    const serverUp = await isServerUp();
    if (serverUp) {
      const res = await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: emailKey }),
      });
      if (res.status === 429) return { success: false, error: res.data?.error || 'Too many requests' };
      return { success: true, message: 'If an account exists with this email, a reset code has been sent to your inbox.' };
    }
  } catch { /* Server unreachable */ }

  // Fallback: generate code locally if server is down
  const code = generateVerificationCode();
  setVerificationCode(emailKey, code);
  console.log(`[PasswordReset] Offline code for ${emailKey}: ${code}`);
  return { success: true, message: 'If an account exists with this email, a reset code has been generated.' };
}

export async function resetPassword(email, code, newPassword) {
  const emailKey = email.toLowerCase().trim();

  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters.' };
  }

  // Try server-side reset first (server verifies the code)
  try {
    const serverUp = await isServerUp();
    if (serverUp) {
      const res = await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: emailKey, code, newPassword }),
      });
      if (!res.ok) return { success: false, error: res.data?.error || 'Reset failed' };

      // Also update local cache
      const user = userDB.get(emailKey);
      if (user) {
        user.passwordHash = await hashPassword(newPassword);
        userDB.set(emailKey, user);
        persistUsers();
      }
      return { success: true, message: 'Password has been reset. You can now sign in.' };
    }
  } catch { /* Server unreachable */ }

  // Fallback: verify code locally
  const stored = verificationCodes[emailKey];
  if (!stored) return { success: false, error: 'No reset code found. Please request a new one.' };
  if (Date.now() > stored.expiresAt) {
    delete verificationCodes[emailKey];
    persistVerificationCodes();
    return { success: false, error: 'Reset code has expired. Please request a new one.' };
  }
  if (stored.code !== code) return { success: false, error: 'Invalid reset code.' };

  const newHash = await hashPassword(newPassword);
  const user = userDB.get(emailKey);
  if (user) {
    user.passwordHash = newHash;
    userDB.set(emailKey, user);
    persistUsers();
  }
  delete verificationCodes[emailKey];
  persistVerificationCodes();

  return { success: true, message: 'Password has been reset. You can now sign in.' };
}

// ═══════ TOTP 2FA (Google Authenticator / Any TOTP App) ═══════
// HMAC-SHA1 based TOTP — RFC 6238 compliant, 6-digit codes, 30s window

async function hmacSha1(keyBytes, msgBytes) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  return new Uint8Array(sig);
}

function base32Encode(buffer) {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const b of buffer) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += CHARS[parseInt(chunk, 2)];
  }
  return out;
}

function base32Decode(str) {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of str.toUpperCase()) {
    const val = CHARS.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

function generateTOTPSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

async function computeTOTP(secretBase32, timeStep) {
  if (timeStep === undefined) timeStep = Math.floor(Date.now() / 30000);
  const keyBytes = base32Decode(secretBase32);
  const timeBytes = new Uint8Array(8);
  let t = timeStep;
  for (let i = 7; i >= 0; i--) {
    timeBytes[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  const hmac = await hmacSha1(keyBytes, timeBytes);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
  return code.toString().padStart(6, '0');
}

export function generate2FASecret(email) {
  const emailKey = email.toLowerCase().trim();
  const user = userDB.get(emailKey);
  if (!user) return { success: false, error: 'User not found' };

  const secret = generateTOTPSecret();
  const issuer = '12Tribes';
  const accountName = encodeURIComponent(user.email);
  const otpauthUrl = `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

  // Store secret temporarily until verified
  user._pending2FASecret = secret;
  userDB.set(emailKey, user);
  persistUsers();

  return { success: true, secret, otpauthUrl, qrData: otpauthUrl };
}

export async function verify2FASetup(email, code) {
  const emailKey = email.toLowerCase().trim();
  const user = userDB.get(emailKey);
  if (!user) return { success: false, error: 'User not found' };
  if (!user._pending2FASecret) return { success: false, error: 'No pending 2FA setup' };

  // Check code against current and adjacent time steps (±1 window)
  const timeStep = Math.floor(Date.now() / 30000);
  for (let offset = -1; offset <= 1; offset++) {
    const expected = await computeTOTP(user._pending2FASecret, timeStep + offset);
    if (code === expected) {
      user.twoFactorSecret = user._pending2FASecret;
      user.twoFactorEnabled = true;
      delete user._pending2FASecret;

      // Generate 8 backup codes
      user.twoFactorBackupCodes = Array.from({ length: 8 }, () => {
        const arr = new Uint8Array(4);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
      });

      userDB.set(emailKey, user);
      persistUsers();
      return { success: true, backupCodes: [...user.twoFactorBackupCodes] };
    }
  }
  return { success: false, error: 'Invalid code. Please try again.' };
}

export async function verify2FACode(email, code) {
  const emailKey = email.toLowerCase().trim();
  const user = userDB.get(emailKey);
  if (!user) return { success: false, error: 'User not found' };
  if (!user.twoFactorEnabled || !user.twoFactorSecret) return { success: false, error: '2FA is not enabled' };

  // Check TOTP code (±1 window)
  const timeStep = Math.floor(Date.now() / 30000);
  for (let offset = -1; offset <= 1; offset++) {
    const expected = await computeTOTP(user.twoFactorSecret, timeStep + offset);
    if (code === expected) return { success: true };
  }

  // Check backup codes
  if (user.twoFactorBackupCodes && user.twoFactorBackupCodes.includes(code)) {
    user.twoFactorBackupCodes = user.twoFactorBackupCodes.filter(c => c !== code);
    userDB.set(emailKey, user);
    persistUsers();
    return { success: true, usedBackupCode: true, remainingBackupCodes: user.twoFactorBackupCodes.length };
  }

  return { success: false, error: 'Invalid code.' };
}

export function disable2FA(email) {
  const emailKey = email.toLowerCase().trim();
  const user = userDB.get(emailKey);
  if (!user) return { success: false, error: 'User not found' };

  user.twoFactorEnabled = false;
  delete user.twoFactorSecret;
  delete user._pending2FASecret;
  delete user.twoFactorBackupCodes;
  userDB.set(emailKey, user);
  persistUsers();
  return { success: true };
}

export function is2FAEnabled(email) {
  const emailKey = email.toLowerCase().trim();
  const user = userDB.get(emailKey);
  return user ? user.twoFactorEnabled === true : false;
}

export async function getCurrentTOTP(secret) {
  return computeTOTP(secret);
}

// ═══════ SESSION ═══════
export function setSession(user) {
  currentSession = user;
  saveToStorage(STORAGE_KEY_SESSION, user);
}

export function getSession() {
  return currentSession;
}

export function logout() {
  currentSession = null;
  removeFromStorage(STORAGE_KEY_SESSION);
  clearToken();
}

// ═══════ USER QUERIES ═══════
export function getUserByEmail(email) {
  return userDB.get(email.toLowerCase().trim()) || null;
}

export function getAllUsers() {
  return Array.from(userDB.values());
}

export function getUserCount() {
  return userDB.size;
}

// ═══════ LOGIN LOG QUERIES ═══════
export function getLoginLog(userId) {
  if (userId) return loginLog.filter(entry => entry.userId === userId);
  return [...loginLog];
}

export function getLastLogin(userId) {
  const userLogs = loginLog.filter(entry => entry.userId === userId);
  return userLogs.length > 0 ? userLogs[userLogs.length - 1] : null;
}

// ═══════ CLEAR FAKE DATA ═══════
// One-time migration: remove any pre-seeded fake investors from localStorage
export function purgeSeededInvestors() {
  const fakeEmails = [
    'alice@12tribes.io', 'bob@12tribes.io', 'carol@12tribes.io', 'david@12tribes.io',
    'emma@12tribes.io', 'frank@12tribes.io', 'grace@12tribes.io', 'henry@12tribes.io',
    'iris@12tribes.io', 'jack@12tribes.io', 'karen@12tribes.io', 'liam@12tribes.io',
  ];
  let purged = 0;
  fakeEmails.forEach(email => {
    if (userDB.has(email)) {
      userDB.delete(email);
      purged++;
    }
  });
  if (purged > 0) persistUsers();
  return purged;
}

// Auto-purge on load — clean up any old fake data
purgeSeededInvestors();
