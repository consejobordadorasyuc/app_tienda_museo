import { AppError } from './errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function textToBase64Url(value) {
  return bytesToBase64Url(encoder.encode(value));
}

export function base64UrlToText(value) {
  return decoder.decode(base64UrlToBytes(value));
}

export function randomToken(byteLength = 18) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return new Uint8Array(signature);
}

export async function hashPin(pin, salt, pepper) {
  if (!pepper) throw new AppError(500, 'MISSING_AUTH_PEPPER', 'Falta configurar AUTH_PEPPER.');
  return bytesToBase64Url(await hmacSha256(pepper, `${salt}|${pin}`));
}

export async function createPinRecord(pin, pepper) {
  const salt = randomToken(16);
  return { salt, hash: await hashPin(pin, salt, pepper) };
}

export function timingSafeEqual(a, b) {
  const left = encoder.encode(String(a));
  const right = encoder.encode(String(b));
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

export async function verifyPin(pin, salt, expectedHash, pepper) {
  const actual = await hashPin(pin, salt, pepper);
  return timingSafeEqual(actual, expectedHash);
}

export async function signValue(value, secret) {
  if (!secret) throw new AppError(500, 'MISSING_AUTH_SECRET', 'Falta configurar AUTH_SECRET.');
  return bytesToBase64Url(await hmacSha256(secret, value));
}
