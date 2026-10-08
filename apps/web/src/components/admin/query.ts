'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

/** Filter state lives in the URL, so views can be bookmarked, shared and saved. */
export function useQueryState(): {
  params: Record<string, string>;
  query: string;
  set: (next: Record<string, string | string[] | undefined | null>, resetPage?: boolean) => void;
  replaceAll: (query: string) => void;
} {
  const router = useRouter();
  const search = useSearchParams();
  const params = useMemo(() => Object.fromEntries(search.entries()), [search]);
  const query = search.toString();
  const set = useCallback(
    (next: Record<string, string | string[] | undefined | null>, resetPage = true) => {
      const p = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(next)) {
        const value = Array.isArray(v) ? v.join(',') : v;
        if (value === undefined || value === null || value === '') p.delete(k);
        else p.set(k, value);
      }
      if (resetPage && !('page' in next)) p.delete('page');
      router.replace(`?${p.toString()}`, { scroll: false });
    },
    [router, search],
  );
  const replaceAll = useCallback((q: string) => router.replace(`?${q}`, { scroll: false }), [router]);
  return { params, query, set, replaceAll };
}

export const listParam = (v: string | undefined): string[] => (v ? v.split(',').filter(Boolean) : []);
