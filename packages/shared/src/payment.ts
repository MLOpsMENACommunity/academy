import { z } from 'zod';
import { LOCALES, MANUAL_PAYMENT_METHODS, type PaymentMethod, type PaymentStatus } from './enums';
import { realValue } from './settings';

/** Proof-of-payment fields (the screenshot is a separate multipart file). */
/** References are compared case- and punctuation-insensitively for duplicate checks. */
export function normalizeTransactionRef(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Arabic-Indic (٠-٩) and Persian (۰-۹) digits as 0-9: phones with an Arabic keyboard type them in
 * the amount, reference and phone fields, and receipts in Arabic show them too.
 */
export function asciiDigits(v: string): string {
  return v.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) & 0xf));
}
const withAsciiDigits = (v: unknown) => (typeof v === 'string' ? asciiDigits(v) : v);

export const paymentProofSchema = z.object({
  method: z.enum(MANUAL_PAYMENT_METHODS),
  amount: z.preprocess(
    withAsciiDigits,
    z.coerce
      .number({ invalid_type_error: 'Enter the amount you paid' })
      .int('Enter a whole amount')
      .positive('Enter the amount you paid')
      .max(1_000_000),
  ),
  transactionRef: z.preprocess(
    withAsciiDigits,
    z
      .string()
      .trim()
      .min(4, 'Enter the transaction reference number')
      .max(64)
      // Spaces allowed: references are often copied as 'IP 1234 5678'. Duplicate checks ignore them.
      .regex(/^[A-Za-z0-9\-_/. ]+$/, 'Use the reference exactly as shown (letters and digits)')
      // '----' would normalise to '' and "match" every other blank reference.
      .refine((v) => normalizeTransactionRef(v).length >= 4, 'Enter the transaction reference number'),
  ),
  senderName: z.string().trim().min(2, 'Enter the sender name').max(120),
  /** Phone number (Vodafone Cash) or InstaPay handle / IPA. */
  senderPhone: z.preprocess(withAsciiDigits, z.string().trim().min(4, 'Enter the sender phone or InstaPay handle').max(80)),
  paidAt: z.coerce
    .date({ invalid_type_error: 'Enter the payment date' })
    .refine((d) => d.getTime() <= Date.now() + 24 * 3600_000, 'The payment date cannot be in the future')
    .refine((d) => d.getTime() >= Date.now() - 365 * 86_400_000, 'The payment date is too far in the past'),
});
export type PaymentProofInput = z.infer<typeof paymentProofSchema>;

export interface PaymentFlags {
  /** Same transaction reference used on another payment. */
  duplicateRef: boolean;
  /** Byte-identical screenshot uploaded on another payment. */
  duplicateScreenshot: boolean;
  /** Amount differs from the course price. */
  amountMismatch: boolean;
}

export function computePaymentFlags(
  p: { id: string; transactionRef: string; screenshotSha256: string | null; amount: number },
  coursePrice: number,
  others: { id: string; transactionRef: string; screenshotSha256: string | null }[],
): PaymentFlags {
  const ref = normalizeTransactionRef(p.transactionRef);
  const rest = others.filter((o) => o.id !== p.id);
  return {
    duplicateRef: rest.some((o) => normalizeTransactionRef(o.transactionRef) === ref),
    duplicateScreenshot: Boolean(p.screenshotSha256) && rest.some((o) => o.screenshotSha256 === p.screenshotSha256),
    amountMismatch: p.amount !== coursePrice,
  };
}

export const rejectPaymentSchema = z.object({ reason: z.string().trim().min(3, 'Give the student a reason').max(1000) });
export const approvePaymentSchema = z.object({
  /** The admin confirms they checked the real InstaPay / wallet history, not just the screenshot. */
  verifiedInHistory: z.literal(true, { errorMap: () => ({ message: 'Confirm you verified it in the transaction history' }) }),
});

export interface PaymentInstructionsDto {
  amount: number;
  currency: string;
  instapayHandle: string;
  instapayName: string;
  vodafoneCashNumber: string;
  vodafoneCashName: string;
  /** Empty when not set: the page then points to the contact page instead. */
  supportEmail: string;
  supportWhatsapp: string;
  /** Methods with real details; empty until an admin sets them in Settings. */
  methods: ('INSTAPAY' | 'VODAFONE_CASH')[];
  /** False until an admin sets real payment details in Settings. */
  configured: boolean;
  /** Card payments through Paymob are set up (its keys are in the API's environment). */
  cardEnabled: boolean;
}

/** Starting a card payment; the locale is the language Paymob returns the student to. */
export const cardCheckoutSchema = z.object({ locale: z.enum(LOCALES).default('en') });

/** Where to send the student to pay by card (Paymob's hosted checkout). */
export interface CardCheckoutDto {
  url: string;
}

/** Stored on a card payment that arrived when the application could no longer be enrolled. */
export const CARD_PAYMENT_NEEDS_REFUND = 'Paid by card after the application was no longer awaiting payment: refund it';

/** The manual payment methods whose details are set in Settings (only those are offered). */
export function configuredPaymentMethods(s: { instapayHandle: string; vodafoneCashNumber: string }): ('INSTAPAY' | 'VODAFONE_CASH')[] {
  const out: ('INSTAPAY' | 'VODAFONE_CASH')[] = [];
  if (realValue(s.instapayHandle)) out.push('INSTAPAY');
  if (realValue(s.vodafoneCashNumber)) out.push('VODAFONE_CASH');
  return out;
}

/** Payments are refused until at least one method has real details in Settings. */
export function paymentsConfigured(s: { instapayHandle: string; vodafoneCashNumber: string }): boolean {
  return configuredPaymentMethods(s).length > 0;
}

export interface MyPaymentDto {
  id: string;
  method: PaymentMethod;
  amount: number;
  currency: string;
  transactionRef: string;
  paidAt: string;
  status: PaymentStatus;
  rejectionReason: string | null;
  createdAt: string;
}

export interface AdminPaymentDto extends MyPaymentDto {
  senderName: string;
  senderPhone: string;
  hasScreenshot: boolean;
  screenshotDeleted: boolean;
  screenshotMime: string | null;
  verifiedInHistory: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  flags: PaymentFlags;
  /** Other payments sharing this reference or screenshot, for the admin to inspect. */
  duplicates: { id: string; studentName: string | null; courseTitle: string; status: PaymentStatus; createdAt: string }[];
  application: { id: string; status: string; createdAt: string };
  course: { id: string; slug: string; titleEn: string; titleAr: string; price: number; currency: string };
  student: {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    country: string | null;
    googleEmail: string | null;
    jobTitle: string | null;
  };
}
