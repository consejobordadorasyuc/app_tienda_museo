import { randomToken } from './crypto.js';
import { isActive, roundMoney } from './validation.js';

export function nowIso() {
  return new Date().toISOString();
}

export function activeRows(rows) {
  return rows.filter(isActive);
}

export function findActive(rows, id) {
  return rows.find((row) => row.id === id && isActive(row));
}

export function settingMap(rows) {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function nextSortOrder(rows) {
  return String(
    rows.reduce((maximum, row) => Math.max(maximum, Number(row.sort_order || 0)), 0) + 1,
  );
}

export function addAudit(auditRows, user, action, entityType, entityId, details = {}) {
  auditRows.push({
    id: `AUD-${randomToken(9)}`,
    timestamp: nowIso(),
    user_id: user?.id || 'system',
    username: user?.username || 'system',
    action,
    entity_type: entityType,
    entity_id: entityId,
    details: JSON.stringify(details),
  });
}

export function productSequence(products, prefix) {
  const expression = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  return products.reduce((maximum, product) => {
    const match = product.id.match(expression);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0) + 1;
}

export function saleSequence(sales, dateToken) {
  const prefix = `VTA-${dateToken}-`;
  return sales.reduce((maximum, sale) => {
    if (!sale.id.startsWith(prefix)) return maximum;
    return Math.max(maximum, Number(sale.id.slice(prefix.length)) || 0);
  }, 0) + 1;
}

export function productPublicStatus(product) {
  return product.status || 'available';
}

export function numericSale(sale) {
  const numericFields = [
    'base_price', 'discount_percent', 'discount_amount', 'extra_percent', 'extra_amount',
    'adjusted_price', 'store_commission_percent', 'store_commission_amount',
    'card_fee_percent', 'card_fee_amount', 'card_fee_tax_percent', 'card_fee_tax_amount',
    'total_card_cost', 'total_deductions', 'net_to_artisan',
  ];
  const converted = { ...sale };
  for (const field of numericFields) converted[field] = roundMoney(Number(sale[field] || 0));
  return converted;
}
