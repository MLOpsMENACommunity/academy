import { ImageResponse } from 'next/og';
import { lookupCertificate } from './data';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'MLOps MENA Academy certificate';
export const dynamic = 'force-dynamic';

const ARABIC = /[؀-ۿ]/;

/**
 * The social card for a shared certificate. English only (the OG renderer doesn't shape
 * Arabic), so an Arabic-only name falls back to a generic line. Revoked or unavailable
 * certificates get the generic card.
 */
export default async function OgImage({ params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const r = await lookupCertificate(serial).catch(() => null);
  const cert = r?.kind === 'found' && r.cert.status === 'VALID' ? r.cert : null;
  const name = cert && !ARABIC.test(cert.name) ? cert.name : null;
  const course = cert && !ARABIC.test(cert.courseTitleEn) ? cert.courseTitleEn : null;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#13233f', color: 'white', padding: 72 }}>
        <div style={{ display: 'flex', fontSize: 30, color: '#9fdde6', fontWeight: 600 }}>MLOps MENA Academy · Certificate of completion</div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
          <div style={{ display: 'flex', fontSize: name && name.length > 28 ? 64 : 80, fontWeight: 700, lineHeight: 1.1 }}>{name ?? 'Verified certificate'}</div>
          {course && <div style={{ display: 'flex', marginTop: 20, fontSize: 40, color: '#c6cfdc' }}>{course}</div>}
        </div>
        <div style={{ display: 'flex', fontSize: 28, color: '#c6cfdc' }}>{cert ? `Verified · ${cert.serial}` : 'academy.mlopsmena.com'}</div>
        <div style={{ display: 'flex', marginTop: 32, height: 8, width: '100%', gap: 8 }}>
          {['#16c6d8', '#72b97b', '#e5a13a', '#ff9912'].map((color) => (
            <div key={color} style={{ display: 'flex', flex: 1, background: color, borderRadius: 4 }} />
          ))}
        </div>
      </div>
    ),
    // Not Next's default (a year, immutable): a revoked or deleted certificate's card must not linger.
    { ...size, headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
