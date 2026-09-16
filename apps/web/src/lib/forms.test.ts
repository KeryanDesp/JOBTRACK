import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { emptyToNull, zodResolverWith } from './forms';

const schema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.'),
  endDate: z.string().date('Date invalide.').optional().nullable(),
});

const options = { fields: {}, shouldUseNativeValidation: false };

describe('zodResolverWith', () => {
  it('normalise une chaine vide en null sur une date nullable et valide', async () => {
    const resolver = zodResolverWith(schema, (raw) => emptyToNull(raw as Record<string, unknown>, ['endDate']));

    const result = await resolver({ name: 'Ada', endDate: '' }, undefined, options);

    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ name: 'Ada', endDate: null });
  });

  it('reporte une valeur invalide sur le champ concerne', async () => {
    const resolver = zodResolverWith(schema, (raw) => raw);

    const result = await resolver({ name: '', endDate: null }, undefined, options);

    expect(result.values).toEqual({});
    expect(result.errors.name?.message).toBe('Ce champ est obligatoire.');
  });
});
