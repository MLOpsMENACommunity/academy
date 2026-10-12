import { Module } from '@nestjs/common';
import { PointsModule } from '../points/points.module';
import { AdminAttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

/** Attendance from Google Meet and its points (see AttendanceService). */
@Module({
  imports: [PointsModule],
  controllers: [AdminAttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
