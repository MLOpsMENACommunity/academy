import type { MeResponse } from '@academy/shared';
import type { Translate } from '@/i18n/translator';

/**
 * The account menu's links (header dropdown and mobile menu). A speaker's home is the speaker
 * portal; once they applied to or enrolled in a course they also get "My learning" (the
 * student dashboard: speakers study too).
 */
export function accountLinks(user: MeResponse, locale: string, t: Translate): [string, string][] {
  const home: [string, string][] =
    user.role === 'SPEAKER'
      ? [
          [`/${locale}/speaker`, t('speakers.portal.nav')],
          ...(user.learning
            ? ([[`/${locale}/dashboard`, t('nav.myLearning')]] as [string, string][])
            : []),
        ]
      : [[`/${locale}/dashboard`, t('nav.dashboard')]];
  return [
    ...home,
    [`/${locale}/profile`, t('nav.profile')],
    ...(user.role === 'ADMIN'
      ? ([[`/${locale}/admin`, t('nav.admin')]] as [string, string][])
      : []),
  ];
}
