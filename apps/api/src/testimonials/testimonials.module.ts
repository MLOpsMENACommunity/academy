import { Module } from '@nestjs/common';
import { AdminTestimonialsController, TestimonialsController } from './testimonials.controller';
import { TestimonialsService } from './testimonials.service';

@Module({ controllers: [TestimonialsController, AdminTestimonialsController], providers: [TestimonialsService] })
export class TestimonialsModule {}
