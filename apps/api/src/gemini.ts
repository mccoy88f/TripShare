/**
 * Client per le API di Google Gemini (AI Studio): elenco dei modelli, verifica della chiave e
 * generazione. Si usa l'API nativa `generateContent`, che accetta immagini e PDF in linea e
 * offre la ricerca Google come strumento per le verifiche sul web.
 */
import type { OpenRouterModel } from './openrouter.js';

/** Sovrascrivibile con GEMINI_BASE_URL (proxy o test). */
export const geminiBase = () =>
  (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/$/,
    '',
  );

interface RawGeminiModel {
  name?: unknown;
  displayName?: unknown;
  inputTokenLimit?: unknown;
  supportedGenerationMethods?: unknown;
}

/** Modelli non adatti a testo/JSON (immagini, audio, embedding…). */
const EXCLUDED = /embedding|imagen|veo|tts|aqa|image-generation|-image|live|native-audio|robotics/i;

/**
 * Normalizza l'elenco dei modelli Gemini nello stesso formato usato per OpenRouter.
 * Google non indica prezzi né quali modelli rientrano nel piano gratuito: "free" è una stima
 * (modelli Flash, Flash-Lite e Gemma hanno un piano gratuito su AI Studio).
 */
export function parseGeminiModels(body: unknown): OpenRouterModel[] {
  const list = (body as { models?: unknown })?.models;
  if (!Array.isArray(list)) throw new Error('GEMINI_BAD_RESPONSE');
  const models: OpenRouterModel[] = [];
  for (const raw of list as RawGeminiModel[]) {
    if (typeof raw.name !== 'string') continue;
    const id = raw.name.replace(/^models\//, '');
    const methods = Array.isArray(raw.supportedGenerationMethods)
      ? (raw.supportedGenerationMethods as unknown[]).map(String)
      : [];
    if (!methods.includes('generateContent') || EXCLUDED.test(id)) continue;
    const gemma = id.startsWith('gemma');
    models.push({
      id,
      name: typeof raw.displayName === 'string' ? raw.displayName : id,
      contextLength: typeof raw.inputTokenLimit === 'number' ? raw.inputTokenLimit : null,
      free: gemma || /flash/i.test(id),
      // Gemini è multimodale; tra i Gemma solo la serie 3 (non "n") accetta immagini.
      imageInput: !gemma || /^gemma-3-(?!.*n)/.test(id),
      promptPerM: null,
      completionPerM: null,
      structuredOutput: !gemma,
      tools: !gemma,
    });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

let cache: { at: number; key: string; models: OpenRouterModel[] } | null = null;
const TTL = 3600 * 1000;

function keyError(status: number) {
  return status === 400 || status === 401 || status === 403
    ? new Error('GEMINI_INVALID_KEY')
    : new Error(`GEMINI_HTTP_${status}`);
}

export async function listGeminiModels(
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
  force = false,
) {
  if (!apiKey) throw new Error('GEMINI_NO_KEY');
  if (!force && cache && cache.key === apiKey && Date.now() - cache.at < TTL)
    return { models: cache.models, fetchedAt: cache.at };
  const res = await fetchImpl(`${geminiBase()}/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw keyError(res.status);
  cache = { at: Date.now(), key: apiKey, models: parseGeminiModels(await res.json()) };
  return { models: cache.models, fetchedAt: cache.at };
}

export function clearGeminiCache() {
  cache = null;
}

/** Verifica la chiave (Google non espone consumi o limiti: si controlla solo che funzioni). */
export async function checkGeminiKey(apiKey: string, fetchImpl: typeof fetch = fetch) {
  const { models } = await listGeminiModels(apiKey, fetchImpl, true);
  return { models: models.length };
}
