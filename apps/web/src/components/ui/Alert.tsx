import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger';
const tones: Record<Tone, string> = {
  info: 'border-info/15 bg-info-soft text-info',
  success: 'border-success/15 bg-success-soft text-success',
  warning: 'border-warning/15 bg-warning-soft text-warning',
  danger: 'border-danger/20 bg-danger-soft text-danger',
};

export function Alert({
  tone = 'info',
  title,
  children,
  className = '',
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-xl border p-4 text-[0.9375rem] leading-relaxed ${tones[tone]} ${className}`}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}
