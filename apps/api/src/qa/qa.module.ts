import { Module } from '@nestjs/common';
import { PointsModule } from '../points/points.module';
import { QaController } from './qa.controller';
import { QaService } from './qa.service';

/** Course Q&A: questions, answers, votes and follows (learn/:slug/qa). */
@Module({ imports: [PointsModule], controllers: [QaController], providers: [QaService] })
export class QaModule {}
