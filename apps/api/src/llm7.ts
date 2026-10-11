/**
 * Elenco dei modelli di LLM7 (API compatibile OpenAI, https://docs.llm7.io). La chiave è
 * facoltativa: senza si usa un segnaposto e valgono i limiti gratuiti più bassi.
 */
import type { OpenRouterModel } from './openrouter.js';

/** Sovrascrivibile con LLM7_BASE_URL (proxy o test). */
export const llm7Base = () =>
  (process.env.LLM7_BASE_URL ?? 'https://api.llm7.io/v1').replace(/\/$/, '');

/** Valore da inviare quando non c'è una chiave (LLM7 accetta qualsiasi testo). */
export const LLM7_NO_KEY = 'unused';

/** Modelli che non generano testo (immagini, voce, embedding). */
const EXCLUDED = /whisper|tts|embed|flux|sdxl|stable-diffusion|dall-?e|image-gen|moderation/i;

/** Normalizza l'elenco: accetta sia `{ data: [...] }` sia direttamente un array, di oggetti o testi. */
export function parseLlm7Models(body: unknown): OpenRouterModel[] {
  const list = Array.isArray(body) ? body : (body as { data?: unknown })?.data;
  if (!Array.isArray(list)) throw new Error('LLM7_BAD_RESPONSE');
  const models: OpenRouterModel[] = [];
  for (const raw of list as unknown[]) {
    const obj = typeof raw === 'string' ? { id: raw } : (raw as Record<string, unknown>);
    const id = typeof obj?.id === 'string' ? obj.id : typeof obj?.name === 'string' ? obj.name : '';
    if (!id || EXCLUDED.test(id)) continue;
    const context = obj.context_length ?? obj.context_window ?? obj.max_context_length;
    models.push({
      id,
      name: id,
      contextLength: typeof context === 'number' ? context : null,
      // L'elenco non dice quali modelli sono gratuiti né quali il tuo account può usare.
      free: false,
      priceUnknown: true,
      imageInput:
        /vision|vl\b|-vl|gpt-4o|gpt-4\.1|gemini|llava|pixtral|llama-4|mistral-small-3/i.test(id),
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

export async function listLlm7Models(
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
  force = false,
) {
  const key = apiKey || LLM7_NO_KEY;
  if (!force && cache && cache.key === key && Date.now() - cache.at < TTL)
    return { models: cache.models, fetchedAt: cache.at };
  const res = await fetchImpl(`${llm7Base()}/models`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('LLM7_INVALID_KEY');
  if (!res.ok) throw new Error(`LLM7_HTTP_${res.status}`);
  cache = { at: Date.now(), key, models: parseLlm7Models(await res.json()) };
  return { models: cache.models, fetchedAt: cache.at };
}

export function clearLlm7Cache() {
  cache = null;
}
