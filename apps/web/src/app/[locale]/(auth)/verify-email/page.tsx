import { Suspense } from 'react';
import { VerifyEmail } from './VerifyEmail';
import { ReservedSpace } from '@/components/ui/Spinner';

// Rendered per request so the form (which reads the query string) is in the
// server HTML: no empty first paint, no layout shift when it appears.
export const dynamic = 'force-dynamic';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<ReservedSpace className="min-h-[32rem] sm:min-h-[36rem]" />}>
      <VerifyEmail />
    </Suspense>
  );
}
