'use client';

import { useParams } from 'next/navigation';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { BookingView } from '@/components/consultations/BookingView';
import { Container } from '@/components/ui/Container';

/** One of my consultation bookings (signed in; the API only returns the student's own). */
export default function ConsultationBookingPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Container className="max-w-3xl py-8 sm:py-12">
      <RequireAuth>{() => <BookingView id={id} />}</RequireAuth>
    </Container>
  );
}
