'use client';

import { formatVideoTime } from '@academy/shared';
import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import type { TranslateVars } from '@/i18n/translator';

const SLOT = '\u0000';

/**
 * A translated sentence with a video time in it ("You stopped at 42:10"): the time is m:ss or
 * h:mm:ss in Latin digits, like every time on the site, kept left-to-right inside Arabic text.
 */
export function TextWithTime({ k, sec, vars = {} }: { k: string; sec: number; vars?: TranslateVars }): ReactNode {
  const { t } = useI18n();
  return t(k, { ...vars, time: SLOT })
    .split(SLOT)
    .flatMap((part, i) =>
      i === 0
        ? [part]
        : [
            <bdi key={i} dir="ltr" className="tabular-nums">
              {formatVideoTime(sec)}
            </bdi>,
            part,
          ],
    );
}
