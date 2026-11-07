import { Body, Controller, HttpCode, Logger, NotFoundException, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { CardPaymentsService } from './card-payments.service';
import { PaymobClient, verifyPaymobHmac, type PaymobTransaction } from './paymob';

/**
 * Paymob's "transaction processed" callback (server to server, JSON). Trusted only with a valid
 * HMAC; the answer is 200 for every signed callback, so Paymob stops retrying.
 */
@ApiExcludeController()
@Controller('payments/paymob')
export class PaymobWebhookController {
  private readonly logger = new Logger(PaymobWebhookController.name);

  constructor(
    private readonly paymob: PaymobClient,
    private readonly cards: CardPaymentsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Query('hmac') hmac: string | undefined,
    @Body() body: { type?: string; obj?: Record<string, unknown> },
  ): Promise<{ received: true }> {
    const secret = this.paymob.hmacSecret;
    if (!this.paymob.enabled || !secret) throw new NotFoundException();
    const obj = body?.obj;
    if (!obj || typeof obj !== 'object' || !verifyPaymobHmac(obj, hmac, secret)) throw new UnauthorizedException();
    // Token callbacks (saved cards) and other types carry no payment.
    if (body.type !== 'TRANSACTION') return { received: true };
    const outcome = await this.cards.handleTransaction(obj as unknown as PaymobTransaction);
    this.logger.log(`Paymob transaction ${String(obj.id)}: ${outcome}`);
    return { received: true };
  }
}
