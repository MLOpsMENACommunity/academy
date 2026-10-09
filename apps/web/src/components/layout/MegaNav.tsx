'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { Arrow, IconArticle, IconCalendar, IconChat, IconChevron, IconCourses, IconExternal, IconMap, IconPath, IconPlay, IconUsers } from '../ui/Icons';
import type { MenuData } from './menu';
import { menuSections, type MenuColumn, type MenuIcon, type MenuLink, type MenuSection, type MenuTint } from './sections';
import { WhatsNewLink } from './WhatsNew';

const icons: Record<MenuIcon, (p: { size?: number }) => ReactNode> = {
  courses: IconCourses,
  path: IconPath,
  map: IconMap,
  play: IconPlay,
  calendar: IconCalendar,
  users: IconUsers,
  chat: IconChat,
  article: IconArticle,
};
/** Tile background + icon colour (AA-safe ink on each tint). */
export const tintClass: Record<MenuTint, string> = {
  cyan: 'bg-logo-cyan-soft text-info',
  green: 'bg-logo-green-soft text-success',
  amber: 'bg-logo-amber-soft text-accent',
  orange: 'bg-logo-orange-soft text-accent',
};
export const descToneClass = { success: 'text-success', accent: 'text-accent', muted: 'text-muted' } as const;

/** One link in a menu: optional icon tile, label, one line under it. */
export function MenuItem({ link, onNavigate, compact }: { link: MenuLink; onNavigate?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const Icon = link.icon ? icons[link.icon] : null;
  const body = (
    <>
      {Icon && link.tint && (
        <span aria-hidden className={`grid shrink-0 place-items-center rounded-lg ${compact ? 'size-8' : 'size-9'} ${tintClass[link.tint]}`}>
          <Icon size={compact ? 16 : 18} />
        </span>
      )}
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-fg">
          {link.label}
          {link.external && <IconExternal className="text-muted" />}
        </span>
        {link.desc && <span className={`block text-sm leading-snug ${descToneClass[link.descTone ?? 'muted']}`}>{link.desc}</span>}
        {link.meta && <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted">{link.meta}</span>}
      </span>
    </>
  );
  const cls = `flex min-h-11 items-start gap-3.5 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-hover-bg ${compact ? 'bg-card' : ''}`;
  return link.external ? (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls} onClick={onNavigate}>
      {body}
      <span className="sr-only"> ({t('common.newTab')})</span>
    </a>
  ) : (
    <Link href={link.href} className={cls} onClick={onNavigate}>
      {body}
    </Link>
  );
}

function Column({ col, onNavigate }: { col: MenuColumn; onNavigate: () => void }) {
  return (
    <div className={`flex flex-col gap-1 p-6 ${col.muted ? 'bg-muted-bg' : ''}`}>
      <h3 className="mb-2 px-3 text-xs font-medium tracking-[0.08em] text-muted uppercase">{col.heading}</h3>
      <ul className="flex flex-col gap-0.5">
        {col.links.map((link) => (
          <li key={link.href + link.label}>
            <MenuItem link={link} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      {col.more && (
        <Link href={col.more.href} onClick={onNavigate} className="mt-2 inline-flex min-h-11 items-center gap-1.5 self-start px-3 font-medium text-primary hover:text-primary-hover hover:underline">
          {col.more.label} <Arrow />
        </Link>
      )}
    </div>
  );
}

/**
 * Desktop navigation (lg and up): Learn, Live and Community open a mega-menu panel
 * under the header (a disclosure: button + region, not an ARIA menu, so links keep
 * their normal behaviour). Escape closes it and returns focus to its button; a click
 * outside, a navigation, or focus leaving the nav also closes it. Left/Right move
 * between the menu buttons.
 */
export function MegaNav({ data }: { data: MenuData }) {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? '';
  const sections = useMemo(() => menuSections(t, locale, data), [t, locale, data]);
  const [open, setOpen] = useState<MenuSection['id'] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const triggers = useRef<Partial<Record<MenuSection['id'], HTMLButtonElement | null>>>({});
  const baseId = useId();

  useEffect(() => setOpen(null), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      triggers.current[open]?.focus();
      setOpen(null);
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const ids = sections.map((s) => s.id);
  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>, id: MenuSection['id']) {
    const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = (e.key === 'ArrowRight' ? 1 : -1) * dir;
      const next = ids[(ids.indexOf(id) + step + ids.length) % ids.length]!;
      triggers.current[next]?.focus();
      if (open) setOpen(next);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(id);
      requestAnimationFrame(() => document.getElementById(`${baseId}-${id}`)?.querySelector<HTMLElement>('a')?.focus());
    }
  }

  const close = () => setOpen(null);

  return (
    <div
      ref={root}
      className="hidden lg:block"
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && !root.current?.contains(next)) setOpen(null);
      }}
    >
      <ul className="flex items-center gap-1 text-[0.9375rem]">
        {sections.map((s) => {
          const expanded = open === s.id;
          return (
            <li key={s.id}>
              <button
                ref={(el) => {
                  triggers.current[s.id] = el;
                }}
                type="button"
                aria-expanded={expanded}
                aria-controls={expanded ? `${baseId}-${s.id}` : undefined}
                onClick={() => setOpen(expanded ? null : s.id)}
                onKeyDown={(e) => onTriggerKey(e, s.id)}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 transition-colors hover:bg-hover-bg hover:text-fg ${
                  expanded ? 'bg-hover-bg text-fg' : 'text-body'
                }`}
              >
                {s.label}
                <IconChevron up={expanded} />
              </button>
            </li>
          );
        })}
        <li>
          <WhatsNewLink className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-body transition-colors hover:bg-hover-bg hover:text-fg aria-[current=page]:text-fg aria-[current=page]:font-medium" />
        </li>
      </ul>

      {/* Only the open panel is in the DOM: closed menus add no hidden links to the page. */}
      {sections
        .filter((s) => s.id === open)
        .map((s) => (
        <div key={s.id} id={`${baseId}-${s.id}`} role="region" aria-label={s.label} className="absolute inset-x-0 top-full z-50 px-6 pt-2">
          <div
            className={`mx-auto grid max-w-[70rem] overflow-hidden rounded-card border border-line bg-card shadow-pop ${
              s.columns.length >= 4
                ? 'grid-cols-4'
                : s.columns.length === 3
                  ? 'grid-cols-[1fr_1fr_1.1fr]'
                  : s.columns.length === 2
                    ? 'grid-cols-[1.4fr_1fr]'
                    : 'grid-cols-1'
            } [&>*+*]:border-s [&>*+*]:border-line-soft`}
          >
            {s.columns.map((col) => (
              <Column key={col.heading} col={col} onNavigate={close} />
            ))}
          </div>
        </div>
      ))}
      {/* Dims the page under an open menu; a click on it closes the menu (pointerdown above). */}
      {open && <div aria-hidden onPointerDown={close} className="absolute inset-x-0 top-full z-40 h-dvh bg-fg/20" />}
    </div>
  );
}
