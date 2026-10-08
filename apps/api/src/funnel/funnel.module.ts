import { Global, Module } from '@nestjs/common';
import { FunnelController } from './funnel.controller';
import { FunnelService } from './funnel.service';

@Global()
@Module({ controllers: [FunnelController], providers: [FunnelService], exports: [FunnelService] })
export class FunnelModule {}
