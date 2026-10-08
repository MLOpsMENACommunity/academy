import { Suspense } from 'react';
import { RegisterForm } from './RegisterForm';
import { ReservedSpace } from '@/components/ui/Spinner';
import { serverGetOr } from '@/lib/server-api';

// Rendered per request so the form (which reads the query string) is in the
// server HTML: no empty first paint, no layout shift when it appears.
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const google = await serverGetOr<{ enabled: boolean }>('/auth/google/enabled', { enabled: false }, 300);
  return (
    <Suspense fallback={<ReservedSpace className="min-h-[35rem] sm:min-h-[39rem]" />}>
      <RegisterForm googleEnabled={google.enabled} />
    </Suspense>
  );
}
