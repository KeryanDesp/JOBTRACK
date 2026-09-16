import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';

/** Clé des erreurs qui ne portent sur aucun champ précis (refine global). */
const FORM_LEVEL_KEY = 'form';

/**
 * Valide un corps de requête avec un schéma du contrat partagé et renvoie
 * sa sortie typée. Le paramètre est le schéma lui-même, pas son type de
 * sortie : les schémas à transformation ont une entrée différente de leur
 * sortie, et `ZodSchema<T>` ne les accepterait pas.
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const details: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.') || FORM_LEVEL_KEY;
        details[path] ??= issue.message;
      }

      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Certains champs sont invalides.',
        details,
      });
    }

    return result.data as z.output<T>;
  }
}
