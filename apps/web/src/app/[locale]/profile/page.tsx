import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProfilePage } from './ProfilePage';

export const metadata: Metadata = { robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <ProfilePage />
    </Suspense>
  );
}
