'use client';

import { RequireAuth } from '@/components/auth/RequireAuth';
import { MyBookings } from '@/components/consultations/MyBookings';
import { Container } from '@/components/ui/Container';

/** My consultation bookings, upcoming first. */
export default function MyConsultationsPage() {
  return (
    <Container className="max-w-3xl py-8 sm:py-12">
      <RequireAuth>{() => <MyBookings />}</RequireAuth>
    </Container>
  );
}
