import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ApplicationWorkflow } from './workflow.service';

@Module({
  controllers: [ApplicationsController],
  providers: [ApplicationsService, ApplicationWorkflow],
  exports: [ApplicationsService, ApplicationWorkflow],
})
export class ApplicationsModule {}
