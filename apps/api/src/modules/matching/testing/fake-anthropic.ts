import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicClient } from '../../../common/anthropic.provider';

// `process.cwd()` vaut `apps/api` sous `vitest run` (même remarque que `fake-connector.ts` et
// `cv-import.e2e.spec.ts`) : pas de dépendance à `import.meta.url`.
const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'matching');
const FIXTURE_PREFIX = 'requirements-';
const FIXTURE_SUFFIX = '.json';

/** Exigences par défaut quand aucune clé connue n'apparaît dans le prompt : aucune technologie
 * identifiée — le moteur de score se rabat alors sur les compétences France Travail de l'offre
 * (spec §5) plutôt que de recevoir un jeu de données arbitraire. */
const DEFAULT_REQUIREMENTS = {
  technologies: [],
  softSkills: [],
  experienceYearsMin: null,
  seniority: null,
  educationLevel: null,
  educationFields: [],
  languages: [],
  remoteMode: null,
  contractHints: [],
  mustHaves: [],
  niceToHaves: [],
  summary: 'Offre analysée par le client Anthropic factice.',
};

/** Lit une fois les fixtures livrées (`requirements-FT-0001.json`…), clé = nom de fichier sans
 * préfixe/suffixe (`FT-0001`). Dossier absent (paquet publié sans les fixtures) : jamais bloquant. */
function loadFixtureFiles(): Map<string, unknown> {
  const fixtures = new Map<string, unknown>();
  let fileNames: string[];
  try {
    fileNames = readdirSync(FIXTURES_DIR);
  } catch {
    return fixtures;
  }
  for (const fileName of fileNames) {
    if (!fileName.startsWith(FIXTURE_PREFIX) || !fileName.endsWith(FIXTURE_SUFFIX)) continue;
    const key = fileName.slice(FIXTURE_PREFIX.length, fileName.length - FIXTURE_SUFFIX.length);
    fixtures.set(key, JSON.parse(readFileSync(join(FIXTURES_DIR, fileName), 'utf-8')) as unknown);
  }
  return fixtures;
}

/** Concatène le texte envoyé au modèle (titre, entreprise, description… — cf. `buildOfferDocument`),
 * pour y chercher une clé connue. Le contenu peut être une chaîne ou des blocs structurés : les deux
 * formes sont couvertes, jamais un accès direct à `.text` qui échouerait sur l'autre forme. */
function promptText(params: Anthropic.MessageCreateParamsNonStreaming): string {
  return params.messages
    .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
    .join('\n');
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
 * Client Anthropic factice pour les tests e2e du module `matching` (spec §9) : ne fait jamais
 * d'appel réseau. `messages.parse` renvoie les exigences associées à la première clé connue
 * (fixture livrée ou enregistrée par un test via `setRequirements`) trouvée dans le texte du
 * prompt — titre, entreprise ou description de l'offre, cf. `buildOfferDocument` — la clé la
 * plus longue l'emportant en cas de recouvrement ; sans correspondance, des exigences par défaut
 * sans aucune technologie. `failNext` fait échouer le prochain appel avec l'erreur donnée (une
 * seule fois, jamais persistante). `calls` compte les appels effectivement exécutés (échecs
 * compris), pour vérifier qu'une offre déjà analysée ne rappelle jamais le modèle (spec §2).
 */
export class FakeAnthropicClient {
  calls = 0;

  private readonly fixtures: Map<string, unknown>;
  private pendingError: Error | null = null;
  private usage: FakeAnthropicUsage = { inputTokens: 500, outputTokens: 200 };

  readonly messages = {
    parse: (params: Anthropic.MessageCreateParamsNonStreaming): Promise<FakeParsedMessage> => {
      this.calls += 1;
      if (this.pendingError) {
        const error = this.pendingError;
        this.pendingError = null;
        return Promise.reject(error);
      }
      return Promise.resolve({
        model: 'fake-matching-model',
        stop_reason: 'end_turn',
        parsed_output: this.resolveRequirements(promptText(params)),
        usage: { input_tokens: this.usage.inputTokens, output_tokens: this.usage.outputTokens },
      });
    },
  };

  constructor() {
    this.fixtures = loadFixtureFiles();
  }

  /** Enregistre (ou remplace) les exigences renvoyées quand `key` apparaît dans le prompt — un
   * test associe typiquement `key` à un fragment distinctif du titre de son offre. */
  setRequirements(key: string, requirements: unknown): void {
    this.fixtures.set(key, requirements);
  }

  /** Fait échouer le prochain appel à `messages.parse` (une seule fois), puis retombe sur le
   * comportement normal — comme `fakeMessages.parse.mockRejectedValueOnce(...)` côté cv-import. */
  failNext(error: Error): void {
    this.pendingError = error;
  }

  /** Jetons renvoyés par les appels suivants (par défaut 500 entrée / 200 sortie). */
  setUsage(usage: FakeAnthropicUsage): void {
    this.usage = usage;
  }

  /** Remet le compteur et l'erreur en attente à zéro entre deux tests — jamais les exigences
   * enregistrées (`setRequirements`), qu'un test pose typiquement une fois pour toute la suite. */
  reset(): void {
    this.calls = 0;
    this.pendingError = null;
  }

  private resolveRequirements(prompt: string): unknown {
    let bestKey: string | null = null;
    for (const key of this.fixtures.keys()) {
      if (!prompt.includes(key)) continue;
      if (!bestKey || key.length > bestKey.length) bestKey = key;
    }
    return bestKey ? this.fixtures.get(bestKey) : DEFAULT_REQUIREMENTS;
  }
}

/** Seul cast du fichier (même motif que `cv-import.e2e.spec.ts`) : le service ne lit jamais que
 * `messages.parse`, jamais le reste de la surface `Anthropic`. */
export function toAnthropicClient(fake: FakeAnthropicClient): AnthropicClient {
  return fake as unknown as AnthropicClient;
}
