import type { CardBar, CardTone } from '@/components/catalog/CatalogCard';
import type { Accent } from '@/lib/roadmaps';

/**
 * The website gives each roadmap an accent (cyan, amber, violet). The academy has
 * no violet: its colours are the logo's soft tints, so each accent maps to the
 * closest one (violet → green, the remaining logo tint). Text uses the AA-safe ink
 * for that tint; the bars, dots and blockquote rule use the logo colour itself.
 */
export const accentStyle: Record<Accent, { bar: CardBar; tone: CardTone; dot: string; soft: string; text: string; rule: string }> = {
  cyan: { bar: 'cyan', tone: 'info', dot: 'bg-logo-cyan', soft: 'bg-logo-cyan-soft', text: 'text-info', rule: '[--roadmap-rule:var(--logo-cyan)]' },
  amber: { bar: 'amber', tone: 'accent', dot: 'bg-logo-amber', soft: 'bg-logo-amber-soft', text: 'text-accent', rule: '[--roadmap-rule:var(--logo-amber)]' },
  violet: { bar: 'green', tone: 'success', dot: 'bg-logo-green', soft: 'bg-logo-green-soft', text: 'text-success', rule: '[--roadmap-rule:var(--logo-green)]' },
};
