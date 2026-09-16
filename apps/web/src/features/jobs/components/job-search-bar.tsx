import type { CommuneDto } from '@jobtrack/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CommunePicker } from './commune-picker';

const RADIUS_OPTIONS = [5, 10, 25, 50, 100];

export interface JobSearchSubmit {
  q: string;
  distance: number;
  communes: string[];
}

interface JobSearchBarProps {
  q: string;
  distance: number;
  /** Communes déjà résolues (nom lisible), fournies par la page (spec §7 : carte code → `CommuneDto`). */
  communes: CommuneDto[];
  /** Appelé dès qu'une commune est ajoutée/retirée, pour que la page retienne son nom sans attendre la soumission. */
  onCommunesResolved: (next: CommuneDto[]) => void;
  onSearch: (submit: JobSearchSubmit) => void;
}

/**
 * Barre de recherche (spec §2/§7) : mots-clés, lieux, rayon restent en saisie
 * locale jusqu'à « Rechercher » (ou Entrée) — seule la soumission réécrit
 * l'URL, pour ne pas relancer une recherche à chaque frappe.
 */
export function JobSearchBar({ q, distance, communes, onCommunesResolved, onSearch }: JobSearchBarProps) {
  const [localQ, setLocalQ] = useState(q);
  const [localDistance, setLocalDistance] = useState(distance);
  const [localCommunes, setLocalCommunes] = useState<CommuneDto[]>(communes);
  const communesKey = communes.map((commune) => commune.code).join(',');

  // Resynchronise sur tout changement externe (navigation, réinitialisation des filtres) ;
  // `communesKey` plutôt que `communes` : ce tableau change de référence à chaque rendu
  // du parent, seule la liste effective des codes doit déclencher une resynchronisation.
  useEffect(() => {
    setLocalQ(q);
    setLocalDistance(distance);
    setLocalCommunes(communes);
    // communes volontairement absent des dépendances (voir communesKey ci-dessus).
  }, [q, distance, communesKey]);

  function handleCommunesChange(next: CommuneDto[]) {
    setLocalCommunes(next);
    onCommunesResolved(next);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSearch({
      q: localQ.trim(),
      distance: localDistance,
      communes: localCommunes.map((commune) => commune.code),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1 space-y-2">
        <Label htmlFor="job-search-q">Mots-clés</Label>
        <Input
          id="job-search-q"
          value={localQ}
          onChange={(event) => setLocalQ(event.target.value)}
          placeholder="Ex. développeur, comptable…"
        />
      </div>

      <div className="min-w-56 flex-1 space-y-2">
        <Label>Lieux</Label>
        <CommunePicker value={localCommunes} onChange={handleCommunesChange} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="job-search-distance">Rayon</Label>
        <Select value={String(localDistance)} onValueChange={(next) => setLocalDistance(Number(next))}>
          <SelectTrigger id="job-search-distance" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RADIUS_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} km
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="submit">Rechercher</Button>
    </form>
  );
}
