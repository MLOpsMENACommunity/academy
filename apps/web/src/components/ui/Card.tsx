import type { ComponentProps } from 'react';

export function Card({ className = '', ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={`rounded-card border border-line bg-card p-5 sm:p-7 ${className}`}
      {...props}
    />
  );
}
