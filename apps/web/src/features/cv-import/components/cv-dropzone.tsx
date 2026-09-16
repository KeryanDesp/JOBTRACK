import { UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { cn } from '@/lib/utils';

const ACCEPT_ATTRIBUTE =
  '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ACCEPTED_EXTENSIONS = ['.pdf', '.docx'];
const ACCEPTED_MIME_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

function hasAcceptedFormat(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const hasAcceptedExtension = ACCEPTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  // `file.type` peut être vide (certains navigateurs, certains systèmes de fichiers) :
  // dans ce cas, seule l'extension tranche plutôt que de refuser à tort.
  const hasAcceptedType = file.type === '' || ACCEPTED_MIME_TYPES.includes(file.type);
  return hasAcceptedExtension && hasAcceptedType;
}

function validateFile(file: File, maxSizeBytes: number): string | null {
  if (!hasAcceptedFormat(file)) return 'Format non pris en charge : PDF ou DOCX uniquement.';
  if (file.size > maxSizeBytes) return 'Fichier trop volumineux (10 Mo maximum).';
  return null;
}

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export interface CvDropzoneProps {
  /** Envoi en cours (progression déjà lancée par l'appelant) : désactive la zone et affiche la barre. */
  isUploading: boolean;
  /** Fraction (0 à 1) de l'envoi déjà transmis. */
  progress: number;
  maxSizeBytes?: number;
  /** Fichier validé côté client, sur clic de « Analyser mon CV ». */
  onSelect: (file: File) => void;
  /** Annule l'envoi en cours ; le bouton « Annuler » n'apparaît que si fourni. */
  onCancelUpload?: () => void;
}

/**
 * Zone de dépôt d'un CV : `input type="file"` réel (accessible, testable),
 * zone cliquable et glisser-déposer, erreurs de format/taille lisibles avant
 * tout envoi. Le fichier n'est transmis à l'appelant (`onSelect`) qu'une fois
 * choisi *et* confirmé par « Analyser mon CV » — jamais dès la sélection —
 * pour laisser l'utilisateur changer d'avis sans déclencher d'envoi.
 */
export function CvDropzone({
  isUploading,
  progress,
  maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
  onSelect,
  onCancelUpload,
}: CvDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(fileList: FileList | null): void {
    const next = fileList?.[0];
    if (!next) return;
    const validationError = validateFile(next, maxSizeBytes);
    if (validationError) {
      setFile(null);
      setError(validationError);
      return;
    }
    setError(null);
    setFile(next);
  }

  function openPicker(): void {
    if (!isUploading) inputRef.current?.click();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    if (isUploading) return;
    handleFiles(event.dataTransfer.files);
  }

  function handleChangeFile(): void {
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={isUploading ? -1 : 0}
        aria-label="Zone de dépôt du CV"
        aria-disabled={isUploading || undefined}
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isUploading) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-border',
          isUploading && 'cursor-not-allowed opacity-60',
        )}
      >
        <UploadCloud className="text-muted-foreground size-8" aria-hidden />
        <p className="text-sm font-medium">Glissez votre CV ici, ou cliquez pour le choisir</p>
        <p className="text-muted-foreground text-xs">PDF ou DOCX, 10 Mo maximum.</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          aria-label="Choisir un fichier CV"
          disabled={isUploading}
          className="sr-only"
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>

      <FormFieldError message={error ?? undefined} />

      {file && !error && (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{file.name}</p>
            <p className="text-muted-foreground text-xs">{formatFileSize(file.size)}</p>
          </div>
          {!isUploading && (
            <Button type="button" variant="ghost" size="sm" onClick={handleChangeFile}>
              Changer
            </Button>
          )}
        </div>
      )}

      {isUploading && (
        <div className="space-y-2">
          <Progress value={Math.round(progress * 100)} />
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs">Envoi en cours…</p>
            {onCancelUpload && (
              <Button type="button" variant="ghost" size="sm" onClick={onCancelUpload}>
                Annuler
              </Button>
            )}
          </div>
        </div>
      )}

      {file && !error && !isUploading && (
        <Button type="button" className="w-full" onClick={() => onSelect(file)}>
          Analyser mon CV
        </Button>
      )}
    </div>
  );
}
