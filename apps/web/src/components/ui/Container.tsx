import type { ComponentProps } from 'react';

export function Container({ className = '', ...props }: ComponentProps<'div'>) {
  return <div className={`mx-auto w-full max-w-[75rem] px-5 sm:px-6 lg:px-10 ${className}`} {...props} />;
}
