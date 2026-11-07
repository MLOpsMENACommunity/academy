import { createHmac } from 'node:crypto';
import { isSettledPayment, paymobHmac, verifyPaymobHmac, type PaymobTransaction } from './paymob';

const SECRET = 'test-hmac-secret';

/** A transaction shaped like Paymob's callback `obj` (only the signed fields and a few more). */
const txn = (over: Partial<PaymobTransaction> = {}): PaymobTransaction & Record<string, unknown> => ({
  id: 192036465,
  amount_cents: 250000,
  created_at: '2026-10-26T12:00:00.000000',
  currency: 'EGP',
  error_occured: false,
  has_parent_transaction: false,
  integration_id: 4560001,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 217503754, merchant_order_id: 'ckcheckout1' },
  owner: 302852,
  pending: false,
  source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
  success: true,
  ...over,
});

describe('Paymob HMAC', () => {
  it('signs the documented fields in order, booleans as true/false and nested paths', () => {
    const concatenated =
      '2500002026-10-26T12:00:00.000000EGPfalsefalse1920364654560001truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue';
    expect(paymobHmac(txn(), SECRET)).toBe(createHmac('sha512', SECRET).update(concatenated).digest('hex'));
  });

  it('accepts the right signature in either case and refuses tampering or a missing one', () => {
    const sig = paymobHmac(txn(), SECRET);
    expect(verifyPaymobHmac(txn(), sig, SECRET)).toBe(true);
    expect(verifyPaymobHmac(txn(), sig.toUpperCase(), SECRET)).toBe(true);
    expect(verifyPaymobHmac(txn({ amount_cents: 100 }), sig, SECRET)).toBe(false);
    expect(verifyPaymobHmac(txn(), sig, 'another-secret')).toBe(false);
    expect(verifyPaymobHmac(txn(), undefined, SECRET)).toBe(false);
    expect(verifyPaymobHmac(txn(), 'short', SECRET)).toBe(false);
  });
});

describe('isSettledPayment', () => {
  it('is true only for a successful, final, original transaction', () => {
    expect(isSettledPayment(txn())).toBe(true);
    expect(isSettledPayment(txn({ success: false }))).toBe(false);
    expect(isSettledPayment(txn({ pending: true }))).toBe(false);
    expect(isSettledPayment(txn({ is_refunded: true }))).toBe(false);
    expect(isSettledPayment(txn({ is_voided: true }))).toBe(false);
    expect(isSettledPayment(txn({ has_parent_transaction: true }))).toBe(false);
  });
});
