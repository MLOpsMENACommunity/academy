import { Suspense } from 'react';
import { StudentsDirectory } from './StudentsDirectory';

export default function Page() {
  return (
    <Suspense>
      <StudentsDirectory />
    </Suspense>
  );
}
