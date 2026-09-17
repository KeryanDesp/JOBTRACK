import type { LetterDocumentProps } from '../../lib/letter-templates';

/**
 * Jumeau HTML de la lettre de motivation (`letter.pdf.tsx`), même principe que
 * les modèles de CV (`templates/classic/template.preview.tsx`) : mêmes blocs,
 * même ordre, à l'échelle A4 réelle (`210mm × 297mm`). Toujours clair
 * (`bg-white`/`text-neutral-*` explicites, `colorScheme: 'light'`) — c'est un
 * document papier, il ne doit jamais suivre le thème sombre de l'application
 * (spec §7).
 */
export function Preview({ content, senderName, senderCity, company, dateLine }: LetterDocumentProps) {
  const hasRecipientBlock = Boolean(content.recipient) || Boolean(company);

  return (
    <div className="w-[210mm] min-h-[297mm] bg-white p-[20mm] font-serif text-neutral-900" style={{ colorScheme: 'light' }}>
      <header className="mb-10 flex items-start justify-between gap-6 text-sm text-neutral-800">
        <div>
          <p>{senderName}</p>
          {senderCity && <p>{senderCity}</p>}
        </div>
        <p className="shrink-0 text-neutral-600">{dateLine}</p>
      </header>

      {hasRecipientBlock && (
        <div className="mb-8 text-sm text-neutral-800">
          {content.recipient && <p>{content.recipient}</p>}
          {company && <p>{company}</p>}
        </div>
      )}

      <p className="mb-6 text-sm font-bold text-neutral-900">Objet : {content.subject}</p>

      <p className="mb-4 text-sm text-neutral-900">{content.greeting}</p>

      <div className="space-y-4 text-sm leading-relaxed text-neutral-800">
        {content.paragraphs.map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
      </div>

      <p className="mt-6 text-sm text-neutral-900">{content.closing}</p>
      <p className="mt-2 text-sm font-semibold text-neutral-900">{content.signature}</p>
    </div>
  );
}
