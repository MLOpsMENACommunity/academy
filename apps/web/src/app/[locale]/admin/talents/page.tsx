import { Suspense } from 'react';
import { TalentInsights } from './TalentInsights';

export default function Page() {
  return (
    <Suspense>
      <TalentInsights />
    </Suspense>
  );
}
