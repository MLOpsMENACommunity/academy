import { z } from 'zod';
import { MANUAL_PAYMENT_METHODS, type PaymentMethod, type PaymentStatus } from './enums';

/** Proof-of-payment fields (the screenshot is a separate multipart file). */
export const paymentProofSchema = z.object({
  method: z.enum(MANUAL_PAYMENT_METHODS),
  amount: z.coerce.number().int('Enter a whole amount').positive('Enter the amount you paid').max(1_000_000),
  transactionRef: z
    .string()
    .trim()
    .min(4, 'Enter the transaction reference number')
    .max(64)
    .regex(/^[A-Za-z0-9\-_/.]+$/, 'Use the reference exactly as shown (letters and digits)'),
  senderName: z.string().trim().min(2, 'Enter the sender name').max(120),
  /** Phone number (Vodafone Cash) or InstaPay handle / IPA. */
  senderPhone: z.string().trim().min(4, 'Enter the sender phone or InstaPay handle').max(80),
  paidAt: z.coerce
    .date({ invalid_type_error: 'Enter the payment date' })
    .refine((d) => d.getTime() <= Date.now() + 24 * 3600_000, 'The payment date cannot be in the future')
    .refine((d) => d.getTime() >= Date.now() - 365 * 86_400_000, 'The payment date is too far in the past'),
});
export type PaymentProofInput = z.infer<typeof paymentProofSchema>;

/** References are compared case- and punctuation-insensitively for duplicate checks. */
export function normalizeTransactionRef(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

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
  supportEmail: string;
  supportWhatsapp: string;
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
  course: { id: string; slug: string; titleEn: string; price: number; currency: string };
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
