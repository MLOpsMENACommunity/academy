import type { ComponentProps } from 'react';

export function Container({ className = '', ...props }: ComponentProps<'div'>) {
  return <div className={`mx-auto w-full max-w-[70rem] px-5 sm:px-6 ${className}`} {...props} />;
}
