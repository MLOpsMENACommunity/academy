'use client';

import { certificatePath, codeFromScan, normalizeCertificateCode } from '@academy/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { IconKeyboard, IconQr } from '@/components/ui/Icons';
import { useI18n } from '@/i18n/client';

type Mode = 'manual' | 'scan';

/**
 * Type a certificate ID or scan its QR code (the camera, via html5-qrcode, loaded only when
 * scanning). Either way the result is the certificate's own verification page. Accepts academy
 * serials, the codes of certificates issued before the academy, and links from new QR codes.
 */
export function CertificateVerifier() {
  const { locale, t } = useI18n();
  const v = (k: string) => t(`certificates.verifier.${k}`);
  const router = useRouter();
  // ?scan=1: opened again for the camera (see cameraBlocked), so start scanning straight away.
  const reopened = useSearchParams().get('scan') === '1';
  const [mode, setMode] = useState<Mode>(reopened ? 'scan' : 'manual');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const open = (found: string) => {
    setOpening(true);
    router.push(certificatePath(locale, found));
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = normalizeCertificateCode(code);
    if (!found) return setError(v('invalidFormat'));
    setError(null);
    open(found);
  }

  useEffect(() => {
    if (mode !== 'scan') return;
    // The camera is allowed on this page only (Permissions-Policy). Reached from another page
    // without a reload, the document still has the site-wide "no camera" policy: load the page
    // afresh, scanning.
    if (cameraBlocked()) {
      window.location.assign(`/${locale}/verify-certificate?scan=1`);
      return;
    }
    let cancelled = false;
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null;
    void (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        const s = new Html5Qrcode('cert-scanner-region', { verbose: false });
        scanner = s;
        await s.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decoded: string) => {
            const found = codeFromScan(decoded);
            setMode('manual');
            if (found) {
              setCode(found);
              open(found);
            } else {
              setError(v('notCertificateQr'));
            }
          },
          () => {},
        );
      } catch (err) {
        if (cancelled) return;
        const why = `${(err as { name?: string })?.name ?? ''} ${String(err)}`;
        // Browsers without the policy check (Firefox, Safari) just refuse: try once on a fresh page.
        if (!reopened && /NotAllowed|Permission|policy/i.test(why)) {
          window.location.assign(`/${locale}/verify-certificate?scan=1`);
          return;
        }
        setError(/NotFound/.test(why) ? v('cameraMissing') : v('cameraDenied'));
        setMode('manual');
      }
    })();
    return () => {
      cancelled = true;
      const s = scanner;
      if (!s) return;
      // stop() throws (not rejects) when the camera never started, e.g. permission refused.
      try {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      } catch {
        /* not running */
      }
    };
    // open() and v() are stable enough for one scanning session; restart only when the mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const tab = (m: Mode, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => {
        setError(null);
        setMode(m);
      }}
      className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
        mode === m ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label={v('label')} className="flex gap-1 rounded-xl bg-muted-bg p-1">
        {tab('manual', <IconKeyboard />, v('manualTab'))}
        {tab('scan', <IconQr />, v('scanTab'))}
      </div>

      {mode === 'scan' ? (
        <div className="flex flex-col items-center gap-3">
          <div id="cert-scanner-region" className="aspect-square w-full max-w-sm overflow-hidden rounded-xl bg-black" />
          <p className="text-sm text-muted">{v('scanning')}</p>
          <Button variant="secondary" onClick={() => setMode('manual')}>
            {v('scanStop')}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <label htmlFor="cert-code" className="text-sm font-medium text-fg">
            {v('label')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="cert-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(null);
              }}
              placeholder="MLOPS-01-2026-00023"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="characters"
              dir="ltr"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'cert-code-error' : 'cert-code-hint'}
              className="min-h-11 flex-1 rounded-lg border border-line bg-card px-3 font-mono text-[0.9375rem] text-fg uppercase placeholder:normal-case placeholder:text-muted focus:border-primary focus:outline-none"
            />
            <Button type="submit" loading={opening} disabled={!code.trim()}>
              {v('verify')}
            </Button>
          </div>
          <p id="cert-code-hint" className="text-sm text-muted">
            {v('hint')}
          </p>
        </form>
      )}
      <p id="cert-code-error" role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>
    </div>
  );
}

/** True when this document's Permissions-Policy forbids the camera (Chromium exposes it; others don't, and then we just try). */
function cameraBlocked(): boolean {
  const d = document as Document & {
    permissionsPolicy?: { allowsFeature: (f: string) => boolean };
    featurePolicy?: { allowsFeature: (f: string) => boolean };
  };
  const policy = d.permissionsPolicy ?? d.featurePolicy;
  return policy ? !policy.allowsFeature('camera') : false;
}
