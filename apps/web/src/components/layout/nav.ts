/**
 * Primary navigation, shared by the desktop header, the mobile menu and the
 * footer. Add a section here (path under /{locale}, message key) and it shows
 * up in all three.
 */
export interface NavItem {
  /** Path after the locale prefix, e.g. '/courses'. */
  path: string;
  /** i18n message key for the label. */
  label: string;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { path: '/courses', label: 'nav.courses' },
  { path: '/sessions', label: 'nav.sessions' },
];

/** True when `pathname` is the item's page or one of its sub-pages. */
export function isActive(pathname: string, locale: string, path: string): boolean {
  const href = `/${locale}${path}`;
  return pathname === href || pathname.startsWith(`${href}/`);
}
