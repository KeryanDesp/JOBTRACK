import { BadRequestException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter';

interface Sent {
  status: number;
  body: unknown;
}

function run(exception: unknown): Sent {
  const sent: Partial<Sent> = {};
  const reply = {
    status: (code: number) => {
      sent.status = code;
      return reply;
    },
    send: (body: unknown) => {
      sent.body = body;
      return reply;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost;

  new HttpExceptionFilter().catch(exception, host);
  return sent as Sent;
}

describe('HttpExceptionFilter', () => {
  it('transmet tel quel un corps deja au format du projet', () => {
    const { status, body } = run(
      new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Certains champs sont invalides.', details: { email: 'x' } }),
    );
    expect(status).toBe(400);
    expect(body).toEqual({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Certains champs sont invalides.', details: { email: 'x' } });
  });

  it('remplace le message anglais d_une exception integree de Nest par un message francais', () => {
    const { status, body } = run(new NotFoundException('Cannot GET /inconnu'));
    expect(status).toBe(404);
    expect(body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Ressource introuvable.' });
    expect(JSON.stringify(body)).not.toContain('Cannot GET');
  });

  it('masque toute erreur inattendue derriere un message neutre et la journalise', () => {
    // `logger` est un champ d'instance (pas sur le prototype de HttpExceptionFilter) :
    // on espionne Logger.prototype.error plutôt que HttpExceptionFilter.prototype['logger'].
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { status, body } = run(new Error('détail technique interne'));
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body).toEqual({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Une erreur est survenue. Veuillez réessayer.' });
    expect(JSON.stringify(body)).not.toContain('détail technique');
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
