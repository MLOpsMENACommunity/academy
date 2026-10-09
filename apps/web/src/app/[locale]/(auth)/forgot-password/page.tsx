import type { Metadata } from 'next';
import { ForgotForm } from './ForgotForm';
import { pageTitle } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageTitle((await params).locale, 'auth.forgotTitle');
}

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
