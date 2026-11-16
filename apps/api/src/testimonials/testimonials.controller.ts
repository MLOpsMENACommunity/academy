import { Body, Controller, Delete, Get, Header, HttpCode, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { testimonialReviewSchema, testimonialSchema, type AdminTestimonialDto, type TestimonialInput, type TestimonialReviewInput } from '@academy/shared';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { TestimonialsService } from './testimonials.service';

@ApiTags('learn')
@Controller('learn/:slug/testimonial')
export class TestimonialsController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Put()
  @HttpCode(204)
  async save(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body(new ZodPipe(testimonialSchema)) body: TestimonialInput): Promise<void> {
    await this.testimonials.save(user, slug, body);
  }

  @Delete()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<void> {
    await this.testimonials.remove(user, slug);
  }
}

@ApiTags('admin')
@Controller('admin/courses/:id/testimonials')
@Roles('ADMIN')
export class AdminTestimonialsController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Get()
  @AdminCan('ACADEMIC')
  @Header('Cache-Control', 'private, no-store')
  list(@Param('id') id: string): Promise<AdminTestimonialDto[]> {
    return this.testimonials.list(id);
  }

  @Put(':testimonialId/review')
  @AdminCan('ACADEMIC')
  @HttpCode(204)
  async review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('testimonialId') testimonialId: string,
    @Body(new ZodPipe(testimonialReviewSchema)) body: TestimonialReviewInput,
  ): Promise<void> {
    await this.testimonials.review(id, testimonialId, body, user.id);
  }
}
