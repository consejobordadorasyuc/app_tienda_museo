import { AppError } from './errors.js';
import { percentage, roundMoney } from './validation.js';

export function calculateSale({
  basePrice,
  discountPercent = 0,
  extraPercent = 0,
  storeCommissionPercent = 0,
  cardFeeApplies = false,
  cardFeePercent = 0,
  cardFeeTaxPercent = 0,
}) {
  const base = roundMoney(Number(basePrice));
  const discount = percentage(discountPercent, 'El descuento');
  const extra = percentage(extraPercent, 'El cargo extra');

  if (discount > 0 && extra > 0) {
    throw new AppError(400, 'INVALID_PRICE_ADJUSTMENT', 'No se puede aplicar descuento y cargo extra a la misma venta.');
  }

  const commissionPercent = percentage(storeCommissionPercent, 'La comisión de tienda');
  const feePercent = cardFeeApplies ? percentage(cardFeePercent, 'La comisión de tarjeta') : 0;
  const feeTaxPercent = cardFeeApplies ? percentage(cardFeeTaxPercent, 'El impuesto de la comisión de tarjeta') : 0;

  const discountAmount = roundMoney(base * (discount / 100));
  const extraAmount = roundMoney(base * (extra / 100));
  const adjustedPrice = roundMoney(base - discountAmount + extraAmount);
  const storeCommissionAmount = roundMoney(adjustedPrice * (commissionPercent / 100));
  const cardFeeAmount = roundMoney(adjustedPrice * (feePercent / 100));
  const cardFeeTaxAmount = roundMoney(cardFeeAmount * (feeTaxPercent / 100));
  const totalCardCost = roundMoney(cardFeeAmount + cardFeeTaxAmount);
  const totalDeductions = roundMoney(storeCommissionAmount + totalCardCost);
  const netToArtisan = roundMoney(adjustedPrice - totalDeductions);

  return {
    base_price: base,
    discount_percent: discount,
    discount_amount: discountAmount,
    extra_percent: extra,
    extra_amount: extraAmount,
    adjusted_price: adjustedPrice,
    store_commission_percent: commissionPercent,
    store_commission_amount: storeCommissionAmount,
    card_fee_percent: feePercent,
    card_fee_amount: cardFeeAmount,
    card_fee_tax_percent: feeTaxPercent,
    card_fee_tax_amount: cardFeeTaxAmount,
    total_card_cost: totalCardCost,
    total_deductions: totalDeductions,
    net_to_artisan: netToArtisan,
  };
}
