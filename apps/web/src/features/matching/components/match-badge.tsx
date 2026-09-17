import type { MatchBand } from '@jobtrack/shared';
import { cn } from '@/lib/utils';
import { bandTone, formatScore } from '../lib/format';

interface MatchBadgeProps {
  score: number | null;
  band: MatchBand | null;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Pastille compacte de score (spec §2/§7) : chiffre suivi de « Match », teinte
 * sémantique par bande (`bandTone`). `role="img"` + `aria-label` : le lecteur
 * d'écran annonce la phrase complète (« Correspondance 92 sur 100 ») plutôt
 * que d'épeler le contenu visuel (« 92 », « Match ») séparément.
 */
export function MatchBadge({ score, band, size = 'md', className }: MatchBadgeProps) {
  const tone = bandTone(band);
  const label = score === null ? 'Correspondance non évaluée' : `Correspondance ${score} sur 100`;

  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'inline-flex items-baseline gap-1 rounded-full border px-2 py-0.5 leading-none',
        tone.bg,
        tone.border,
        tone.text,
        className,
      )}
    >
      <span className={cn('font-semibold', size === 'sm' ? 'text-sm' : 'text-base')}>{formatScore(score)}</span>
      <span className="text-[0.625rem] font-medium tracking-wide uppercase opacity-80">Match</span>
    </span>
  );
}
