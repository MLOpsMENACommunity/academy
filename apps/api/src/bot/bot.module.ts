import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotTokenGuard } from './bot-token.guard';
import { BotService } from './bot.service';

/** The community bot's read-only view of quizzes, tasks and attendance. */
@Module({
  controllers: [BotController],
  providers: [BotService, BotTokenGuard],
})
export class BotModule {}
