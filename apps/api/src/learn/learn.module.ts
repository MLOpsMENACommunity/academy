import { Module } from '@nestjs/common';
import { PointsModule } from '../points/points.module';
import { LearnController } from './learn.controller';
import { LearnService } from './learn.service';

@Module({ imports: [PointsModule], controllers: [LearnController], providers: [LearnService], exports: [LearnService] })
export class LearnModule {}
