import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { notFoundMetadata } from '@/lib/seo';

/** Unknown paths under /en or /ar render the localized 404 instead of the root one. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return notFoundMetadata((await params).locale);
}

export default function CatchAll() {
  notFound();
}
