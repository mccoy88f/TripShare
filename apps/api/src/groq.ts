/**
 * Elenco dei modelli di Groq (API compatibile OpenAI). Groq ha un piano gratuito con limiti di
 * richieste: i modelli si segnano "gratis" come stima, senza prezzi.
 */
import type { OpenRouterModel } from './openrouter.js';

/** Sovrascrivibile con GROQ_BASE_URL (proxy o test). */
export const groqBase = () =>
  (process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, '');

/** Modelli che non generano testo (voce, sintesi vocale, moderazione). */
const EXCLUDED = /whisper|tts|orpheus|guard|safeguard/i;

interface RawGroqModel {
  id?: unknown;
  active?: unknown;
  context_window?: unknown;
}

/** Normalizza l'elenco nello stesso formato di OpenRouter. */
export function parseGroqModels(body: unknown): OpenRouterModel[] {
  const list = (body as { data?: unknown })?.data;
  if (!Array.isArray(list)) throw new Error('GROQ_BAD_RESPONSE');
  const models: OpenRouterModel[] = [];
  for (const raw of list as RawGroqModel[]) {
    if (typeof raw.id !== 'string' || raw.active === false || EXCLUDED.test(raw.id)) continue;
    models.push({
      id: raw.id,
      name: raw.id,
      contextLength: typeof raw.context_window === 'number' ? raw.context_window : null,
      free: true,
      // Visione: la serie Llama 4 e i modelli "vision".
      imageInput: /llama-4|vision/i.test(raw.id),
      promptPerM: null,
      completionPerM: null,
      structuredOutput: true,
      tools: true,
    });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

let cache: { at: number; key: string; models: OpenRouterModel[] } | null = null;
const TTL = 3600 * 1000;

export async function listGroqModels(
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
  force = false,
) {
  if (!apiKey) throw new Error('GROQ_NO_KEY');
  if (!force && cache && cache.key === apiKey && Date.now() - cache.at < TTL)
    return { models: cache.models, fetchedAt: cache.at };
  const res = await fetchImpl(`${groqBase()}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('GROQ_INVALID_KEY');
  if (!res.ok) throw new Error(`GROQ_HTTP_${res.status}`);
  cache = { at: Date.now(), key: apiKey, models: parseGroqModels(await res.json()) };
  return { models: cache.models, fetchedAt: cache.at };
}

export function clearGroqCache() {
  cache = null;
}
