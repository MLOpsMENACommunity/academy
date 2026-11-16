import { Module } from '@nestjs/common';
import { AdminReviewsController, AdminTestimonialsController, TestimonialsController } from './testimonials.controller';
import { TestimonialsService } from './testimonials.service';

@Module({ controllers: [TestimonialsController, AdminTestimonialsController, AdminReviewsController], providers: [TestimonialsService] })
export class TestimonialsModule {}
