import { Module } from '@nestjs/common';
import { DRIVE_API, GoogleDriveApi } from './drive-api';
import { DriveSharingJobs } from './drive-sharing.jobs';
import { DriveSharingService } from './drive-sharing.service';

@Module({
  providers: [{ provide: DRIVE_API, useClass: GoogleDriveApi }, DriveSharingService, DriveSharingJobs],
  exports: [DriveSharingService],
})
export class DriveModule {}
