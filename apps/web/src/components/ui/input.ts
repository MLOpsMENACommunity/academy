/**
 * Text inputs, selects and textareas. A plain module (not 'use client') so server
 * components can use it too. 16px text keeps iOS from zooming on focus.
 */
export const inputClass =
  'block w-full min-h-12 rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-base text-fg placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary aria-[invalid=true]:border-danger disabled:bg-muted-bg';
