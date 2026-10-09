/**
 * Chiamata al modello: OpenRouter (API compatibile OpenAI) oppure Google Gemini (API nativa).
 * Restituisce testo, modello effettivo, token e costi.
 */
import { geminiBase } from '../gemini.js';

export type AiProvider = 'openrouter' | 'gemini';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface CompletionRequest {
  provider?: AiProvider;
  apiKey: string;
  model: string;
  fallbacks?: string[];
  messages: ChatMessage[];
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  web?: boolean;
  denyDataCollection?: boolean;
  appUrl: string;
  appName: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface CompletionResult {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number | null;
  /** Fonti trovate dalla ricerca web (solo Gemini con Google Search). */
  citations?: { url: string; title?: string }[];
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const base = () =>
  (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  return req.provider === 'gemini' ? completeGemini(req) : completeOpenRouter(req);
}

async function completeOpenRouter(req: CompletionRequest): Promise<CompletionResult> {
  const models = [req.model, ...(req.fallbacks ?? [])].filter((m, i, a) => m && a.indexOf(m) === i);
  const body: Record<string, unknown> = {
    model: models[0],
    ...(models.length > 1 ? { models } : {}),
    messages: req.messages,
    usage: { include: true },
    ...(req.jsonSchema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: req.jsonSchema.name,
              strict: false,
              schema: req.jsonSchema.schema,
            },
          },
        }
      : {}),
    ...(req.web ? { plugins: [{ id: 'web', max_results: 5 }] } : {}),
    ...(req.denyDataCollection ? { provider: { data_collection: 'deny' } } : {}),
  };
  const res = await (req.fetchImpl ?? fetch)(`${base()}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${req.apiKey}`,
      'content-type': 'application/json',
      'http-referer': req.appUrl,
      'x-title': req.appName,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(req.timeoutMs ?? 240_000),
  });
  const json = (await res.json().catch(() => null)) as {
    model?: string;
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string; code?: number };
  } | null;
  if (!res.ok || !json || json.error) {
    const message = json?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new AiError('AI_INVALID_KEY', 401);
    if (res.status === 402) throw new AiError('AI_NO_CREDIT', 402);
    if (res.status === 429) throw new AiError('AI_RATE_LIMITED', 429);
    throw new AiError(`AI_PROVIDER_ERROR: ${message}`.slice(0, 500), res.status);
  }
  const content = json.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new AiError('AI_EMPTY_RESPONSE');
  return {
    content,
    model: json.model ?? models[0]!,
    promptTokens: json.usage?.prompt_tokens ?? null,
    completionTokens: json.usage?.completion_tokens ?? null,
    cost: json.usage?.cost ?? null,
  };
}

// ─── Gemini ─────────────────────────────────────────────────────────────────

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

/** "data:image/jpeg;base64,AAAA" → parte in linea di Gemini. */
function inlinePart(dataUrl: string): GeminiPart {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return { text: dataUrl };
  return { inline_data: { mime_type: match[1]!, data: match[2]! } };
}

function toGeminiParts(content: ChatMessage['content']): GeminiPart[] {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((p) =>
    p.type === 'text'
      ? { text: p.text }
      : p.type === 'image_url'
        ? inlinePart(p.image_url.url)
        : inlinePart(p.file.file_data),
  );
}

/** Rimuove dallo schema le parole chiave che Gemini non accetta. */
function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema' || k === '$id') continue;
    out[k] = geminiSchema(v);
  }
  return out;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string; code?: number };
}

async function completeGemini(req: CompletionRequest): Promise<CompletionResult> {
  const models = [req.model, ...(req.fallbacks ?? [])].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastError: AiError | null = null;
  for (const model of models) {
    try {
      return await callGemini(req, model);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      lastError = err;
      // Chiave non valida: inutile provare altri modelli.
      if (err.message === 'AI_INVALID_KEY') throw err;
    }
  }
  throw lastError ?? new AiError('AI_PROVIDER_ERROR');
}

async function callGemini(req: CompletionRequest, model: string): Promise<CompletionResult> {
  // I modelli Gemma non hanno istruzioni di sistema né output JSON vincolato.
  const gemma = model.startsWith('gemma');
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n\n');
  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: toGeminiParts(m.content),
    }));
  if (gemma && system && contents[0]) contents[0].parts.unshift({ text: system });
  // La ricerca Google non si combina con l'output JSON vincolato: in quel caso il JSON si
  // chiede nel prompt e si estrae dalla risposta.
  const jsonMode = !!req.jsonSchema && !req.web && !gemma;
  const body = {
    ...(system && !gemma ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: {
      ...(jsonMode
        ? {
            responseMimeType: 'application/json',
            responseJsonSchema: geminiSchema(req.jsonSchema!.schema),
          }
        : {}),
    },
    ...(req.web ? { tools: [{ google_search: {} }] } : {}),
  };
  const res = await (req.fetchImpl ?? fetch)(
    `${geminiBase()}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': req.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs ?? 240_000),
    },
  );
  const json = (await res.json().catch(() => null)) as GeminiResponse | null;
  if (!res.ok || !json || json.error) {
    const message = json?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403 || /API key/i.test(message))
      throw new AiError('AI_INVALID_KEY', res.status);
    if (res.status === 429) throw new AiError('AI_RATE_LIMITED', 429);
    throw new AiError(`AI_PROVIDER_ERROR: ${message}`.slice(0, 500), res.status);
  }
  if (json.promptFeedback?.blockReason) throw new AiError('AI_BLOCKED');
  const candidate = json.candidates?.[0];
  const content = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (!content.trim()) throw new AiError('AI_EMPTY_RESPONSE');
  const usage = json.usageMetadata;
  const citations = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .map((c) => c.web)
    .filter((w): w is { uri: string; title?: string } => typeof w?.uri === 'string')
    .map((w) => ({ url: w.uri, ...(w.title ? { title: w.title } : {}) }));
  return {
    content,
    model: json.modelVersion ?? model,
    promptTokens: usage?.promptTokenCount ?? null,
    completionTokens:
      usage?.candidatesTokenCount !== undefined
        ? usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0)
        : null,
    cost: null,
    ...(citations.length ? { citations } : {}),
  };
}
