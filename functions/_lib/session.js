import { AppError } from './errors.js';
import { base64UrlToText, signValue, textToBase64Url, timingSafeEqual } from './crypto.js';

const COOKIE_NAME = 'borda_session';

function parseCookies(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

export async function createSessionToken(user, env) {
  const now = Math.floor(Date.now() / 1000);
  const hours = Math.max(1, Math.min(72, Number(env.SESSION_HOURS || 8)));
  const payload = {
    uid: user.id,
    username: user.username,
    role: user.role,
    av: Number(user.auth_version || 1),
    iat: now,
    exp: now + hours * 3600,
  };
  const encoded = textToBase64Url(JSON.stringify(payload));
  const signature = await signValue(encoded, env.AUTH_SECRET);
  return `${encoded}.${signature}`;
}

export async function verifySessionToken(token, env) {
  if (!token || !token.includes('.')) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Debes iniciar sesión.');
  }

  const [encoded, signature] = token.split('.');
  const expectedSignature = await signValue(encoded, env.AUTH_SECRET);
  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new AppError(401, 'INVALID_SESSION', 'La sesión no es válida.');
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlToText(encoded));
  } catch {
    throw new AppError(401, 'INVALID_SESSION', 'La sesión no es válida.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) {
    throw new AppError(401, 'SESSION_EXPIRED', 'La sesión venció. Vuelve a iniciar sesión.');
  }

  return payload;
}

export function readSessionCookie(request) {
  return parseCookies(request)[COOKIE_NAME] || '';
}

export function sessionCookie(token, request, env) {
  const hours = Math.max(1, Math.min(72, Number(env.SESSION_HOURS || 8)));
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${hours * 3600}${secure}`;
}

export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}
