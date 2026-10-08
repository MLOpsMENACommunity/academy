import { Suspense } from 'react';
import { ApplicationsTable } from './ApplicationsTable';

export default function Page() {
  return (
    <Suspense>
      <ApplicationsTable />
    </Suspense>
  );
}
