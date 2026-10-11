import {
  courseLanguageLabels,
  detailLevelLabels,
  detailsEmpty,
  episodeFormatLabels,
  type Locale,
  type SpeakerDetailsDto,
  type SpeakerKind,
} from '@academy/shared';
import type { ReactNode } from 'react';
import type { Translate } from '@/i18n/translator';

/**
 * The filled-in details of a session, course or podcast, read-only: for the public session
 * page, the speaker's dashboard and the admin views. Only what is filled shows; nothing at
 * all when nothing is. No hooks, so server and client components can both use it.
 */
export function DetailsView({
  kind,
  details: d,
  locale,
  t,
  headingLevel = 3,
}: {
  kind: SpeakerKind;
  details: SpeakerDetailsDto | null | undefined;
  locale: Locale;
  t: Translate;
  headingLevel?: 2 | 3;
}) {
  if (!d || detailsEmpty(d)) return null;
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const k = (key: string, vars?: Record<string, string | number>) => t(`speakers.details.${key}`, vars);
  const section = (title: string, body: ReactNode) => (
    <section className="space-y-2">
      <H className={headingLevel === 2 ? 'text-xl' : 'text-base font-semibold text-fg'}>{title}</H>
      {body}
    </section>
  );
  const list = (items: string[]) => (
    <ul className="list-disc space-y-1 ps-5">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
  const facts: [string, string][] = [];
  if (d.level) facts.push([k('level'), detailLevelLabels[d.level][locale]]);
  if (d.language) facts.push([k('language'), courseLanguageLabels[d.language][locale]]);
  const c = kind === 'COURSE' ? d.course : undefined;
  if (c?.modulesCount) facts.push([k('course.modulesCount'), String(c.modulesCount)]);
  if (c?.durationWeeks) facts.push([k('course.durationWeeks'), String(c.durationWeeks)]);
  if (c?.weeklyHours) facts.push([k('course.weeklyHours'), String(c.weeklyHours)]);
  const p = kind === 'PODCAST' ? d.podcast : undefined;
  if (p?.episodeFormat) facts.push([k('podcast.episodeFormat'), episodeFormatLabels[p.episodeFormat][locale]]);
  if (p?.host) facts.push([k('podcast.host'), p.host]);

  return (
    <div className="space-y-5">
      {facts.length > 0 && (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="font-medium text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.audience && section(k('audience'), <p className="whitespace-pre-line">{d.audience}</p>)}
      {d.prerequisites && section(k('prerequisites'), <p className="whitespace-pre-line">{d.prerequisites}</p>)}
      {d.outcomes?.length ? section(k('outcomes'), list(d.outcomes)) : null}
      {c?.modules?.length
        ? section(
            k('course.modules'),
            <ol className="list-decimal space-y-2 ps-5">
              {c.modules.map((m, i) => (
                <li key={i}>
                  <span className="font-medium text-fg">{m.title}</span>
                  {m.description && <p className="text-sm text-muted">{m.description}</p>}
                </li>
              ))}
            </ol>,
          )
        : null}
      {c?.materialsUrl &&
        section(
          k('course.materialsUrl'),
          <a href={c.materialsUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline ltr-embed">
            {c.materialsUrl.replace(/^https:\/\//, '')}
          </a>,
        )}
      {p?.guests?.length
        ? section(
            k('podcast.guests'),
            <ul className="space-y-1">
              {p.guests.map((g) => (
                <li key={g.name}>
                  {g.linkedinUrl ? (
                    <a href={g.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                      {g.name}
                    </a>
                  ) : (
                    g.name
                  )}
                </li>
              ))}
            </ul>,
          )
        : null}
      {p?.discussion?.length ? section(k('podcast.discussion'), list(p.discussion)) : null}
      {d.tags?.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={k('tags')}>
          {d.tags.map((tag) => (
            <li key={tag} className="rounded-full bg-primary-soft px-3 py-1 text-sm text-primary">
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
