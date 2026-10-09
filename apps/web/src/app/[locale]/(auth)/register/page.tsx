import { Suspense } from 'react';
import { RegisterForm } from './RegisterForm';
import { ReservedSpace } from '@/components/ui/Spinner';
import { serverGet } from '@/lib/server-api';

// Static (ISR, for the Google sign-in flag): the form reads the query string (returnTo,
// error) on the client only, so it is still in the server HTML and the page can be
// served from the cache.
export const revalidate = 300;

export default async function RegisterPage() {
  // serverGet: an API failure fails the render instead of caching the page without Google sign-in.
  const google = (await serverGet<{ enabled: boolean }>('/auth/google/enabled', 300)) ?? { enabled: false };
  return (
    <Suspense fallback={<ReservedSpace className="min-h-[35rem] sm:min-h-[39rem]" />}>
      <RegisterForm googleEnabled={google.enabled} />
    </Suspense>
  );
}
