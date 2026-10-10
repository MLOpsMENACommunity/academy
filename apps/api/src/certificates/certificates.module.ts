import { Module } from '@nestjs/common';
import { AssessmentsModule } from '../assessments/assessments.module';
import { AdminCertificatesController, CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  imports: [AssessmentsModule],
  controllers: [CertificatesController, AdminCertificatesController],
  providers: [CertificatesService],
  // CertificatesService.issue(...) and onIssued(...) are the hooks for points and badges.
  exports: [CertificatesService],
})
export class CertificatesModule {}
