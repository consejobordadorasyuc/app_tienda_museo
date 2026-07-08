import { AppError } from './errors.js';
import { verifyPin } from './crypto.js';
import { isActive, normalizedUsername } from './validation.js';
import { readSessionCookie, verifySessionToken } from './session.js';

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function attemptKey(request, username) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return `${ip}:${username}`;
}

function cleanupAttempts(now) {
  for (const [key, value] of attempts.entries()) {
    if (now - value.firstAttempt > WINDOW_MS) attempts.delete(key);
  }
}

export function assertLoginAllowed(request, username) {
  const now = Date.now();
  cleanupAttempts(now);
  const entry = attempts.get(attemptKey(request, username));
  if (entry && entry.count >= MAX_ATTEMPTS && now - entry.firstAttempt < WINDOW_MS) {
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos. Espera unos minutos antes de volver a intentar.');
  }
}

export function registerLoginFailure(request, username) {
  const key = attemptKey(request, username);
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttempt: now });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(request, username) {
  attempts.delete(attemptKey(request, username));
}

export function publicUser(user) {
  if (!user) return null;
  const {
    pin_hash: _pinHash,
    pin_salt: _pinSalt,
    ...safe
  } = user;
  return safe;
}

export async function authenticateCredentials(store, request, env, usernameValue, pin) {
  const username = normalizedUsername(usernameValue);
  assertLoginAllowed(request, username);

  const { tables } = await store.readTables(['users']);
  const user = tables.users.find((row) => row.username.toUpperCase() === username && isActive(row));
  const valid = user
    ? await verifyPin(String(pin ?? ''), user.pin_salt, user.pin_hash, env.AUTH_PEPPER)
    : false;

  if (!valid) {
    registerLoginFailure(request, username);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'El usuario o el NIP no son correctos.');
  }

  clearLoginFailures(request, username);
  return user;
}

export async function requireUser(store, request, env) {
  const token = readSessionCookie(request);
  const payload = await verifySessionToken(token, env);
  const { tables } = await store.readTables(['users']);
  const user = tables.users.find((row) => row.id === payload.uid);

  if (!user || !isActive(user)) {
    throw new AppError(401, 'ACCOUNT_INACTIVE', 'La cuenta no está disponible.');
  }

  if (Number(user.auth_version || 1) !== Number(payload.av || 1)) {
    throw new AppError(401, 'SESSION_REVOKED', 'La sesión dejó de ser válida. Vuelve a iniciar sesión.');
  }

  return user;
}

export function requireAdmin(user) {
  if (user.role !== 'admin') {
    throw new AppError(403, 'ADMIN_REQUIRED', 'Esta acción solo puede realizarla la administradora.');
  }
}
