import { Suspense } from 'react';
import { LoginForm } from './LoginForm';
import { ReservedSpace } from '@/components/ui/Spinner';
import { serverGetOr } from '@/lib/server-api';

// Rendered per request so the form (which reads the query string) is in the
// server HTML: no empty first paint, no layout shift when it appears.
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const google = await serverGetOr<{ enabled: boolean }>('/auth/google/enabled', { enabled: false }, 300);
  return (
    <Suspense fallback={<ReservedSpace className="min-h-[32rem] sm:min-h-[36rem]" />}>
      <LoginForm googleEnabled={google.enabled} />
    </Suspense>
  );
}
