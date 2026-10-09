// Plain module (not 'use client'): server components use these class names too.
/** Segmented control look shared by tabs and view switches: white track, dark selected segment. */
export const segmentTrack = 'flex max-w-full gap-1 overflow-x-auto rounded-[10px] border border-line bg-card p-1 text-[0.9375rem]';
export const segmentItem =
  'inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-4 text-body transition-colors aria-selected:bg-fg aria-selected:text-white aria-[current=page]:bg-fg aria-[current=page]:text-white';

