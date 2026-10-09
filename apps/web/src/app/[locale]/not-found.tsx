import type { Metadata } from 'next';
import { NotFoundView } from './NotFoundView';
import { pageTitle } from '@/lib/seo';

// "Page not found | MLOps MENA Academy" instead of the homepage title.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageTitle((await params).locale, 'errors.notFoundTitle');
}

export default function NotFound() {
  return <NotFoundView />;
}
