import { Module } from '@nestjs/common';
import { CoursesController, MyPrivateCoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({ controllers: [CoursesController, MyPrivateCoursesController], providers: [CoursesService], exports: [CoursesService] })
export class CoursesModule {}
