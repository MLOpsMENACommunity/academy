import type { Locale } from '@academy/shared';
import { createTranslator } from '@/i18n/translator';
import type { ResolvedStep, StepStatus } from '@/lib/paths';
import { StepMarker, StepStatusText } from './PathProgress';

export const statusText: Record<StepStatus, string> = {
  open: 'text-success',
  upcoming: 'text-accent',
  completed: 'text-muted',
  closed: 'text-muted',
  recording: 'text-info',
};

/**
 * A path's steps as a horizontal stepper (md and up) or a vertical one (phones):
 * circle, connector, "Step N · status", title. The student's own state (done, in
 * progress) is filled in by the client pieces from PathProgress.
 */
export function Stepper({ steps, locale, size = 'md', linked = true }: { steps: ResolvedStep[]; locale: Locale; size?: 'sm' | 'md'; linked?: boolean }) {
  const t = createTranslator(locale);
  // Long paths keep a readable column per step and scroll sideways (md and up) instead of squeezing.
  const long = steps.length > 6;
  return (
    // A sideways-scrolling region must be reachable by keyboard so it can be scrolled (WCAG 2.1.1).
    <div
      className={long ? 'rounded-md md:overflow-x-auto md:pb-2 focus-visible:outline-2 focus-visible:outline-offset-2' : undefined}
      {...(long ? { tabIndex: 0, role: 'region', 'aria-label': t('paths.stepsRegion') } : {})}
    >
    <ol
      className="flex flex-col gap-0 md:grid md:gap-0"
      style={{ gridTemplateColumns: long ? `repeat(${steps.length}, 9.5rem)` : `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={`${s.kind}:${s.slug}`} className="relative flex gap-4 pb-6 md:flex-col md:gap-3 md:pb-0">
            <div className="flex flex-col items-center md:flex-row">
              <StepMarker kind={s.kind} slug={s.slug} n={i + 1} size={size} />
              {!last && <span aria-hidden className="w-0.5 flex-1 bg-line md:h-0.5 md:w-auto md:flex-1" />}
            </div>
            <div className="flex min-w-0 flex-col gap-1 pt-1 md:pe-4 md:pt-0">
              <span className={`text-[0.8125rem] ${statusText[s.status]}`}>
                {t('paths.stepN', { n: i + 1 })} ·{' '}
                <StepStatusText kind={s.kind} slug={s.slug}>
                  {t(`paths.status.${s.status}`)}
                </StepStatusText>
              </span>
              {linked ? (
                <a href={`#step-${i + 1}`} className={`font-medium text-fg hover:text-primary hover:underline ${size === 'sm' ? 'text-sm' : ''}`}>
                  {s.title}
                </a>
              ) : (
                <span className={`font-medium text-fg ${size === 'sm' ? 'text-sm' : ''}`}>{s.title}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
    </div>
  );
}
