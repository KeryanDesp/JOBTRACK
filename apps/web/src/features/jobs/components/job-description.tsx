import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface JobDescriptionProps {
  description: string;
}

// Au-delà de cette longueur (spec tâche 9), la description complète est repliée
// derrière « Voir plus » plutôt que d'allonger démesurément la page de détail.
const COLLAPSE_LIMIT = 1_200;

/**
 * Description complète de l'offre (spec §2/§7) : texte brut de la source,
 * jamais interprété en HTML — `whitespace-pre-line` conserve les sauts de
 * ligne sans risque d'injection qu'un rendu `dangerouslySetInnerHTML` aurait.
 */
export function JobDescription({ description }: JobDescriptionProps) {
  const [expanded, setExpanded] = useState(false);
  // Identifiant stable par instance (revue f9bf90c, point 2) : lie le bouton de
  // repli/dépli au paragraphe qu'il contrôle pour les lecteurs d'écran.
  const textId = useId();
  const trimmed = description.trim();
  if (trimmed === '') return null;

  const isLong = trimmed.length > COLLAPSE_LIMIT;
  const shown = isLong && !expanded ? `${trimmed.slice(0, COLLAPSE_LIMIT).trimEnd()}…` : trimmed;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Description</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p id={textId} className="whitespace-pre-line text-sm">
          {shown}
        </p>
        {isLong && (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            aria-expanded={expanded}
            aria-controls={textId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Voir moins' : 'Voir plus'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
