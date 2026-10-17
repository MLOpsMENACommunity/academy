import { landingPath, type MeResponse } from '@academy/shared';
import { withReturnTo } from './use-return-to';

const APPLYING = /\/courses\/[^/]+\/apply(?:$|[?#])/;

/**
 * Where to go after sign-in. An incomplete profile goes to onboarding first, unless the
 * student was on their way somewhere that doesn't need it (a payment, a lesson): only
 * applying requires the complete profile, and losing their place there costs more.
 *
 * Speakers study too: the page they asked for is kept (applying goes through onboarding
 * first, like a student's); asking for nothing (the bare dashboard) lands them on their home,
 * the speaker portal, and a new speaker account never starts with student onboarding.
 */
export function postLoginPath(me: MeResponse, locale: string, returnTo: string, newAccount = false): string {
  const to = landingPath(me.role, returnTo, locale);
  if (me.role === 'ADMIN' || me.profile.coreComplete) return to;
  if (me.role === 'SPEAKER') return APPLYING.test(to) ? withReturnTo(`/${locale}/onboarding`, to) : to;
  const needsProfile = newAccount || to === `/${locale}/dashboard` || APPLYING.test(to);
  return needsProfile ? withReturnTo(`/${locale}/onboarding`, to) : to;
}
