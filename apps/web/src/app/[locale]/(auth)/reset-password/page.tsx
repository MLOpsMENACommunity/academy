import { Suspense } from 'react';
import { ResetForm } from './ResetForm';
import { ReservedSpace } from '@/components/ui/Spinner';

// Rendered per request so the form (which reads the query string) is in the
// server HTML: no empty first paint, no layout shift when it appears.
export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ReservedSpace className="min-h-[21rem] sm:min-h-[25rem]" />}>
      <ResetForm />
    </Suspense>
  );
}
