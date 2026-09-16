import { certificationSchema, type CertificationFormInput } from '@jobtrack/shared';
import { Award } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { CollectionSection } from '../components/collection-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormFieldError } from '@/features/auth/components/form-field-error';
import { emptyToNull } from '@/lib/forms';
import { formatMonthYear } from '@/lib/dates';
import type { CollectionItem } from '@/services/api/profile';

/** `expiresAt` reste une chaîne côté formulaire (voir `experiences-section.tsx`). */
export type CertificationFormValues = Omit<CertificationFormInput, 'expiresAt'> & { expiresAt: string };

// `expiresAt` (nullable, sans branche `''`) a besoin de `null` ; `credentialUrl`
// (URL optionnelle) accepte déjà `''` nativement, comme les champs texte optionnels.
// Exportée : réutilisée par la revue d'extraction de CV (`extraction-review.tsx`).
export function normalize(raw: CertificationFormValues): unknown {
  return emptyToNull(raw, ['expiresAt']);
}

export const DEFAULT_VALUES: CertificationFormValues = {
  name: '',
  issuer: '',
  issuedAt: '',
  expiresAt: '',
  credentialUrl: '',
};

export function toFormValues(item: CollectionItem<'certifications'>): CertificationFormValues {
  return {
    name: item.name,
    issuer: item.issuer,
    issuedAt: item.issuedAt,
    expiresAt: item.expiresAt ?? '',
    credentialUrl: item.credentialUrl ?? '',
  };
}

export function CertificationFields({ form }: { form: UseFormReturn<CertificationFormValues> }) {
  const {
    register,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="cert-name">Nom</Label>
          <Input
            id="cert-name"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'cert-name-error' : undefined}
            {...register('name')}
          />
          <FormFieldError id="cert-name-error" message={errors.name?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cert-issuer">Organisme</Label>
          <Input
            id="cert-issuer"
            aria-invalid={errors.issuer ? true : undefined}
            aria-describedby={errors.issuer ? 'cert-issuer-error' : undefined}
            {...register('issuer')}
          />
          <FormFieldError id="cert-issuer-error" message={errors.issuer?.message} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="cert-issued">Date d'obtention</Label>
          <Input
            id="cert-issued"
            type="date"
            aria-invalid={errors.issuedAt ? true : undefined}
            aria-describedby={errors.issuedAt ? 'cert-issued-error' : undefined}
            {...register('issuedAt')}
          />
          <FormFieldError id="cert-issued-error" message={errors.issuedAt?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cert-expires">Date d'expiration</Label>
          <Input
            id="cert-expires"
            type="date"
            aria-invalid={errors.expiresAt ? true : undefined}
            aria-describedby={errors.expiresAt ? 'cert-expires-error' : undefined}
            {...register('expiresAt')}
          />
          <FormFieldError id="cert-expires-error" message={errors.expiresAt?.message} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cert-url">Lien du justificatif</Label>
        <Input
          id="cert-url"
          type="url"
          aria-invalid={errors.credentialUrl ? true : undefined}
          aria-describedby={errors.credentialUrl ? 'cert-url-error' : undefined}
          {...register('credentialUrl')}
        />
        <FormFieldError id="cert-url-error" message={errors.credentialUrl?.message} />
      </div>
    </div>
  );
}

export function CertificationsSection() {
  return (
    <CollectionSection
      name="certifications"
      title="Certifications"
      description="Vos certifications et diplômes complémentaires."
      icon={Award}
      emptyLabel="Aucune certification ajoutée."
      addLabel="Ajouter une certification"
      deleteLabel="Supprimer cette certification"
      schema={certificationSchema}
      defaultValues={DEFAULT_VALUES}
      normalize={normalize}
      toFormValues={toFormValues}
      renderSummary={(item) => (
        <div>
          <p className="font-semibold">{item.name}</p>
          <p className="text-muted-foreground text-sm">
            {item.issuer} · {formatMonthYear(item.issuedAt)}
            {item.expiresAt ? ` – expire ${formatMonthYear(item.expiresAt)}` : ''}
          </p>
        </div>
      )}
      renderFields={(form) => <CertificationFields form={form} />}
    />
  );
}
