import Anthropic from '@anthropic-ai/sdk';
import * as mammoth from 'mammoth';
import { describe, expect, it, vi } from 'vitest';
import type { AnthropicClient } from '../../common/anthropic.provider';
import {
  AiNotConfiguredError,
  AiUnavailableError,
  CvTooLongError,
  CvUnreadableError,
} from './cv-extraction.errors';
import { CvExtractionService } from './cv-extraction.service';

// `vi.mock` est hissé par vitest avant les imports ci-dessus : `mammoth.extractRawText`
// est donc déjà le faux ci-dessous au moment où le service l'appelle.
vi.mock('mammoth', () => ({ extractRawText: vi.fn() }));

const PDF_INPUT = { buffer: Buffer.from('%PDF-1.4 contenu factice'), mimeType: 'application/pdf' as const };
const DOCX_INPUT = {
  buffer: Buffer.from('contenu docx factice'),
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const,
};

// Sortie « fil » minimale mais realiste (toutes les cles requises par `cvExtractionWireSchema`).
const WIRE_EXTRACTION = {
  identity: {
    firstName: 'Camille',
    lastName: 'Demo',
    phone: null,
    city: 'Paris',
    country: 'France',
    title: 'Developpeuse',
    summary: null,
  },
  experiences: [],
  educations: [],
  skills: [],
  languages: [],
  certifications: [],
  projects: [],
  preferences: { desiredRoles: [], locations: [] },
};

// Reponse minimale de `messages.parse` : seuls les champs lus par le service
// (le reste de `Anthropic.Message` — id, content, container... — ne l'est jamais).
interface FakeParsedMessage {
  model: string;
  stop_reason: Anthropic.StopReason;
  parsed_output: unknown;
  usage: { input_tokens: number; output_tokens: number };
}

type CountTokens = (params: Anthropic.MessageCountTokensParams) => Promise<Anthropic.MessageTokensCount>;
type Parse = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<FakeParsedMessage>;

interface FakeMessages {
  countTokens: ReturnType<typeof vi.fn<CountTokens>>;
  parse: ReturnType<typeof vi.fn<Parse>>;
}

/**
 * Seul cast du fichier : le service n'utilise que `messages.countTokens` et
 * `messages.parse`, jamais le reste de la surface `Anthropic` — un faux client
 * complet n'apporterait rien et alourdirait chaque test.
 */
function fakeClient(messages: FakeMessages): AnthropicClient {
  return { messages } as unknown as Anthropic;
}

function fakeMessages(overrides: Partial<FakeMessages> = {}): FakeMessages {
  return {
    countTokens: vi.fn<CountTokens>().mockResolvedValue({ input_tokens: 1_000 }),
    parse: vi.fn<Parse>().mockResolvedValue({
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      parsed_output: WIRE_EXTRACTION,
      usage: { input_tokens: 1_000, output_tokens: 200 },
    }),
    ...overrides,
  };
}

describe('CvExtractionService', () => {
  it('leve AiNotConfiguredError quand aucun client n_est injecte', async () => {
    const service = new CvExtractionService(null);

    await expect(service.extract(PDF_INPUT)).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it('extrait un pdf : bloc document, prompt en cache, format structure, tokens renvoyes', async () => {
    const messages = fakeMessages();
    const service = new CvExtractionService(fakeClient(messages));

    const result = await service.extract(PDF_INPUT);

    expect(result.extraction.identity.firstName).toBe('Camille');
    expect(result.model).toBe('claude-opus-5');
    expect(result.inputTokens).toBe(1_000);
    expect(result.outputTokens).toBe(200);

    const parseArgs = messages.parse.mock.calls[0]?.[0];
    const content = parseArgs?.messages?.[0]?.content;
    expect(content?.[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
    expect(parseArgs?.system?.[0]).toMatchObject({ cache_control: { type: 'ephemeral' } });
    expect(parseArgs?.output_config?.format).toBeDefined();
  });

  it("refuse un document trop long en tokens sans jamais appeler parse", async () => {
    const messages = fakeMessages({ countTokens: vi.fn<CountTokens>().mockResolvedValue({ input_tokens: 70_000 }) });
    const service = new CvExtractionService(fakeClient(messages));

    await expect(service.extract(PDF_INPUT)).rejects.toBeInstanceOf(CvTooLongError);
    expect(messages.parse).not.toHaveBeenCalled();
  });

  it('leve CvUnreadableError quand parsed_output est nul', async () => {
    const messages = fakeMessages({
      parse: vi.fn<Parse>().mockResolvedValue({
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        parsed_output: null,
        usage: { input_tokens: 1_000, output_tokens: 50 },
      }),
    });
    const service = new CvExtractionService(fakeClient(messages));

    await expect(service.extract(PDF_INPUT)).rejects.toBeInstanceOf(CvUnreadableError);
  });

  it('leve CvUnreadableError quand le modele refuse (stop_reason refusal)', async () => {
    const messages = fakeMessages({
      parse: vi.fn<Parse>().mockResolvedValue({
        model: 'claude-opus-5',
        stop_reason: 'refusal',
        parsed_output: null,
        usage: { input_tokens: 1_000, output_tokens: 10 },
      }),
    });
    const service = new CvExtractionService(fakeClient(messages));

    await expect(service.extract(PDF_INPUT)).rejects.toBeInstanceOf(CvUnreadableError);
  });

  it('leve AiUnavailableError quand Anthropic repond une erreur de quota (429)', async () => {
    const rateLimitError = new Anthropic.RateLimitError(429, {}, 'limité', new Headers());
    const messages = fakeMessages({ parse: vi.fn<Parse>().mockRejectedValue(rateLimitError) });
    const service = new CvExtractionService(fakeClient(messages));

    await expect(service.extract(PDF_INPUT)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('leve CvUnreadableError quand un docx ne contient aucun texte exploitable', async () => {
    vi.mocked(mammoth.extractRawText).mockResolvedValueOnce({ value: '   ', messages: [] });
    const service = new CvExtractionService(fakeClient(fakeMessages()));

    await expect(service.extract(DOCX_INPUT)).rejects.toBeInstanceOf(CvUnreadableError);
  });

  it('leve CvUnreadableError quand `parse` echoue avec une AnthropicError nue (JSON tronque ou hors schema)', async () => {
    const bareError = new Anthropic.AnthropicError('sortie brute non conforme');
    const messages = fakeMessages({ parse: vi.fn<Parse>().mockRejectedValue(bareError) });
    const service = new CvExtractionService(fakeClient(messages));

    await expect(service.extract(PDF_INPUT)).rejects.toBeInstanceOf(CvUnreadableError);
  });

  it('leve CvUnreadableError quand stop_reason vaut max_tokens, meme si parsed_output est renseigne', async () => {
    const messages = fakeMessages({
      parse: vi.fn<Parse>().mockResolvedValue({
        model: 'claude-opus-5',
        stop_reason: 'max_tokens',
        parsed_output: WIRE_EXTRACTION,
        usage: { input_tokens: 1_000, output_tokens: 16_000 },
      }),
    });
    const service = new CvExtractionService(fakeClient(messages));

    await expect(service.extract(PDF_INPUT)).rejects.toBeInstanceOf(CvUnreadableError);
  });

  it('leve AiNotConfiguredError quand Anthropic refuse l_authentification', async () => {
    const authError = new Anthropic.AuthenticationError(401, {}, 'clé invalide', new Headers());
    const messages = fakeMessages({ parse: vi.fn<Parse>().mockRejectedValue(authError) });
    const service = new CvExtractionService(fakeClient(messages));

    await expect(service.extract(PDF_INPUT)).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it('leve AiUnavailableError quand la connexion a Anthropic echoue', async () => {
    const connectionError = new Anthropic.APIConnectionError({ message: 'panne réseau' });
    const messages = fakeMessages({ parse: vi.fn<Parse>().mockRejectedValue(connectionError) });
    const service = new CvExtractionService(fakeClient(messages));

    await expect(service.extract(PDF_INPUT)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('repropage telle quelle une erreur inconnue (bug, pas une erreur du SDK Anthropic)', async () => {
    const bug = new Error('bug interne inattendu');
    const messages = fakeMessages({ parse: vi.fn<Parse>().mockRejectedValue(bug) });
    const service = new CvExtractionService(fakeClient(messages));

    await expect(service.extract(PDF_INPUT)).rejects.toBe(bug);
  });

  it('ecarte une experience dont la date est calendairement invalide (29 fevrier 2021) sans faire echouer l_extraction', async () => {
    const messages = fakeMessages({
      parse: vi.fn<Parse>().mockResolvedValue({
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        parsed_output: {
          ...WIRE_EXTRACTION,
          experiences: [
            {
              company: 'Acme',
              role: 'Dev',
              location: null,
              startDate: '2021-02-29',
              endDate: null,
              isCurrent: true,
              description: null,
            },
          ],
        },
        usage: { input_tokens: 1_000, output_tokens: 200 },
      }),
    });
    const service = new CvExtractionService(fakeClient(messages));

    const result = await service.extract(PDF_INPUT);

    expect(result.extraction.experiences).toHaveLength(0);
  });

  it('leve AiUnavailableError quand `countTokens` echoue avec une erreur de quota (429)', async () => {
    const rateLimitError = new Anthropic.RateLimitError(429, {}, 'limité', new Headers());
    const messages = fakeMessages({ countTokens: vi.fn<CountTokens>().mockRejectedValue(rateLimitError) });
    const service = new CvExtractionService(fakeClient(messages));

    await expect(service.extract(PDF_INPUT)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(messages.parse).not.toHaveBeenCalled();
  });
});
