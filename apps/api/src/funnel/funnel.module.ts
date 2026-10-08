import { Global, Module } from '@nestjs/common';
import { FunnelService } from './funnel.service';

@Global()
@Module({ providers: [FunnelService], exports: [FunnelService] })
export class FunnelModule {}
