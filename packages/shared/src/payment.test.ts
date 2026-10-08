import { describe, expect, it } from 'vitest';
import { computePaymentFlags, normalizeTransactionRef, paymentProofSchema } from './payment';

describe('paymentProofSchema', () => {
  const ok = { method: 'INSTAPAY', amount: '2500', transactionRef: 'IP-123456', senderName: 'Aya', senderPhone: 'aya@instapay', paidAt: new Date().toISOString() };
  it('accepts a valid proof and coerces numbers and dates', () => {
    const r = paymentProofSchema.parse(ok);
    expect(r.amount).toBe(2500);
    expect(r.paidAt).toBeInstanceOf(Date);
  });
  it('rejects card payments, future dates and junk references', () => {
    expect(paymentProofSchema.safeParse({ ...ok, method: 'CARD' }).success).toBe(false);
    expect(paymentProofSchema.safeParse({ ...ok, paidAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }).success).toBe(false);
    expect(paymentProofSchema.safeParse({ ...ok, transactionRef: '<script>' }).success).toBe(false);
    expect(paymentProofSchema.safeParse({ ...ok, amount: '0' }).success).toBe(false);
    expect(paymentProofSchema.safeParse({ ...ok, transactionRef: '-- --' }).success).toBe(false);
  });
});

describe('computePaymentFlags', () => {
  const p = { id: 'p1', transactionRef: 'ip-12 34', screenshotSha256: 'abc', amount: 2500 };
  it('flags reused references (ignoring case and punctuation), reused screenshots and wrong amounts', () => {
    const flags = computePaymentFlags(p, 3000, [
      { id: 'p1', transactionRef: 'IP1234', screenshotSha256: 'abc' },
      { id: 'p2', transactionRef: 'IP-1234', screenshotSha256: 'zzz' },
      { id: 'p3', transactionRef: 'other', screenshotSha256: 'abc' },
    ]);
    expect(flags).toEqual({ duplicateRef: true, duplicateScreenshot: true, amountMismatch: true });
  });
  it('does not flag a payment against itself', () => {
    expect(computePaymentFlags(p, 2500, [{ id: 'p1', transactionRef: 'IP1234', screenshotSha256: 'abc' }])).toEqual({
      duplicateRef: false,
      duplicateScreenshot: false,
      amountMismatch: false,
    });
  });
  it('normalises references', () => {
    expect(normalizeTransactionRef(' ab-12/3.4 ')).toBe('AB1234');
  });
});
