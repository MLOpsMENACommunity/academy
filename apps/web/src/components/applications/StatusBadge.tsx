import { applicationStatusLabels, type ApplicationStatus, type Locale } from '@academy/shared';
import { Badge, type Tone } from '../ui/Badge';

export const statusTone: Record<ApplicationStatus, Tone> = {
  SUBMITTED: 'info',
  SHORTLISTED: 'primary',
  AWAITING_PAYMENT: 'accent',
  PAYMENT_SUBMITTED: 'info',
  PAYMENT_REJECTED: 'danger',
  ENROLLED: 'success',
  REJECTED: 'neutral',
  WAITLISTED: 'warning',
  WITHDRAWN: 'neutral',
};

export function StatusBadge({ status, locale }: { status: ApplicationStatus; locale: Locale }) {
  return <Badge tone={statusTone[status]}>{applicationStatusLabels[status][locale]}</Badge>;
}
