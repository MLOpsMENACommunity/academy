import type { ComponentProps } from 'react';

export function Card({ className = '', ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={`rounded-card border border-line bg-card p-5 shadow-[0_1px_2px_rgba(15,33,64,0.05)] sm:p-6 ${className}`}
      {...props}
    />
  );
}
