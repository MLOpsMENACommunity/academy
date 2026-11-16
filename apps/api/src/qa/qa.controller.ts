import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  acceptAnswerSchema,
  answerSchema,
  askQuestionSchema,
  editAnswerSchema,
  editQuestionSchema,
  qaCloseSchema,
  qaHideSchema,
  qaListQuerySchema,
  qaPinSchema,
  type AcceptAnswerInput,
  type AnswerInput,
  type AskQuestionInput,
  type EditQuestionInput,
  type QaListDto,
  type QaListQuery,
  type QuestionDetailDto,
} from '@academy/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { QaService } from './qa.service';

/** Posting: 20 a minute per person. Votes, follows and moderation: 60. */
const POST_LIMIT = { default: { limit: 20, ttl: 60_000 } };
const ACTION_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/**
 * Course Q&A on the learn page and in the Teaching area's Q&A tab. Open to students enrolled in
 * the course, its staff with "Answer questions" and SUPER/ACADEMIC admins (QaService checks it on
 * every request); pin, close and hide need "Answer questions".
 */
@ApiTags('learn')
@Controller('learn/:slug/qa')
export class QaController {
  constructor(private readonly qa: QaService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Query(new ZodPipe(qaListQuerySchema)) query: QaListQuery): Promise<QaListDto> {
    return this.qa.list(user, slug, query);
  }

  @Get(':questionId')
  @Header('Cache-Control', 'private, no-store')
  detail(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('questionId') questionId: string): Promise<QuestionDetailDto> {
    return this.qa.detail(user, slug, questionId);
  }

  @Post()
  @Throttle(POST_LIMIT)
  ask(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body(new ZodPipe(askQuestionSchema)) body: AskQuestionInput): Promise<QuestionDetailDto> {
    return this.qa.ask(user, slug, body);
  }

  @Patch(':questionId')
  @Throttle(POST_LIMIT)
  editQuestion(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('questionId') questionId: string,
    @Body(new ZodPipe(editQuestionSchema)) body: EditQuestionInput,
  ): Promise<QuestionDetailDto> {
    return this.qa.editQuestion(user, slug, questionId, body);
  }

  @Post(':questionId/answers')
  @Throttle(POST_LIMIT)
  answer(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('questionId') questionId: string, @Body(new ZodPipe(answerSchema)) body: AnswerInput): Promise<QuestionDetailDto> {
    return this.qa.answer(user, slug, questionId, body);
  }

  @Patch(':questionId/answers/:answerId')
  @Throttle(POST_LIMIT)
  editAnswer(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('questionId') questionId: string,
    @Param('answerId') answerId: string,
    @Body(new ZodPipe(editAnswerSchema)) body: AnswerInput,
  ): Promise<QuestionDetailDto> {
    return this.qa.editAnswer(user, slug, questionId, answerId, body);
  }

  @Put(':questionId/vote')
  @Throttle(ACTION_LIMIT)
  vote(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('questionId') questionId: string): Promise<QuestionDetailDto> {
    return this.qa.vote(user, slug, questionId, true);
  }

  @Delete(':questionId/vote')
  @Throttle(ACTION_LIMIT)
  unvote(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('questionId') questionId: string): Promise<QuestionDetailDto> {
    return this.qa.vote(user, slug, questionId, false);
  }

  @Put(':questionId/follow')
  @Throttle(ACTION_LIMIT)
  follow(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('questionId') questionId: string): Promise<QuestionDetailDto> {
    return this.qa.follow(user, slug, questionId, true);
  }

  @Delete(':questionId/follow')
  @Throttle(ACTION_LIMIT)
  unfollow(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('questionId') questionId: string): Promise<QuestionDetailDto> {
    return this.qa.follow(user, slug, questionId, false);
  }

  @Put(':questionId/accept')
  @Throttle(ACTION_LIMIT)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('questionId') questionId: string,
    @Body(new ZodPipe(acceptAnswerSchema)) body: AcceptAnswerInput,
  ): Promise<QuestionDetailDto> {
    return this.qa.accept(user, slug, questionId, body.answerId);
  }

  @Put(':questionId/pin')
  @Throttle(ACTION_LIMIT)
  pin(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('questionId') questionId: string, @Body(new ZodPipe(qaPinSchema)) body: { pinned: boolean }): Promise<QuestionDetailDto> {
    return this.qa.pin(user, slug, questionId, body.pinned);
  }

  @Put(':questionId/close')
  @Throttle(ACTION_LIMIT)
  close(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('questionId') questionId: string, @Body(new ZodPipe(qaCloseSchema)) body: { closed: boolean }): Promise<QuestionDetailDto> {
    return this.qa.close(user, slug, questionId, body.closed);
  }

  @Put(':questionId/hide')
  @Throttle(ACTION_LIMIT)
  hideQuestion(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('questionId') questionId: string, @Body(new ZodPipe(qaHideSchema)) body: { hidden: boolean }): Promise<QuestionDetailDto> {
    return this.qa.hideQuestion(user, slug, questionId, body.hidden);
  }

  @Put(':questionId/answers/:answerId/hide')
  @Throttle(ACTION_LIMIT)
  hideAnswer(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('questionId') questionId: string,
    @Param('answerId') answerId: string,
    @Body(new ZodPipe(qaHideSchema)) body: { hidden: boolean },
  ): Promise<QuestionDetailDto> {
    return this.qa.hideAnswer(user, slug, questionId, answerId, body.hidden);
  }
}
