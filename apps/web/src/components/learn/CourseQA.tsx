'use client';

import {
  answerSchema,
  askQuestionSchema,
  QA_BODY_MAX,
  QA_FILTERS,
  QA_SEARCH_MAX,
  QA_TITLE_MAX,
  type AnswerDto,
  type QaAuthorDto,
  type QaFilter,
  type QaListDto,
  type QuestionDetailDto,
  type QuestionSummaryDto,
} from '@academy/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Markdown } from '@/components/course/Markdown';
import { SelectField, TextAreaField, TextField } from '@/components/forms/fields';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import type { Translate } from '@/i18n/translator';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, viewerTimezone } from '@/lib/format';
import { useSearchParam } from '@/lib/use-search-param';

export interface QaSession {
  id: string;
  order: number;
  titleEn: string;
  titleAr: string;
}

/** The thread to open from the address (?q=<id>), and keeping it there so links and Back work. */
function questionFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('q');
  return id && /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : null;
}
function setQuestionInUrl(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('q', id);
  else url.searchParams.delete('q');
  window.history.replaceState(window.history.state, '', url.toString());
}

function qaError(err: unknown, t: Translate): string {
  if (err instanceof ApiError && err.code) {
    const key = `qa.errors.${err.code}`;
    const msg = t(key);
    if (msg !== key) return msg;
  }
  return errorMessage(err, t);
}

/**
 * Course Q&A: the learn page's Q&A tab (students) and the Teaching area's Q&A tab (staff with
 * "Answer questions", who see the moderation buttons and start on Unanswered). The API is the
 * gate; `canModerate` only shows the buttons.
 */
export function CourseQA({
  slug,
  sessions,
  currentSessionId = null,
  mode = 'learn',
  headingId = 'qa',
}: {
  slug: string;
  sessions: QaSession[];
  /** The lesson or session open on the learn page: "This lesson" and the new question's default. */
  currentSessionId?: string | null;
  mode?: 'learn' | 'teach';
  headingId?: string;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<QaFilter>(mode === 'teach' ? 'unanswered' : 'all');
  const [thisLesson, setThisLesson] = useState(false);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<QaListDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => questionFromUrl());
  const [asking, setAsking] = useState(false);
  const base = `/learn/${slug}/qa`;
  const listHeading = useRef<HTMLHeadingElement>(null);
  const sessionId = thisLesson && currentSessionId ? currentSessionId : null;

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ filter, page: String(page) });
    if (sessionId) qs.set('sessionId', sessionId);
    if (applied) qs.set('q', applied);
    try {
      setData(await api<QaListDto>(`${base}?${qs.toString()}`));
      setError(null);
    } catch (err) {
      setError(qaError(err, t));
    }
  }, [base, filter, page, sessionId, applied, t]);
  useEffect(() => {
    void load();
  }, [load]);

  // A notification link to another question (?q=…#qa) while the page is already open, and Back.
  const fromUrl = useSearchParam('q');
  useEffect(() => {
    if (fromUrl && /^[A-Za-z0-9_-]{1,40}$/.test(fromUrl)) setOpenId(fromUrl);
  }, [fromUrl]);

  const open = (id: string | null) => {
    setOpenId(id);
    setQuestionInUrl(id);
    if (!id) {
      void load();
      requestAnimationFrame(() => listHeading.current?.focus());
    }
  };

  const chips: { key: string; label: string; active: boolean; onClick: () => void }[] = [
    ...QA_FILTERS.map((f) => ({
      key: f,
      label: t(`qa.filters.${f}`),
      active: filter === f,
      onClick: () => {
        setFilter(f);
        setPage(1);
      },
    })),
    ...(currentSessionId
      ? [
          {
            key: 'lesson',
            label: t('qa.filters.lesson'),
            active: thisLesson,
            onClick: () => {
              setThisLesson((v) => !v);
              setPage(1);
            },
          },
        ]
      : []),
  ];

  if (openId) {
    return <Thread slug={slug} id={openId} sessions={sessions} onBack={() => open(null)} />;
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} ref={listHeading} tabIndex={-1} className="text-xl">
            {t('qa.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t(mode === 'teach' ? 'qa.introTeach' : 'qa.intro')}</p>
        </div>
        {!asking && (
          <Button size="sm" onClick={() => setAsking(true)}>
            {t('qa.ask')}
          </Button>
        )}
      </div>

      {asking && (
        <AskForm
          slug={slug}
          sessions={sessions}
          defaultSessionId={currentSessionId}
          onCancel={() => setAsking(false)}
          onAsked={(q) => {
            setAsking(false);
            open(q.id);
          }}
        />
      )}

      <div role="group" aria-label={t('qa.filterLabel')} className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={c.active}
            onClick={c.onClick}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium sm:min-h-10 ${c.active ? 'border-primary bg-primary-soft text-primary' : 'border-line-button bg-card text-fg hover:bg-hover-bg'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <form
        role="search"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
          setPage(1);
        }}
      >
        <TextField
          label={t('qa.search')}
          type="search"
          value={search}
          onChange={setSearch}
          maxLength={QA_SEARCH_MAX}
          className="min-w-0 flex-[1_1_14rem]"
        />
        <Button type="submit" variant="secondary" size="sm">
          {t('qa.searchButton')}
        </Button>
      </form>

      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <p className="text-muted">{t('admin.common.loading')}</p>}
      {data && (
        <>
          <p role="status" className="text-sm text-muted">
            {t('qa.count', { count: data.total })}
          </p>
          {data.items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-5 text-muted">{t(filter === 'all' && !applied && !sessionId ? 'qa.empty' : 'qa.emptyFiltered')}</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
              {data.items.map((q) => (
                <li key={q.id}>
                  <QuestionRow q={q} sessions={sessions} onOpen={() => open(q.id)} />
                </li>
              ))}
            </ul>
          )}
          {pages > 1 && (
            <nav aria-label={t('qa.pages')} className="flex items-center justify-between gap-3">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('qa.prev')}
              </Button>
              <span className="text-sm text-muted">{t('qa.page', { page, pages })}</span>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t('qa.next')}
              </Button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function sessionLabel(s: { order: number; titleEn: string; titleAr: string }, locale: string): string {
  return `${s.order}. ${locale === 'ar' ? s.titleAr || s.titleEn : s.titleEn}`;
}

function AuthorLine({ author, at }: { author: QaAuthorDto; at: string }) {
  const { locale, t } = useI18n();
  const name = author.name ?? (author.isStaff ? t('qa.courseTeam') : t('qa.formerStudent'));
  const role = author.isStaff ? (locale === 'ar' ? author.roleLabelAr : author.roleLabel) || t('qa.courseTeam') : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted">
      <span className="font-medium text-fg">{name}</span>
      {author.isYou && <span>({t('qa.you')})</span>}
      {role && role !== name && <Badge tone="primary">{role}</Badge>}
      <span>· {formatDateTime(at, locale, viewerTimezone())}</span>
    </span>
  );
}

function StatusBadges({ q }: { q: QuestionSummaryDto }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {q.pinned && <Badge tone="accent">{t('qa.pinned')}</Badge>}
      <Badge tone={q.status === 'ANSWERED' ? 'success' : q.status === 'CLOSED' ? 'neutral' : 'warning'}>{t(`qa.status.${q.status}`)}</Badge>
      {q.hasAccepted && <Badge tone="success">{t('qa.acceptedBadge')}</Badge>}
      {q.hidden && <Badge tone="danger">{t('qa.hidden')}</Badge>}
    </span>
  );
}

function QuestionRow({ q, sessions, onOpen }: { q: QuestionSummaryDto; sessions: QaSession[]; onOpen: () => void }) {
  const { locale, t } = useI18n();
  const session = q.session ?? null;
  return (
    <div className="flex flex-col gap-1.5 p-4 hover:bg-hover-bg">
      <StatusBadges q={q} />
      <button type="button" onClick={onOpen} className="text-start text-base font-semibold break-words text-primary hover:underline">
        {q.title}
      </button>
      <AuthorLine author={q.author} at={q.createdAt} />
      <span className="text-[0.8125rem] text-muted">
        {[
          t('qa.answers', { count: q.answerCount }),
          t('qa.votes', { count: q.voteCount }),
          session && sessions.length ? sessionLabel(session, locale) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  );
}

function AskForm({
  slug,
  sessions,
  defaultSessionId,
  onCancel,
  onAsked,
}: {
  slug: string;
  sessions: QaSession[];
  defaultSessionId: string | null;
  onCancel: () => void;
  onAsked: (q: QuestionDetailDto) => void;
}) {
  const { locale, t } = useI18n();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(defaultSessionId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);
  useEffect(() => titleRef.current?.querySelector('input')?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = askQuestionSchema.safeParse({ title, body, sessionId });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= t(`qa.invalid.${String(i.path[0])}`);
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onAsked(await api<QuestionDetailDto>(`/learn/${slug}/qa`, { method: 'POST', json: parsed.data }));
    } catch (err) {
      setError(qaError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl border border-line bg-card p-4 sm:p-5" aria-labelledby="qa-ask-title">
      <h3 id="qa-ask-title" className="text-lg">
        {t('qa.askTitle')}
      </h3>
      <div ref={titleRef}>
        <TextField label={t('qa.questionTitle')} hint={t('qa.questionTitleHint')} value={title} onChange={setTitle} maxLength={QA_TITLE_MAX} error={errors.title} required />
      </div>
      <TextAreaField label={t('qa.details')} hint={t('qa.markdownHint')} value={body} onChange={setBody} maxLength={QA_BODY_MAX} rows={6} error={errors.body} dir="auto" required />
      {sessions.length > 0 && (
        <SelectField
          label={t('qa.lesson')}
          value={sessionId}
          onChange={setSessionId}
          placeholder={t('qa.wholeCourse')}
          options={sessions.map((s) => ({ value: s.id, label: sessionLabel(s, locale) }))}
        />
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>
          {t('qa.post')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('qa.cancel')}
        </Button>
      </div>
    </form>
  );
}

function Thread({ slug, id, sessions, onBack }: { slug: string; id: string; sessions: QaSession[]; onBack: () => void }) {
  const { locale, t } = useI18n();
  const [q, setQ] = useState<QuestionDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const base = `/learn/${slug}/qa/${id}`;

  useEffect(() => {
    let live = true;
    setQ(null);
    api<QuestionDetailDto>(base)
      .then((d) => {
        if (!live) return;
        setQ(d);
        requestAnimationFrame(() => heading.current?.focus());
      })
      .catch((err: unknown) => live && setError(err instanceof ApiError && err.status === 404 ? t('qa.notFound') : qaError(err, t)));
    return () => {
      live = false;
    };
  }, [base, t]);

  /** Runs one action and shows the question as the API returns it. */
  const act = async (key: string, path: string, method: 'PUT' | 'DELETE' | 'POST' | 'PATCH', json?: unknown): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      setQ(await api<QuestionDetailDto>(`${base}${path}`, { method, ...(json !== undefined ? { json } : {}) }));
      return true;
    } catch (err) {
      setError(qaError(err, t));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const back = (
    <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-primary hover:underline">
      <span aria-hidden className="inline-block rtl:rotate-180">
        ←
      </span>
      {t('qa.back')}
    </button>
  );
  if (!q) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {error ? <Alert tone="danger">{error}</Alert> : <p className="text-muted">{t('admin.common.loading')}</p>}
      </div>
    );
  }
  const session = q.session && sessions.length ? q.session : null;

  return (
    <article aria-labelledby="qa-thread-title" className="flex flex-col gap-5">
      {back}
      <header className="flex flex-col gap-2">
        <StatusBadges q={q} />
        <h2 id="qa-thread-title" ref={heading} tabIndex={-1} className="text-xl break-words">
          {q.title}
        </h2>
        <AuthorLine author={q.author} at={q.createdAt} />
        {session && <p className="text-[0.8125rem] text-muted">{t('qa.aboutLesson', { lesson: sessionLabel(session, locale) })}</p>}
        {q.hidden && <Alert tone="warning">{t(q.canModerate ? 'qa.hiddenNoteStaff' : 'qa.hiddenNote')}</Alert>}
      </header>

      {editing ? (
        <EditQuestion
          q={q}
          sessions={sessions}
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            if (await act('edit', '', 'PATCH', v)) setEditing(false);
          }}
          busy={busy === 'edit'}
        />
      ) : (
        <div className="break-words">
          <Markdown untrusted>{q.body}</Markdown>
          {q.edited && <p className="mt-1 text-xs text-muted">{t('qa.edited')}</p>}
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-wrap gap-2">
        {!q.author.isYou && (
          <Button variant="secondary" size="sm" aria-pressed={q.voted} loading={busy === 'vote'} onClick={() => void act('vote', '/vote', q.voted ? 'DELETE' : 'PUT')}>
            {t('qa.sameQuestion', { count: q.voteCount })}
          </Button>
        )}
        <Button variant="secondary" size="sm" aria-pressed={q.following} loading={busy === 'follow'} onClick={() => void act('follow', '/follow', q.following ? 'DELETE' : 'PUT')}>
          {t(q.following ? 'qa.unfollow' : 'qa.follow')}
        </Button>
        {q.editableUntil && !editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {t('qa.edit')}
          </Button>
        )}
      </div>
      {q.following && <p className="-mt-3 text-xs text-muted">{t('qa.followHint')}</p>}

      {q.canModerate && (
        <div role="group" aria-label={t('qa.moderation')} className="flex flex-wrap gap-2 rounded-xl border border-line bg-muted-bg p-3">
          <span className="w-full text-sm font-medium text-muted">{t('qa.moderation')}</span>
          <Button variant="secondary" size="sm" loading={busy === 'pin'} onClick={() => void act('pin', '/pin', 'PUT', { pinned: !q.pinned })}>
            {t(q.pinned ? 'qa.unpin' : 'qa.pin')}
          </Button>
          <Button variant="secondary" size="sm" loading={busy === 'close'} onClick={() => void act('close', '/close', 'PUT', { closed: q.status !== 'CLOSED' })}>
            {t(q.status === 'CLOSED' ? 'qa.reopen' : 'qa.close')}
          </Button>
          <Button variant="secondary" size="sm" loading={busy === 'hide'} onClick={() => void act('hide', '/hide', 'PUT', { hidden: !q.hidden })}>
            {t(q.hidden ? 'qa.unhideQuestion' : 'qa.hideQuestion')}
          </Button>
        </div>
      )}

      <section aria-labelledby="qa-answers" className="flex flex-col gap-3">
        <h3 id="qa-answers" className="text-lg">
          {t('qa.answers', { count: q.answers.length })}
        </h3>
        {q.answers.length === 0 && <p className="text-muted">{t('qa.noAnswers')}</p>}
        <ol className="flex flex-col gap-3">
          {q.answers.map((a) => (
            <li key={a.id}>
              <Answer a={a} q={q} busy={busy} act={act} />
            </li>
          ))}
        </ol>
      </section>

      {q.status === 'CLOSED' ? <Alert tone="info">{t('qa.closedNote')}</Alert> : <AnswerForm onPost={(body) => act('answer', '/answers', 'POST', { body })} busy={busy === 'answer'} />}
    </article>
  );
}

function Answer({
  a,
  q,
  busy,
  act,
}: {
  a: AnswerDto;
  q: QuestionDetailDto;
  busy: string | null;
  act: (key: string, path: string, method: 'PUT' | 'DELETE' | 'POST' | 'PATCH', json?: unknown) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(a.body);
  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-4 ${a.accepted ? 'border-success/40 bg-success-soft/40' : 'border-line bg-card'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <AuthorLine author={a.author} at={a.createdAt} />
        {a.accepted && <Badge tone="success">{t('qa.accepted')}</Badge>}
        {a.hidden && <Badge tone="danger">{t('qa.hidden')}</Badge>}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!answerSchema.safeParse({ body }).success) return;
            if (await act(`edit-${a.id}`, `/answers/${a.id}`, 'PATCH', { body })) setEditing(false);
          }}
        >
          <TextAreaField label={t('qa.yourAnswer')} value={body} onChange={setBody} maxLength={QA_BODY_MAX} rows={5} dir="auto" required />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={busy === `edit-${a.id}`}>
              {t('qa.save')}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>
              {t('qa.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="break-words">
          <Markdown untrusted>{a.body}</Markdown>
          {a.edited && <p className="mt-1 text-xs text-muted">{t('qa.edited')}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {q.canAccept && !a.hidden && (
          <Button variant="secondary" size="sm" loading={busy === `accept-${a.id}`} onClick={() => void act(`accept-${a.id}`, '/accept', 'PUT', { answerId: a.accepted ? null : a.id })}>
            {t(a.accepted ? 'qa.unaccept' : 'qa.accept')}
          </Button>
        )}
        {a.editableUntil && !editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {t('qa.edit')}
          </Button>
        )}
        {q.canModerate && (
          <Button variant="ghost" size="sm" loading={busy === `hide-${a.id}`} onClick={() => void act(`hide-${a.id}`, `/answers/${a.id}/hide`, 'PUT', { hidden: !a.hidden })}>
            {t(a.hidden ? 'qa.unhideAnswer' : 'qa.hideAnswer')}
          </Button>
        )}
      </div>
    </div>
  );
}

function AnswerForm({ onPost, busy }: { onPost: (body: string) => Promise<boolean>; busy: boolean }) {
  const { t } = useI18n();
  const [body, setBody] = useState('');
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4"
      aria-labelledby="qa-answer-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!answerSchema.safeParse({ body }).success) return setInvalid(true);
        setInvalid(false);
        if (await onPost(body)) setBody('');
      }}
    >
      <h3 id="qa-answer-form" className="text-lg">
        {t('qa.answerTitle')}
      </h3>
      <TextAreaField label={t('qa.yourAnswer')} hint={t('qa.markdownHint')} value={body} onChange={setBody} maxLength={QA_BODY_MAX} rows={5} dir="auto" error={invalid ? t('qa.invalid.body') : undefined} required />
      <div>
        <Button type="submit" loading={busy}>
          {t('qa.postAnswer')}
        </Button>
      </div>
    </form>
  );
}

function EditQuestion({
  q,
  sessions,
  onCancel,
  onSave,
  busy,
}: {
  q: QuestionDetailDto;
  sessions: QaSession[];
  onCancel: () => void;
  onSave: (v: { title: string; body: string; sessionId: string | null }) => Promise<void>;
  busy: boolean;
}) {
  const { locale, t } = useI18n();
  const [title, setTitle] = useState(q.title);
  const [body, setBody] = useState(q.body);
  const [sessionId, setSessionId] = useState<string | null>(q.session?.id ?? null);
  const parsed = askQuestionSchema.safeParse({ title, body, sessionId });
  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.success) void onSave(parsed.data);
      }}
    >
      <TextField label={t('qa.questionTitle')} value={title} onChange={setTitle} maxLength={QA_TITLE_MAX} required error={title && !parsed.success && parsed.error.issues.some((i) => i.path[0] === 'title') ? t('qa.invalid.title') : undefined} />
      <TextAreaField label={t('qa.details')} value={body} onChange={setBody} maxLength={QA_BODY_MAX} rows={6} dir="auto" required />
      {sessions.length > 0 && (
        <SelectField
          label={t('qa.lesson')}
          value={sessionId}
          onChange={setSessionId}
          placeholder={t('qa.wholeCourse')}
          options={sessions.map((s) => ({ value: s.id, label: sessionLabel(s, locale) }))}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={!parsed.success}>
          {t('qa.save')}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t('qa.cancel')}
        </Button>
      </div>
    </form>
  );
}
