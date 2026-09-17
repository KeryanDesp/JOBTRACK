import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicClient } from '../../../common/anthropic.provider';

// `process.cwd()` vaut `apps/api` sous `vitest run` (même remarque que `matching/testing/fake-anthropic.ts`).
const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'resume');
const TAILORING_FIXTURE_FILE = 'tailoring-FT-0001.json';
const LETTER_FIXTURE_FILE = 'letter-professional.json';

// Fragment unique au prompt système de la lettre de motivation (`cover-letter.prompt.ts`,
// `COVER_LETTER_SYSTEM_PROMPT`) : absent du prompt d'adaptation de CV
// (`resume-tailoring.prompt.ts`, `RESUME_TAILORING_SYSTEM_PROMPT`) — sert à distinguer les deux
// usages du même client factice, partagé par les deux services via `ANTHROPIC_CLIENT`.
const LETTER_SYSTEM_MARKER = 'lettres de motivation';

function readFixture(fileName: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, fileName), 'utf-8')) as unknown;
}

/** Copie profonde (JSON) : chaque appelant reçoit sa propre copie de la fixture, jamais une
 * référence partagée qu'une mutation ultérieure (réécriture d'identifiants) affecterait ailleurs. */
function cloneFixture(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** Copie de la fixture d'adaptation de CV livrée (`fixtures/resume/tailoring-FT-0001.json`) —
 * un test réécrit typiquement les identifiants `E2E-EXP-1`/`E2E-EXP-2` avec ceux des expériences
 * qu'il a réellement créées avant de la passer à `setTailoringOutput`. */
export function defaultTailoringOutput(): unknown {
  return cloneFixture(readFixture(TAILORING_FIXTURE_FILE));
}

/** Copie de la fixture de lettre livrée (`fixtures/resume/letter-professional.json`). */
export function defaultLetterOutput(): unknown {
  return cloneFixture(readFixture(LETTER_FIXTURE_FILE));
}

/** Concatène le texte système + les messages envoyés au modèle (même principe que
 * `matching/testing/fake-anthropic.ts`/`promptText`) : la forme du contenu peut être une chaîne ou
 * des blocs structurés, les deux sont couvertes. */
function requestText(params: Anthropic.MessageCreateParamsNonStreaming): string {
  const systemText = Array.isArray(params.system)
    ? params.system.map((block) => block.text).join('\n')
    : (params.system ?? '');
  const messagesText = params.messages
    .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
    .join('\n');
  return `${systemText}\n${messagesText}`;
}

interface FakeParsedMessage {
  model: string;
  stop_reason: Anthropic.StopReason;
  parsed_output: unknown;
  usage: { input_tokens: number; output_tokens: number };
}

export interface FakeAnthropicUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Client Anthropic factice pour les tests e2e du module `resume` (spec §9) : ne fait jamais
 * d'appel réseau. Partagé par `ResumeTailoringService` et `CoverLetterService` (même jeton
 * `ANTHROPIC_CLIENT`) — `messages.parse` distingue les deux usages par la présence de
 * `LETTER_SYSTEM_MARKER` dans le prompt système, et renvoie la sortie d'adaptation de CV ou de
 * lettre correspondante (fixture livrée par défaut, ou celle posée par `setTailoringOutput`/
 * `setLetterOutput`). `failNext` fait échouer le prochain appel (une seule fois). `calls` compte
 * les appels effectivement exécutés (échecs compris). `lastRequest` conserve les paramètres du
 * dernier appel, pour vérifier qu'aucune coordonnée (email, téléphone) n'y figure jamais.
 */
export class FakeAnthropicClient {
  calls = 0;
  lastRequest: Anthropic.MessageCreateParamsNonStreaming | null = null;

  private pendingError: Error | null = null;
  private usage: FakeAnthropicUsage = { inputTokens: 500, outputTokens: 200 };
  private tailoringOutput: unknown = defaultTailoringOutput();
  private letterOutput: unknown = defaultLetterOutput();

  readonly messages = {
    parse: (params: Anthropic.MessageCreateParamsNonStreaming): Promise<FakeParsedMessage> => {
      this.calls += 1;
      this.lastRequest = params;
      if (this.pendingError) {
        const error = this.pendingError;
        this.pendingError = null;
        return Promise.reject(error);
      }
      const isLetter = requestText(params).includes(LETTER_SYSTEM_MARKER);
      return Promise.resolve({
        model: 'fake-resume-model',
        stop_reason: 'end_turn',
        parsed_output: isLetter ? this.letterOutput : this.tailoringOutput,
        usage: { input_tokens: this.usage.inputTokens, output_tokens: this.usage.outputTokens },
      });
    },
  };

  /** Remplace la sortie d'adaptation de CV renvoyée par les appels suivants — typiquement
   * `defaultTailoringOutput()` dont les identifiants d'expérience ont été réécrits avec ceux du
   * profil réellement créé par le test. */
  setTailoringOutput(output: unknown): void {
    this.tailoringOutput = output;
  }

  /** Remplace la sortie de lettre renvoyée par les appels suivants. */
  setLetterOutput(output: unknown): void {
    this.letterOutput = output;
  }

  /** Fait échouer le prochain appel à `messages.parse` (une seule fois), puis retombe sur le
   * comportement normal. */
  failNext(error: Error): void {
    this.pendingError = error;
  }

  /** Jetons renvoyés par les appels suivants (par défaut 500 entrée / 200 sortie). */
  setUsage(usage: FakeAnthropicUsage): void {
    this.usage = usage;
  }

  /** Remet le compteur, l'erreur en attente et la dernière requête capturée à zéro entre deux
   * tests — jamais les sorties enregistrées (`setTailoringOutput`/`setLetterOutput`), qu'un test
   * pose typiquement une fois pour toute la suite. */
  reset(): void {
    this.calls = 0;
    this.pendingError = null;
    this.lastRequest = null;
  }
}

/** Seul cast du fichier (même motif que `matching/testing/fake-anthropic.ts`) : le service ne lit
 * jamais que `messages.parse`, jamais le reste de la surface `Anthropic`. */
export function toAnthropicClient(fake: FakeAnthropicClient): AnthropicClient {
  return fake as unknown as AnthropicClient;
}
