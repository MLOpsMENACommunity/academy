'use client';

import type { EarlierCertificatesImportResultDto } from '@academy/shared';
import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/**
 * Admin → Certificates: certificates are issued per course (the course's Certificates tab); this
 * page imports the ones issued before the academy so their codes keep verifying here.
 */
export default function AdminCertificates() {
  const { locale, t } = useI18n();
  const a = (k: string, v?: Record<string, string | number>) => t(`admin.earlierCertificates.${k}`, v);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<EarlierCertificatesImportResultDto | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    // Reset so choosing the same file again (after editing it) fires onChange.
    e.target.value = '';
    setPreview(null);
    setDone(null);
    setError(null);
    setCsv('');
    setFileName(null);
    if (!f) return;
    if (f.size > 2_000_000) return setError(a('fileTooLarge'));
    setFileName(f.name);
    setCsv(await f.text());
  }

  async function send(dryRun: boolean) {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const r = await api<EarlierCertificatesImportResultDto>('/admin/certificates/earlier/import', { method: 'POST', json: { csv, dryRun } });
      if (dryRun) setPreview(r);
      else {
        setPreview(null);
        setCsv('');
        setFileName(null);
        setDone(a('imported', { created: r.created, updated: r.updated, linked: r.linked, total: r.total }));
      }
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">{a('pageTitle')}</h1>
        <p className="mt-1 max-w-3xl text-muted">{a('pageIntro')}</p>
        <p className="mt-2 text-sm">
          <Link href={`/${locale}/verify-certificate`} className="font-medium text-primary hover:underline">
            {a('verifyLink')}
          </Link>
        </p>
      </div>
      <Card>
        <h2 className="text-lg">{a('importTitle')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{a('importHint')}</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-muted-bg p-3 text-xs" dir="ltr">
          {'code,holder_name,course,issued_on,status,email\nMLOPS-01-2026-00023,Student Name,The MLOps Practitioner Course,2026/11/02,valid,student@example.com'}
        </pre>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line-button bg-card px-4 text-sm font-medium hover:bg-hover-bg">
            {a('chooseFile')}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e)} />
          </label>
          {fileName && <span className="text-sm text-muted ltr-embed">{fileName}</span>}
          <Button variant="secondary" size="sm" disabled={!csv} loading={busy && !preview} onClick={() => void send(true)}>
            {a('check')}
          </Button>
        </div>
        {error && (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        )}
        {done && (
          <Alert tone="success" className="mt-4">
            {done}
          </Alert>
        )}
        {preview && (
          <div className="mt-4 flex flex-col gap-3">
            {preview.errors.length ? (
              <>
                <Alert tone="danger">{a('hasErrors', { count: preview.errors.length })}</Alert>
                <ul className="max-h-80 overflow-auto rounded-xl border border-line text-sm">
                  {preview.errors.map((e) => (
                    <li key={`${e.line}-${e.message}`} className="border-b border-line-soft px-3 py-2 last:border-0">
                      {a('line', { line: e.line })}: {e.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p role="status" className="text-sm">
                  {a('summary', { rows: preview.rows, created: preview.created, updated: preview.updated, unchanged: preview.unchanged, linked: preview.linked })}
                </p>
                <div>
                  <Button loading={busy} disabled={!preview.created && !preview.updated} onClick={() => void send(false)}>
                    {a('save')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
