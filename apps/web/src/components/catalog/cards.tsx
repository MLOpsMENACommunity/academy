import { courseLanguageLabels, deliveryPlatformLabels, type Locale, type PublicEventDto, type PublicSpeakerDto, type RecordingDto } from '@academy/shared';
import Image from 'next/image';
import Link from 'next/link';
import { DayTime } from '@/components/sessions/SessionDate';
import { createTranslator } from '@/i18n/translator';
import { durationLabel, speakerName } from '@/lib/archive';
import { formatDate } from '@/lib/format';
import type { LearningPath, ResolvedStep } from '@/lib/paths';
import { pick } from '@/lib/sessions';
import { CatalogCard } from './CatalogCard';

/** A learning path in a catalog: its steps count and the first few steps. */
export function PathCard({ path, steps, locale, headingLevel = 'h3' }: { path: LearningPath; steps: ResolvedStep[]; locale: Locale; headingLevel?: 'h2' | 'h3' }) {
  const t = createTranslator(locale);
  const sep = locale === 'ar' ? ' ← ' : ' → ';
  return (
    <CatalogCard
      href={`/${locale}/learning-paths/${path.slug}`}
      title={path.title[locale]}
      headingLevel={headingLevel}
      bar="green"
      badge={{ tone: 'success', label: t('paths.stepCount', { count: steps.length }) }}
      description={path.tagline[locale]}
      meta={[steps.map((s) => s.title).join(sep)]}
      cta={t('paths.seePath')}
    />
  );
}

/** An upcoming free live session. */
export function EventCard({ event: e, locale }: { event: PublicEventDto; locale: Locale }) {
  const t = createTranslator(locale);
  const speaker = pick(locale, e.speakerName, e.speakerNameAr);
  return (
    <CatalogCard
      href={`/${locale}/sessions/${e.slug}`}
      title={pick(locale, e.titleEn, e.titleAr)}
      bar="green"
      badge={{ tone: 'success', label: t('home.freeLive') }}
      meta={[
        <DayTime key="when" iso={e.startsAt} />,
        ...(speaker ? [t('sessions.with', { name: speaker })] : []),
        `${courseLanguageLabels[e.language][locale]} · ${deliveryPlatformLabels[e.platform][locale]}`,
      ]}
      cta={e.full ? t('sessions.details') : t('sessions.registerFree')}
    />
  );
}

/** A past session or course lesson with a recording. */
export function RecordingTile({ item: r, locale }: { item: RecordingDto; locale: Locale }) {
  const t = createTranslator(locale);
  const href = `/${locale}${r.path}${r.course ? `#lesson-${r.course.order}` : ''}`;
  return (
    <CatalogCard
      href={href}
      title={pick(locale, r.titleEn, r.titleAr)}
      bar="cyan"
      badge={{
        tone: 'info',
        label: r.course ? t('sessions.lesson', { course: pick(locale, r.course.titleEn, r.course.titleAr), n: r.course.order }) : t('sessions.liveSession'),
      }}
      meta={[
        ...(r.speakers.length ? [r.speakers.map((s) => speakerName(locale, s)).join(locale === 'ar' ? '، ' : ', ')] : []),
        `${formatDate(r.startsAt, locale)} · ${durationLabel(r.durationMin, locale)}`,
      ]}
      cta={t('sessions.recording')}
    />
  );
}

const avatarTints = ['bg-logo-cyan-soft text-info', 'bg-logo-green-soft text-success', 'bg-logo-amber-soft text-accent', 'bg-logo-orange-soft text-accent'] as const;

/** Round photo (or initials on a soft tint), name and title, linking to the speaker page. */
export function SpeakerTile({ speaker: s, locale, index, size = 'md' }: { speaker: PublicSpeakerDto; locale: Locale; index: number; size?: 'md' | 'lg' }) {
  const name = pick(locale, s.name, s.nameAr);
  const title = pick(locale, s.titleEn, s.titleAr);
  const letters = name
    .replace(/^(eng|dr|prof)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  const dim = size === 'lg' ? 'size-20' : 'size-16 sm:size-18';
  return (
    <Link href={`/${locale}/speakers/${s.slug}`} className="group flex min-w-0 flex-col gap-2.5 rounded-xl text-body">
      {s.photoUrl ? (
        // unoptimized: photos are small already, and admins may paste them from any host.
        <Image src={s.photoUrl} alt="" width={80} height={80} unoptimized className={`${dim} shrink-0 rounded-full bg-muted-bg object-cover ring-1 ring-line`} />
      ) : (
        <span aria-hidden className={`grid ${dim} shrink-0 place-items-center rounded-full text-lg font-semibold ${avatarTints[index % avatarTints.length]}`}>
          {letters}
        </span>
      )}
      <span className="font-medium text-fg group-hover:text-primary group-hover:underline">{name}</span>
      {title && <span className="line-clamp-2 text-[0.8125rem] leading-snug text-muted">{title}</span>}
    </Link>
  );
}
