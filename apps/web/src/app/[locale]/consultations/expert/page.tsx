'use client';

import { RequireAuth } from '@/components/auth/RequireAuth';
import { ExpertPortal } from '@/components/consultations/ExpertPortal';
import { Container } from '@/components/ui/Container';

/** The expert's own consultations page (any account whose speaker profile offers calls; the API checks). */
export default function ExpertConsultationsPage() {
  return (
    <Container className="max-w-4xl py-8 sm:py-12">
      <RequireAuth>{() => <ExpertPortal />}</RequireAuth>
    </Container>
  );
}
