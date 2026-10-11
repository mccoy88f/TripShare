/**
 * Elenco dei modelli di NVIDIA NIM (build.nvidia.com, API compatibile OpenAI). Il piano gratuito
 * dà crediti e limiti di richieste: i modelli si segnano "gratis" come stima, senza prezzi.
 */
import type { OpenRouterModel } from './openrouter.js';

/** Sovrascrivibile con NVIDIA_BASE_URL (NIM installato in proprio, proxy o test). */
export const nvidiaBase = () =>
  (process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');

/** Modelli che non generano testo (embedding, riordino, moderazione, voce, immagini). */
const EXCLUDED =
  /embed|rerank|retriev|guard|reward|safety|clip|parakeet|whisper|tts|riva|cosmos|stable-diffusion|flux|sdxl|ocr|vqa|paddle|nemoguard|topic-control|content-safety/i;

/** Modelli che accettano immagini in input. */
const VISION =
  /vision|-vl\b|vl-|vila|llama-3\.2-(11|90)b|llama-4|phi-3.*vision|phi-4-multimodal|gemma-3|pixtral|neva|fuyu|kosmos/i;

interface RawNvidiaModel {
  id?: unknown;
}

/** Normalizza l'elenco nello stesso formato di OpenRouter. */
export function parseNvidiaModels(body: unknown): OpenRouterModel[] {
  const list = (body as { data?: unknown })?.data;
  if (!Array.isArray(list)) throw new Error('NVIDIA_BAD_RESPONSE');
  const models: OpenRouterModel[] = [];
  for (const raw of list as RawNvidiaModel[]) {
    if (typeof raw.id !== 'string' || EXCLUDED.test(raw.id)) continue;
    models.push({
      id: raw.id,
      name: raw.id,
      contextLength: null,
      free: true,
      imageInput: VISION.test(raw.id),
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

export async function listNvidiaModels(
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
  force = false,
) {
  if (!apiKey) throw new Error('NVIDIA_NO_KEY');
  if (!force && cache && cache.key === apiKey && Date.now() - cache.at < TTL)
    return { models: cache.models, fetchedAt: cache.at };
  const res = await fetchImpl(`${nvidiaBase()}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('NVIDIA_INVALID_KEY');
  if (!res.ok) throw new Error(`NVIDIA_HTTP_${res.status}`);
  cache = { at: Date.now(), key: apiKey, models: parseNvidiaModels(await res.json()) };
  return { models: cache.models, fetchedAt: cache.at };
}

export function clearNvidiaCache() {
  cache = null;
}
