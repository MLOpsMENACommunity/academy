import { ImageResponse } from 'next/og';
import { DEFAULT_OG_IMAGE } from '@/lib/seo';

// Rendered once at build time: the site-wide social card (1200×630) for pages without their own.
export const dynamic = 'force-static';

/**
 * Same look as the per-course card (courses/[slug]/opengraph-image.tsx). English only:
 * the OG renderer does not shape Arabic script correctly.
 */
export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#13233f', color: 'white', padding: 72 }}>
        <div style={{ display: 'flex', fontSize: 30, color: '#9fdde6', fontWeight: 600 }}>MLOps MENA Community</div>
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', fontSize: 88, fontWeight: 700, lineHeight: 1.1 }}>MLOps MENA Academy</div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 38, color: '#c6cfdc', lineHeight: 1.3 }}>
            Live, cohort-based ML, MLOps and AI engineering courses for engineers across the Middle East and North Africa
          </div>
        </div>
        {/* The logo's four colours as flat segments. */}
        <div style={{ display: 'flex', marginTop: 32, height: 8, width: '100%', gap: 8 }}>
          {['#16c6d8', '#72b97b', '#e5a13a', '#ff9912'].map((color) => (
            <div key={color} style={{ display: 'flex', flex: 1, background: color, borderRadius: 4 }} />
          ))}
        </div>
      </div>
    ),
    {
      width: DEFAULT_OG_IMAGE.width,
      height: DEFAULT_OG_IMAGE.height,
      headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' },
    },
  );
}
