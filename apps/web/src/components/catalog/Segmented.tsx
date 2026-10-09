'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { segmentItem, segmentTrack } from './segment';

/**
 * Tabs (WAI-ARIA tabs pattern) with the segmented look: Left/Right/Home/End move
 * between tabs and select them, Tab moves into the panel. Panels are rendered on
 * the server and only shown/hidden here.
 */
export function SegmentedTabs({
  label,
  tabs,
  className = '',
  headerStart,
}: {
  label: string;
  tabs: { id: string; label: ReactNode; panel: ReactNode }[];
  className?: string;
  /** Rendered before the tab list (e.g. the section heading), on the same row on wide screens. */
  headerStart?: ReactNode;
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const rtl = document.documentElement.dir === 'rtl';
    const next =
      e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? i + 1 : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const j = (next + tabs.length) % tabs.length;
    setActive(tabs[j]!.id);
    refs.current[j]?.focus();
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        {headerStart}
        <div role="tablist" aria-label={label} className={segmentTrack}>
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={active === tab.id}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={active === tab.id ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={segmentItem}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={active !== tab.id}
          tabIndex={0}
          className="mt-8 focus-visible:outline-offset-8"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
