import { homePath, isStudentOnlyPath, type MeResponse } from '@academy/shared';
import { withReturnTo } from './use-return-to';

/**
 * Where to go after sign-in. An incomplete profile goes to onboarding first, unless the
 * student was on their way somewhere that doesn't need it (a payment, a lesson): only
 * applying requires the complete profile, and losing their place there costs more.
 */
export function postLoginPath(me: MeResponse, locale: string, returnTo: string, newAccount = false): string {
  // Speakers skip student onboarding: their home is the speaker portal.
  if (me.role === 'SPEAKER') return isStudentOnlyPath(returnTo, locale) ? homePath('SPEAKER', locale) : returnTo;
  if (me.role === 'ADMIN' || me.profile.coreComplete) return returnTo;
  const needsProfile =
    newAccount || returnTo === `/${locale}/dashboard` || /\/courses\/[^/]+\/apply(?:$|[?#])/.test(returnTo);
  return needsProfile ? withReturnTo(`/${locale}/onboarding`, returnTo) : returnTo;
}
