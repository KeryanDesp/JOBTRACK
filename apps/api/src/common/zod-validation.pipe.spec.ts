import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({ email: z.string().email(), age: z.coerce.number().int() });

describe('ZodValidationPipe', () => {
  it('renvoie la valeur transformee quand elle est valide', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ email: 'a@b.com', age: '30' })).toEqual({ email: 'a@b.com', age: 30 });
  });

  it('leve une BadRequest portant un message francais et le detail par champ', () => {
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ email: 'invalide', age: 'x' });
      expect.unreachable('la validation aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: Record<string, string>;
      };
      expect(response.code).toBe('VALIDATION_ERROR');
      expect(response.message).toBe('Certains champs sont invalides.');
      expect(response.details.email).toBeDefined();
      expect(response.details.age).toBeDefined();
    }
  });
});
