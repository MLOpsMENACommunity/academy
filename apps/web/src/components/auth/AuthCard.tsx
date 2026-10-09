import type { ReactNode } from 'react';

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="bg-muted-bg">
      <div className="mx-auto w-full max-w-md px-5 py-10 sm:py-20">
        <div className="rounded-card border border-line bg-card px-5 py-7 sm:p-10">
          <h1 className="text-2xl">{title}</h1>
          {subtitle && <p className="mt-2 leading-relaxed text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </div>
    </div>
  );
}
