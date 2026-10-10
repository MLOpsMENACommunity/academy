import { Module } from '@nestjs/common';
import { AssessmentsModule } from '../assessments/assessments.module';
import { PointsModule } from '../points/points.module';
import { AdminCertificatesController, CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  imports: [AssessmentsModule, PointsModule],
  controllers: [CertificatesController, AdminCertificatesController],
  providers: [CertificatesService],
  // Points and badges are wired directly (PointsService.onCertificateIssued / onCertificateRevoked);
  // onIssued(...) stays for any other feature that needs to react.
  exports: [CertificatesService],
})
export class CertificatesModule {}
