import assert from 'node:assert/strict';
import { parseCsv, stringifyCsv } from '../functions/_lib/csv.js';
import { calculateSale } from '../functions/_lib/calculations.js';
import { productSequence } from '../functions/_lib/domain.js';

const rows = [
  { id: '1', name: 'María, bordadora', notes: 'Línea 1\nLínea "2"' },
  { id: '2', name: 'Aydé', notes: '' },
];
const csv = stringifyCsv(rows, ['id', 'name', 'notes']);
assert.deepEqual(parseCsv(csv), rows, 'El CSV debe conservar comas, acentos, comillas y saltos de línea.');

const result = calculateSale({
  basePrice: 1000,
  storeCommissionPercent: 30,
  cardFeeApplies: true,
  cardFeePercent: 3.5,
  cardFeeTaxPercent: 16,
});
assert.equal(result.store_commission_amount, 300);
assert.equal(result.card_fee_amount, 35);
assert.equal(result.card_fee_tax_amount, 5.6);
assert.equal(result.net_to_artisan, 659.4);

assert.equal(productSequence([
  { id: 'ACF-ADU-BLU-0001' },
  { id: 'ACF-ADU-BLU-0004' },
  { id: 'OTRO-001' },
], 'ACF-ADU-BLU'), 5);

console.log('Comprobaciones completadas correctamente.');
