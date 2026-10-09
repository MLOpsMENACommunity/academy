import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetForm } from './ResetForm';
import { ReservedSpace } from '@/components/ui/Spinner';
import { pageTitle } from '@/lib/seo';

// Rendered per request so the form (which reads the query string) is in the
// server HTML: no empty first paint, no layout shift when it appears.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageTitle((await params).locale, 'auth.resetTitle');
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ReservedSpace className="min-h-[21rem] sm:min-h-[25rem]" />}>
      <ResetForm />
    </Suspense>
  );
}
