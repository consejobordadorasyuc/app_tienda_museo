export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function money(value, currency = 'MXN') {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency || 'MXN',
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function dateTime(value, timeZone = 'America/Merida') {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString('es-MX');
  }
}

export function localDate(value, timeZone = 'America/Merida') {
  if (!value) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).format(new Date(value));
    return parts;
  } catch {
    return String(value).slice(0, 10);
  }
}

export function statusLabel(status) {
  return {
    available: 'Disponible',
    sold: 'Vendido',
    deleted: 'Eliminado',
    completed: 'Completada',
    cancelled: 'Cancelada',
    true: 'Activa',
    false: 'Inactiva',
  }[String(status)] || status || '—';
}

export function debounce(fn, delay = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function setBusy(button, busy, busyText = 'Guardando…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

export function calculatePreview({
  basePrice,
  discountPercent,
  extraPercent,
  commissionPercent,
  cardFeeApplies,
  cardFeePercent,
  cardFeeTaxPercent,
}) {
  const round = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const base = round(Number(basePrice || 0));
  const discount = Number(discountPercent || 0);
  const extra = Number(extraPercent || 0);
  const discountAmount = round(base * discount / 100);
  const extraAmount = round(base * extra / 100);
  const adjustedPrice = round(base - discountAmount + extraAmount);
  const storeCommissionAmount = round(adjustedPrice * Number(commissionPercent || 0) / 100);
  const cardFeeAmount = cardFeeApplies ? round(adjustedPrice * Number(cardFeePercent || 0) / 100) : 0;
  const cardFeeTaxAmount = cardFeeApplies ? round(cardFeeAmount * Number(cardFeeTaxPercent || 0) / 100) : 0;
  const net = round(adjustedPrice - storeCommissionAmount - cardFeeAmount - cardFeeTaxAmount);
  return { base, discountAmount, extraAmount, adjustedPrice, storeCommissionAmount, cardFeeAmount, cardFeeTaxAmount, net };
}
