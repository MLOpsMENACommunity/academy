import type { CourseDetailDto } from '@academy/shared';
import { ImageResponse } from 'next/og';
import { serverGetOr } from '@/lib/server-api';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'MLOps MENA Academy course';
export const revalidate = 3600;

/**
 * Per-course social card. Rendered with the English title in both locales:
 * the OG renderer does not shape Arabic script correctly, and a broken Arabic
 * title looks worse than a clean English one.
 */
export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = /^[a-z0-9-]{1,80}$/.test(slug)
    ? await serverGetOr<CourseDetailDto | null>(`/courses/${slug}`, null, 3600)
    : null;
  const title = c?.titleEn ?? 'MLOps MENA Academy';
  const meta = c
    ? [c.type === 'FREE' ? 'Free' : `${c.price} ${c.currency}`, c.durationWeeks ? `${c.durationWeeks} weeks` : null, 'Live cohort']
        .filter(Boolean)
        .join('  ·  ')
    : 'Live ML, MLOps & AI engineering courses';
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#13233f', color: 'white', padding: 72 }}>
        <div style={{ display: 'flex', fontSize: 30, color: '#9fdde6', fontWeight: 600 }}>MLOps MENA Academy</div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', fontSize: title.length > 40 ? 64 : 80, fontWeight: 700, lineHeight: 1.1 }}>
          {title}
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#c6cfdc' }}>{meta}</div>
        {/* The logo's four colours as flat segments. */}
        <div style={{ display: 'flex', marginTop: 32, height: 8, width: '100%', gap: 8 }}>
          {['#16c6d8', '#72b97b', '#e5a13a', '#ff9912'].map((color) => (
            <div key={color} style={{ display: 'flex', flex: 1, background: color, borderRadius: 4 }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
