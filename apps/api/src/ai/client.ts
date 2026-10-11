/**
 * Chiamata al modello: OpenRouter, Groq e LLM7 (API compatibili OpenAI) oppure Google Gemini (API nativa).
 * Restituisce testo, modello effettivo, token e costi.
 */
import { geminiBase } from '../gemini.js';
import { groqBase } from '../groq.js';
import { llm7Base } from '../llm7.js';

export type AiProvider = 'openrouter' | 'gemini' | 'groq' | 'llm7';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

interface CompletionRequest {
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
  /**
   * Se presente la risposta si legge man mano che il modello la scrive e a ogni pezzo si
   * chiama la funzione con il testo completo scritto finora.
   */
  onDelta?: (textSoFar: string) => void;
}

interface CompletionResult {
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

const isEventStream = (res: Response) =>
  (res.headers.get('content-type') ?? '').includes('text/event-stream');

/** Legge un flusso Server-Sent Events e restituisce il contenuto di ogni riga `data:`. */
async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i).replace(/\r$/, '');
      buffer = buffer.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith('data:')) yield rest.slice(5).trim();
}

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  if (req.provider === 'gemini') return completeGemini(req);
  if (req.provider === 'groq') return completeCompatible(req, 'Groq', groqBase(), true);
  if (req.provider === 'llm7') return completeCompatible(req, 'LLM7', llm7Base(), false);
  return completeOpenRouter(req);
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
    ...(req.onDelta ? { stream: true } : {}),
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
  if (res.ok && req.onDelta && isEventStream(res))
    return readOpenRouterStream(res, models[0]!, req.onDelta);
  const json = (await res.json().catch(() => null)) as {
    model?: string;
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string; code?: number };
  } | null;
  if (!res.ok || !json || json.error) {
    const message = json?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new AiError(`AI_INVALID_KEY: ${message}`.slice(0, 500), 401);
    if (res.status === 402) throw new AiError(`AI_NO_CREDIT: ${message}`.slice(0, 500), 402);
    if (res.status === 429) throw new AiError(`AI_RATE_LIMITED: ${message}`.slice(0, 500), 429);
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

/** Risposta di OpenRouter in streaming: il testo arriva a pezzi, i consumi nell'ultimo. */
async function readOpenRouterStream(
  res: Response,
  requested: string,
  onDelta: (text: string) => void,
): Promise<CompletionResult> {
  let content = '';
  let model: string | undefined;
  let usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
  for await (const data of sseData(res)) {
    if (data === '[DONE]') break;
    let chunk: {
      model?: string;
      choices?: { delta?: { content?: string | null } }[];
      usage?: typeof usage;
      /** Groq riporta i consumi qui, nell'ultimo pezzo. */
      x_groq?: { usage?: typeof usage };
      error?: { message?: string; code?: number };
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    if (chunk.error) {
      const message = chunk.error.message ?? 'stream error';
      if (chunk.error.code === 429)
        throw new AiError(`AI_RATE_LIMITED: ${message}`.slice(0, 500), 429);
      throw new AiError(`AI_PROVIDER_ERROR: ${message}`.slice(0, 500), chunk.error.code);
    }
    model = chunk.model ?? model;
    if (chunk.usage ?? chunk.x_groq?.usage) usage = chunk.usage ?? chunk.x_groq?.usage;
    const piece = chunk.choices?.[0]?.delta?.content;
    if (piece) {
      content += piece;
      onDelta(content);
    }
  }
  if (!content.trim()) throw new AiError('AI_EMPTY_RESPONSE');
  return {
    content,
    model: model ?? requested,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    cost: usage?.cost ?? null,
  };
}

// ─── Provider compatibili OpenAI (Groq, LLM7) ───────────────────────────────

/**
 * Provider con la stessa API di OpenAI: i modelli di riserva si provano uno alla volta.
 * `jsonMode` chiede al provider un JSON valido (la struttura vera è nel prompt).
 */
async function completeCompatible(
  req: CompletionRequest,
  provider: string,
  baseUrl: string,
  jsonMode: boolean,
): Promise<CompletionResult> {
  const models = [req.model, ...(req.fallbacks ?? [])].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastError: AiError | null = null;
  for (const model of models) {
    try {
      return await callCompatible(req, model, provider, baseUrl, jsonMode);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      lastError = err;
      // Chiave non valida o input non gestito: un altro modello non cambia nulla.
      if (
        err.message.startsWith('AI_INVALID_KEY') ||
        err.message.startsWith('AI_UNSUPPORTED_INPUT')
      )
        throw err;
    }
  }
  throw lastError ?? new AiError('AI_PROVIDER_ERROR');
}

async function callCompatible(
  req: CompletionRequest,
  model: string,
  provider: string,
  baseUrl: string,
  jsonMode: boolean,
): Promise<CompletionResult> {
  // Questi provider non leggono i PDF in linea: il lavoro passa a un'altra configurazione.
  const hasFile = req.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'file'),
  );
  if (hasFile) throw new AiError(`AI_UNSUPPORTED_INPUT: PDF non supportati da ${provider}`);
  const body = {
    model,
    messages: req.messages,
    ...(jsonMode && req.jsonSchema ? { response_format: { type: 'json_object' } } : {}),
    ...(req.onDelta ? { stream: true } : {}),
  };
  const res = await (req.fetchImpl ?? fetch)(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${req.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(req.timeoutMs ?? 240_000),
  });
  if (res.ok && req.onDelta && isEventStream(res))
    return readOpenRouterStream(res, model, req.onDelta);
  const json = (await res.json().catch(() => null)) as {
    model?: string;
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string; code?: string } | string;
  } | null;
  if (!res.ok || !json || json.error) {
    const detail = typeof json?.error === 'string' ? json.error : json?.error?.message;
    const message = detail ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new AiError(`AI_INVALID_KEY: ${message}`.slice(0, 500), 401);
    if (res.status === 429) throw new AiError(`AI_RATE_LIMITED: ${message}`.slice(0, 500), 429);
    throw new AiError(`AI_PROVIDER_ERROR: ${message}`.slice(0, 500), res.status);
  }
  const content = json.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new AiError('AI_EMPTY_RESPONSE');
  return {
    content,
    model: json.model ?? model,
    promptTokens: json.usage?.prompt_tokens ?? null,
    completionTokens: json.usage?.completion_tokens ?? null,
    cost: null,
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
      if (err.message.startsWith('AI_INVALID_KEY')) throw err;
    }
  }
  throw lastError ?? new AiError('AI_PROVIDER_ERROR');
}

/** Unisce i pezzi di una risposta Gemini in streaming in una risposta come quella completa. */
async function readGeminiStream(
  res: Response,
  onDelta: (text: string) => void,
): Promise<GeminiResponse> {
  let text = '';
  const merged: GeminiResponse = {};
  const chunks: { web?: { uri?: string; title?: string } }[] = [];
  let finishReason: string | undefined;
  for await (const data of sseData(res)) {
    let part: GeminiResponse;
    try {
      part = JSON.parse(data) as GeminiResponse;
    } catch {
      continue;
    }
    if (part.error) {
      merged.error = part.error;
      break;
    }
    if (part.promptFeedback?.blockReason) merged.promptFeedback = part.promptFeedback;
    if (part.usageMetadata) merged.usageMetadata = part.usageMetadata;
    if (part.modelVersion) merged.modelVersion = part.modelVersion;
    const candidate = part.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    chunks.push(...(candidate?.groundingMetadata?.groundingChunks ?? []));
    const piece = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    if (piece) {
      text += piece;
      onDelta(text);
    }
  }
  merged.candidates = [
    {
      content: { parts: [{ text }] },
      finishReason,
      groundingMetadata: { groundingChunks: chunks },
    },
  ];
  return merged;
}

async function callGemini(
  req: CompletionRequest,
  model: string,
  jsonOutput = true,
): Promise<CompletionResult> {
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
  // Lo schema della risposta è già nel prompt e la risposta viene validata (e corretta) dopo:
  // a Gemini si chiede solo "JSON", senza responseJsonSchema, che rifiuta gli schemi grandi
  // come quello del viaggio. La ricerca Google non si combina con l'output JSON.
  const jsonMode = jsonOutput && !!req.jsonSchema && !req.web && !gemma;
  const body = {
    ...(system && !gemma ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: {
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
    ...(req.web ? { tools: [{ google_search: {} }] } : {}),
  };
  const res = await (req.fetchImpl ?? fetch)(
    `${geminiBase()}/models/${encodeURIComponent(model)}:${
      req.onDelta ? 'streamGenerateContent?alt=sse' : 'generateContent'
    }`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': req.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs ?? 240_000),
    },
  );
  const json =
    res.ok && req.onDelta && isEventStream(res)
      ? await readGeminiStream(res, req.onDelta)
      : ((await res.json().catch(() => null)) as GeminiResponse | null);
  if (!res.ok || !json || json.error) {
    const message = json?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403 || /API key/i.test(message))
      throw new AiError(`AI_INVALID_KEY: ${message}`.slice(0, 500), res.status);
    if (res.status === 429) throw new AiError(`AI_RATE_LIMITED: ${message}`.slice(0, 500), 429);
    // Alcuni modelli non accettano l'output JSON: si riprova chiedendolo solo nel prompt.
    if (res.status === 400 && jsonMode) return callGemini(req, model, false);
    throw new AiError(`AI_PROVIDER_ERROR: ${message}`.slice(0, 500), res.status);
  }
  if (json.promptFeedback?.blockReason) throw new AiError('AI_BLOCKED');
  const candidate = json.candidates?.[0];
  const content = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (!content.trim())
    throw new AiError(`AI_EMPTY_RESPONSE: ${candidate?.finishReason ?? 'no candidates'}`);
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
