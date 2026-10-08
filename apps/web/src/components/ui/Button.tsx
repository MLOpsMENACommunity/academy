import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 select-none';
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-soft',
  // The one main call to action on a page: the logo's orange with ink text.
  accent: 'bg-cta text-cta-text font-semibold hover:bg-cta-hover',
  secondary: 'border border-line-strong/60 bg-card text-fg hover:border-line-strong hover:bg-muted-bg',
  ghost: 'text-fg hover:bg-muted-bg',
  danger: 'bg-danger text-white hover:opacity-90',
};
// Every size keeps a 44px tap target on touch screens.
const sizes: Record<Size, string> = {
  sm: 'min-h-11 px-4 text-sm sm:min-h-10',
  md: 'min-h-11 px-5 text-[0.9375rem]',
  lg: 'min-h-12 px-6 text-base',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = ''): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  loading,
  disabled,
  children,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...props}
      className={buttonClass(variant, size, className)}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
    >
      {loading && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent"
        />
      )}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'className'> & {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
