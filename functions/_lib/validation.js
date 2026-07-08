import { AppError } from './errors.js';

export function requiredString(value, field, { min = 1, max = 250 } = {}) {
  const normalized = String(value ?? '').trim();
  if (normalized.length < min) {
    throw new AppError(400, 'VALIDATION_ERROR', `El campo ${field} es obligatorio.`);
  }
  if (normalized.length > max) {
    throw new AppError(400, 'VALIDATION_ERROR', `El campo ${field} no puede superar ${max} caracteres.`);
  }
  return normalized;
}

export function optionalString(value, { max = 2000 } = {}) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > max) {
    throw new AppError(400, 'VALIDATION_ERROR', `El texto no puede superar ${max} caracteres.`);
  }
  return normalized;
}

export function normalizedUsername(value) {
  const username = requiredString(value, 'usuario', { min: 2, max: 40 }).toUpperCase();
  if (!/^[A-Z0-9._-]+$/.test(username)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El usuario solo puede contener letras, números, punto, guion y guion bajo.');
  }
  return username;
}

export function validatePin(value) {
  const pin = String(value ?? '').trim();
  if (pin.length < 4 || pin.length > 64) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El NIP o contraseña debe tener entre 4 y 64 caracteres.');
  }
  return pin;
}

export function validateInitials(value) {
  const initials = requiredString(value, 'iniciales', { min: 2, max: 8 })
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  if (initials.length < 2) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Las iniciales deben contener al menos dos letras o números.');
  }
  return initials;
}

export function validateCode(value, field = 'código') {
  const code = requiredString(value, field, { min: 2, max: 8 })
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  if (code.length < 2) {
    throw new AppError(400, 'VALIDATION_ERROR', `El ${field} debe contener al menos dos caracteres.`);
  }
  return code;
}

export function numberInRange(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} debe ser un número entre ${min} y ${max}.`);
  }
  return number;
}

export function money(value, field = 'precio') {
  return roundMoney(numberInRange(value, field, { min: 0.01, max: 100000000 }));
}

export function percentage(value, field = 'porcentaje') {
  return roundNumber(numberInRange(value ?? 0, field, { min: 0, max: 100 }), 4);
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function roundNumber(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function booleanString(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue ? 'true' : 'false';
  return ['true', '1', 'yes', 'si', 'sí', 'on'].includes(String(value).toLowerCase()) ? 'true' : 'false';
}

export function isActive(row) {
  return String(row.active ?? 'true').toLowerCase() !== 'false';
}

export function slug(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
