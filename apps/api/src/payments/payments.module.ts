import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { CardPaymentsService } from './card-payments.service';
import { PAYMOB_FETCH, PaymobClient, type PaymobFetch } from './paymob';
import { PaymobWebhookController } from './paymob-webhook.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [ApplicationsModule],
  controllers: [PaymentsController, PaymobWebhookController],
  providers: [
    PaymentsService,
    CardPaymentsService,
    PaymobClient,
    { provide: PAYMOB_FETCH, useValue: ((url, init) => fetch(url, init)) satisfies PaymobFetch },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
