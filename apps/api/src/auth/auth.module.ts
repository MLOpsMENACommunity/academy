import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ENV } from '../config/config.module';
import { InvitesModule } from '../invites/invites.module';
import type { Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleService } from './google.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    InvitesModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: { expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`, issuer: 'academy', audience: 'academy' },
        verifyOptions: { issuer: 'academy', audience: 'academy' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokensService, GoogleService],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
