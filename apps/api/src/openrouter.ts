/**
 * Client minimo per le API di OpenRouter usate dal pannello admin: elenco dei modelli
 * (con prezzi e tipo di input) e verifica della chiave.
 */
/** Sovrascrivibile con OPENROUTER_BASE_URL (proxy o test). */
const base = () =>
  (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  /** Gratuito: suffisso ":free" oppure prezzo zero. */
  free: boolean;
  /** Accetta immagini in input (serve per scontrini e screenshot). */
  imageInput: boolean;
  /** Prezzi in dollari per milione di token; null se variabili o sconosciuti. */
  promptPerM: number | null;
  completionPerM: number | null;
  /** Supporta output JSON strutturato (response_format). */
  structuredOutput: boolean;
  tools: boolean;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: { input_modalities?: unknown; modality?: unknown };
  pricing?: { prompt?: unknown; completion?: unknown };
  supported_parameters?: unknown;
}

const perMillion = (value: unknown): number | null => {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 10_000) / 10_000;
};

export function parseModels(body: unknown): OpenRouterModel[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error('OPENROUTER_BAD_RESPONSE');
  const models: OpenRouterModel[] = [];
  for (const raw of data as RawModel[]) {
    if (typeof raw.id !== 'string') continue;
    const inputs = Array.isArray(raw.architecture?.input_modalities)
      ? (raw.architecture!.input_modalities as unknown[]).map(String)
      : String(raw.architecture?.modality ?? 'text->text')
          .split('->')[0]!
          .split('+');
    const params = Array.isArray(raw.supported_parameters)
      ? (raw.supported_parameters as unknown[]).map(String)
      : [];
    const promptPerM = perMillion(raw.pricing?.prompt);
    const completionPerM = perMillion(raw.pricing?.completion);
    models.push({
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : raw.id,
      contextLength: typeof raw.context_length === 'number' ? raw.context_length : null,
      free: raw.id.endsWith(':free') || (promptPerM === 0 && completionPerM === 0),
      imageInput: inputs.includes('image'),
      promptPerM,
      completionPerM,
      structuredOutput: params.includes('structured_outputs') || params.includes('response_format'),
      tools: params.includes('tools'),
    });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

let cache: { at: number; models: OpenRouterModel[] } | null = null;
const TTL = 3600 * 1000;

export async function listModels(
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
  force = false,
) {
  if (!force && cache && Date.now() - cache.at < TTL)
    return { models: cache.models, fetchedAt: cache.at };
  const res = await fetchImpl(`${base()}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OPENROUTER_HTTP_${res.status}`);
  cache = { at: Date.now(), models: parseModels(await res.json()) };
  return { models: cache.models, fetchedAt: cache.at };
}

export function clearModelsCache() {
  cache = null;
}

export interface KeyInfo {
  label: string | null;
  usage: number | null;
  limit: number | null;
  limitRemaining: number | null;
  freeTier: boolean;
}

/** Verifica la chiave e restituisce consumo e limite (dollari). */
export async function checkKey(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<KeyInfo> {
  const res = await fetchImpl(`${base()}/key`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('OPENROUTER_INVALID_KEY');
  if (!res.ok) throw new Error(`OPENROUTER_HTTP_${res.status}`);
  const data = ((await res.json()) as { data?: Record<string, unknown> }).data ?? {};
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    label: typeof data.label === 'string' ? data.label : null,
    usage: num(data.usage),
    limit: num(data.limit),
    limitRemaining: num(data.limit_remaining),
    freeTier: data.is_free_tier === true,
  };
}
