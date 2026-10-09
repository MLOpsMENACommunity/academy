import { Suspense } from 'react';
import { RegisterForm } from './RegisterForm';
import { ReservedSpace } from '@/components/ui/Spinner';
import { serverGetOr } from '@/lib/server-api';

// Static (ISR, for the Google sign-in flag): the form reads the query string (returnTo,
// error) on the client only, so it is still in the server HTML and the page can be
// served from the cache.
export const revalidate = 300;

export default async function RegisterPage() {
  const google = await serverGetOr<{ enabled: boolean }>('/auth/google/enabled', { enabled: false }, 300);
  return (
    <Suspense fallback={<ReservedSpace className="min-h-[35rem] sm:min-h-[39rem]" />}>
      <RegisterForm googleEnabled={google.enabled} />
    </Suspense>
  );
}
