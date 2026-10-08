import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [HealthController],
})
export class AppModule {}
