import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export const PAYMOB_FETCH = Symbol('PAYMOB_FETCH');
export type PaymobFetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/**
 * The transaction fields Paymob signs, in its order (Accept docs, "HMAC calculation" for the
 * transaction processed callback). Nested paths are read from the callback's `obj`.
 */
const HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

/** The parts of a Paymob transaction the academy reads (the callback's `obj`). */
export interface PaymobTransaction {
  id: number | string;
  amount_cents: number;
  currency: string;
  success: boolean;
  pending: boolean;
  is_voided: boolean;
  is_refunded: boolean;
  has_parent_transaction: boolean;
  created_at: string;
  order: { id: number | string; merchant_order_id?: string | null };
  source_data?: { pan?: string; type?: string; sub_type?: string };
}

function field(obj: Record<string, unknown>, path: string): string {
  let v: unknown = obj;
  for (const part of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined;
  return v === undefined || v === null ? '' : String(v);
}

/** Paymob's HMAC of a transaction: SHA-512 over the listed fields' values, concatenated. */
export function paymobHmac(obj: Record<string, unknown>, secret: string): string {
  return createHmac('sha512', secret)
    .update(HMAC_FIELDS.map((f) => field(obj, f)).join(''))
    .digest('hex');
}

export function verifyPaymobHmac(obj: Record<string, unknown>, received: string | undefined, secret: string): boolean {
  if (!received) return false;
  const a = Buffer.from(paymobHmac(obj, secret));
  const b = Buffer.from(received.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Captured and final: not pending, not a refund or void of an earlier one. */
export function isSettledPayment(t: PaymobTransaction): boolean {
  return t.success === true && t.pending === false && !t.is_voided && !t.is_refunded && !t.has_parent_transaction;
}

export interface CheckoutRequest {
  /** Our CardCheckout id: Paymob echoes it back as the order's merchant_order_id. */
  reference: string;
  amountCents: number;
  currency: string;
  itemName: string;
  billing: { firstName: string; lastName: string; email: string; phone: string };
  notificationUrl: string;
  redirectionUrl: string;
}

/**
 * Paymob's Intention API and Unified Checkout. Card details never reach the academy: the student
 * pays on Paymob's page, and the result arrives on the signed webhook (PaymobWebhookController).
 */
@Injectable()
export class PaymobClient {
  private readonly logger = new Logger(PaymobClient.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYMOB_FETCH) private readonly fetchFn: PaymobFetch,
  ) {}

  /** All keys present. Missing any keeps card payments off (the manual methods still work). */
  get enabled(): boolean {
    const e = this.env;
    return Boolean(e.PAYMOB_SECRET_KEY && e.PAYMOB_PUBLIC_KEY && e.PAYMOB_HMAC_SECRET && e.PAYMOB_CARD_INTEGRATION_ID);
  }

  get hmacSecret(): string | undefined {
    return this.env.PAYMOB_HMAC_SECRET;
  }

  async createCheckout(req: CheckoutRequest): Promise<{ url: string; intentionId: string; orderId: string | null }> {
    const e = this.env;
    if (!this.enabled)
      throw new ServiceUnavailableException({
        code: 'CARD_NOT_CONFIGURED',
        message: 'Card payments are not available',
      });
    const base = e.PAYMOB_API_URL.replace(/\/+$/, '');
    const NA = 'NA'; // Paymob requires every billing field; the academy doesn't collect addresses.
    let res: Awaited<ReturnType<PaymobFetch>>;
    try {
      res = await this.fetchFn(`${base}/v1/intention/`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${e.PAYMOB_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          amount: req.amountCents,
          currency: req.currency,
          payment_methods: [e.PAYMOB_CARD_INTEGRATION_ID],
          items: [{ name: req.itemName.slice(0, 50), amount: req.amountCents, quantity: 1 }],
          billing_data: {
            first_name: req.billing.firstName || NA,
            last_name: req.billing.lastName || NA,
            email: req.billing.email,
            phone_number: req.billing.phone || NA,
            apartment: NA,
            floor: NA,
            street: NA,
            building: NA,
            city: NA,
            country: NA,
            state: NA,
            postal_code: NA,
          },
          special_reference: req.reference,
          notification_url: req.notificationUrl,
          redirection_url: req.redirectionUrl,
        }),
      });
    } catch (err) {
      this.logger.error(`Paymob intention request failed: ${(err as Error).name}`);
      throw new ServiceUnavailableException({
        code: 'CARD_UNAVAILABLE',
        message: 'Card payment is unavailable right now. Try again shortly.',
      });
    }
    const body = (await res.json().catch(() => null)) as {
      id?: unknown;
      client_secret?: unknown;
      intention_order_id?: unknown;
    } | null;
    if (!res.ok || typeof body?.client_secret !== 'string') {
      // Paymob's error body can echo billing data: log the status only.
      this.logger.error(`Paymob intention was refused: HTTP ${res.status}`);
      throw new ServiceUnavailableException({
        code: 'CARD_UNAVAILABLE',
        message: 'Card payment is unavailable right now. Try again shortly.',
      });
    }
    const url = `${base}/unifiedcheckout/?publicKey=${encodeURIComponent(e.PAYMOB_PUBLIC_KEY!)}&clientSecret=${encodeURIComponent(body.client_secret)}`;
    return {
      url,
      intentionId: String(body.id ?? ''),
      orderId: body.intention_order_id == null ? null : String(body.intention_order_id),
    };
  }
}
