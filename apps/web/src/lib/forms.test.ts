import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { emptyToNull, zodResolverWith } from './forms';

const schema = z.object({
  name: z.string().trim().min(1, 'Ce champ est obligatoire.'),
  endDate: z.string().date('Date invalide.').optional().nullable(),
});
type Values = z.input<typeof schema>;
type Out = z.infer<typeof schema>;

const nestedSchema = z.object({
  a: z.object({ b: z.string().trim().min(1, 'Obligatoire.') }),
});
type NestedValues = z.input<typeof nestedSchema>;
type NestedOut = z.infer<typeof nestedSchema>;

const options = { fields: {}, shouldUseNativeValidation: false };

describe('zodResolverWith', () => {
  it('normalise une chaine vide en null sur une date nullable et valide', async () => {
    const resolver = zodResolverWith<Values, Out>(schema, (raw) => emptyToNull(raw as Record<string, unknown>, ['endDate']));

    const result = await resolver({ name: 'Ada', endDate: '' }, undefined, options);

    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ name: 'Ada', endDate: null });
  });

  it('reporte une valeur invalide sur le champ concerne', async () => {
    const resolver = zodResolverWith<Values, Out>(schema, (raw) => raw);

    const result = await resolver({ name: '', endDate: null }, undefined, options);

    expect(result.values).toEqual({});
    expect(result.errors.name?.message).toBe('Ce champ est obligatoire.');
  });

  it('reconstitue un chemin imbrique la ou React Hook Form le lit', async () => {
    const resolver = zodResolverWith<NestedValues, NestedOut>(nestedSchema, (raw) => raw);

    const result = await resolver({ a: { b: '' } }, undefined, options);

    expect(result.values).toEqual({});
    expect(result.errors.a?.b?.message).toBe('Obligatoire.');
  });
});
