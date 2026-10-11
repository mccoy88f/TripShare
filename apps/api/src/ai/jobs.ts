import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import { aiChatMessage, aiConversation, aiJob, trip, user, type Database } from '@tripshare/db';
import { isLocale, type Locale } from '@tripshare/shared';
import { applyPlanOps, PlanOpError, type TripDocument } from '@tripshare/shared/trip-format';
import { listMembers } from '../services/members.js';
import type { AiEvent } from '../services/realtime.js';
import { activeMemberCount, readPlan } from '../services/plan.js';
import { computeLedgers } from '../services/trips.js';
import type { SettingsService } from '../settings.js';
import type { FileStorage } from '../storage.js';
import {
  AiAccessError,
  coolDown,
  failoverPause,
  orderByCooldown,
  resolveAiAccess,
  type AiAttempt,
} from './access.js';
import { AiError, complete, type ChatMessage } from './client.js';
import { runGeneration } from './generation.js';
import { replyFromPartialJson, throttleText } from './stream.js';
import { ocrReceipt } from '../services/receipt-ocr.js';
import type { ParsedReceipt } from '@tripshare/shared';
import {
  AiInputSchema,
  buildRepairMessage,
  buildTask,
  checkResult,
  PURPOSE,
  DocumentResultSchema,
  ReceiptResultSchema,
  type AiInput,
  type ChatResult,
  type RefineResult,
  type TaskContext,
  type VerifyResult,
} from './tasks.js';

export const AI_QUEUE = 'ai';
/** Lavori contemporanei per utente (in coda o in corso). */
const MAX_ACTIVE = 3;

export interface AiDeps {
  db: Database;
  settings: SettingsService;
  storage?: FileStorage;
  encryptionKey: string;
  appUrl: string;
  appName: string;
  /** SearXNG per le foto dei luoghi (facoltativo). */
  searxngUrl?: string;
  httpFetch?: typeof fetch;
  /** Accoda il lavoro al worker; senza coda il lavoro gira subito nel processo. */
  enqueue?: (jobId: string) => Promise<void>;
  /** Avvisa chi ha richiesto il lavoro quando finisce e, per la chat, man mano che risponde. */
  emit?: (event: AiEvent) => void;
  log?: (msg: string) => void;
}

export class AiJobError extends Error {}

/** Crea un lavoro AI dopo aver verificato accesso e limiti; lo accoda o lo esegue. */
export async function startAiJob(
  deps: AiDeps,
  userId: string,
  tripId: string | null,
  input: AiInput,
  options: { wait?: boolean } = {},
) {
  const parsed = AiInputSchema.parse(input);
  // Verifica subito chiave e quota, così l'errore arriva all'utente senza passare dal worker.
  // Gli scontrini si leggono anche senza AI (OCR): lì un'AI non disponibile non blocca.
  try {
    await resolveAiAccess(deps, userId, PURPOSE[parsed.kind]);
  } catch (err) {
    const ocrCanServe =
      (parsed.kind === 'receipt' || parsed.kind === 'document') &&
      parsed.engine !== 'ai' &&
      parsed.mime !== 'application/pdf' &&
      (await deps.settings.get('ocr.receipts'));
    if (err instanceof AiAccessError && !ocrCanServe) throw new AiJobError(err.message);
    if (!(err instanceof AiAccessError)) throw err;
  }
  const [active] = await deps.db
    .select({ n: count() })
    .from(aiJob)
    .where(and(eq(aiJob.userId, userId), inArray(aiJob.status, ['queued', 'running'])));
  if ((active?.n ?? 0) >= MAX_ACTIVE) throw new AiJobError('AI_TOO_MANY_JOBS');

  const [row] = await deps.db
    .insert(aiJob)
    .values({ userId, tripId, kind: parsed.kind, input: parsed, status: 'queued' })
    .returning({ id: aiJob.id });
  const id = row!.id;
  if (deps.enqueue && !options.wait) await deps.enqueue(id);
  else if (options.wait) await processAiJob(deps, id);
  else
    void processAiJob(deps, id).catch((err: unknown) =>
      deps.log?.(`[ai] lavoro ${id}: ${String(err)}`),
    );
  return { id };
}

async function fileDataUrl(storage: FileStorage | undefined, name: string, mime: string) {
  const data = await storage?.readPrivate(name);
  if (!data) throw new AiJobError('AI_FILE_NOT_FOUND');
  if (mime === 'application/pdf') return `data:application/pdf;base64,${data.toString('base64')}`;
  // Le foto vengono ridotte: bastano 1600 px per leggere uno scontrino e costano meno token.
  const jpeg = await sharp(data, { failOn: 'error', limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
    .catch(() => {
      throw new AiJobError('AI_INVALID_IMAGE');
    });
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/** Dati dell'elemento che l'utente vuole cambiare, con il contesto che serve a capirlo. */
function describeTarget(plan: TripDocument, target: { type: string; id: string }) {
  const found = (v: unknown) => {
    if (!v) throw new AiJobError('TARGET_NOT_FOUND');
    return v;
  };
  switch (target.type) {
    case 'activity': {
      const day = plan.days.find((d) => d.activities.some((a) => a.id === target.id));
      const activity = day?.activities.find((a) => a.id === target.id);
      found(activity);
      return {
        type: 'activity',
        date: day!.date,
        activity,
        sameDay: day!.activities.map((a) => ({ id: a.id, time: a.time, title: a.title })),
      };
    }
    case 'place': {
      const place = found(plan.places.find((p) => p.id === target.id));
      return {
        type: 'place',
        place,
        usedIn: plan.days.flatMap((d) =>
          d.activities
            .filter((a) => a.placeIds.includes(target.id))
            .map((a) => ({ date: d.date, activityId: a.id, title: a.title })),
        ),
      };
    }
    case 'booking': {
      const booking = found(plan.bookings.find((b) => b.id === target.id));
      return {
        type: 'booking',
        booking,
        budgetItems: plan.budget.filter((b) => b.bookingId === target.id).map((b) => b.id),
        days: plan.days.filter((d) => d.stayBookingId === target.id).map((d) => d.date),
      };
    }
    case 'day':
      return { type: 'day', day: found(plan.days.find((d) => d.date === target.id)) };
    case 'budget':
      return { type: 'budget', item: found(plan.budget.find((b) => b.id === target.id)) };
    case 'tips':
      return { type: 'tips', focus: target.id, tips: plan.tips };
    default:
      return {
        type: 'packing',
        item: found(plan.packing.find((p) => p.id === target.id || p.item === target.id)),
      };
  }
}

async function loadTripContext(db: Database, tripId: string, locale: Locale, userId: string) {
  const [row] = await db.select().from(trip).where(eq(trip.id, tripId));
  if (!row) throw new AiJobError('TRIP_NOT_FOUND');
  const [members, count, ledgers] = await Promise.all([
    listMembers(db, tripId),
    activeMemberCount(db, tripId),
    computeLedgers(db, [tripId]),
  ]);
  const plan = readPlan(row, count, locale);
  const ledger = ledgers.get(tripId);
  const active = members.filter((m) => !m.removed);
  return {
    plan,
    extra: {
      group: active.map((m) => m.name),
      me: active.find((m) => m.userId === userId)?.name,
      spentSoFar: ledger ? { amountMinor: ledger.total, currency: row.currency } : undefined,
      brief: row.brief ?? undefined,
      guidelines: (row.generation as { strategy?: { guidelines?: string[] } } | null)?.strategy
        ?.guidelines,
    },
  };
}

/** Risultato di una chiamata al modello già validata, con i consumi. */
interface SpecRun {
  value: unknown;
  citations: { url: string; title?: string }[];
  model: string | null;
  /** Provider della configurazione che ha risposto. */
  provider: string;
  promptTokens: number;
  completionTokens: number;
  cost: number | null;
}

/** Chiama il modello per un compito e ripete con le correzioni finché la risposta è valida. */
export async function runSpec(
  deps: AiDeps,
  access: Awaited<ReturnType<typeof resolveAiAccess>>,
  spec: ReturnType<typeof buildTask>,
  locale: Locale,
  /** Testo grezzo della risposta scritto finora (si ricomincia a ogni nuovo tentativo). */
  onText?: (text: string) => void,
  /** Tentativi falliti delle configurazioni scartate (per il registro del lavoro). */
  trail: AiAttempt[] = [],
): Promise<SpecRun> {
  const messages: ChatMessage[] = [...spec.messages];
  const out = { value: null as unknown, model: access.model as string | null };
  let citations: { url: string; title?: string }[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let cost: number | null = null;

  // Configurazioni in ordine; se una fallisce per colpa sua si passa alla successiva e si
  // continua con quella (anche per le correzioni successive).
  const order = orderByCooldown(access.candidates);
  let current = 0;
  const completeWithRouting = async () => {
    for (;;) {
      const c = order[current]!;
      const started = performance.now();
      try {
        return await complete({
          provider: c.provider,
          apiKey: c.apiKey,
          model: c.model,
          fallbacks: c.fallbacks,
          messages,
          jsonSchema: { name: spec.schemaName, schema: spec.jsonSchema },
          web: spec.web,
          denyDataCollection: access.denyDataCollection,
          appUrl: deps.appUrl,
          appName: deps.appName,
          fetchImpl: deps.httpFetch,
          onDelta: onText,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const pause = failoverPause(err);
        trail.push({
          profile: c.name,
          provider: c.provider,
          model: c.model,
          error: message.slice(0, 500),
          ms: Math.round(performance.now() - started),
        });
        deps.log?.(`[ai] configurazione "${c.name}" (${c.provider}, ${c.model}): ${message}`);
        if (pause === null) throw err;
        coolDown(c.id, pause);
        if (current >= order.length - 1) throw err;
        current++;
        // Il testo mostrato finora apparteneva al tentativo fallito.
        onText?.('');
      }
    }
  };

  for (let attempt = 0; ; attempt++) {
    const res = await completeWithRouting();
    out.model = res.model;
    promptTokens += res.promptTokens ?? 0;
    completionTokens += res.completionTokens ?? 0;
    if (res.cost !== null) cost = (cost ?? 0) + res.cost;
    if (res.citations) citations = res.citations;
    const checked = checkResult(spec, res.content);
    if ('value' in checked) {
      out.value = checked.value;
      break;
    }
    if (attempt >= spec.repairs) throw new AiJobError('AI_INVALID_RESPONSE');
    messages.push({ role: 'assistant', content: res.content });
    messages.push(buildRepairMessage(checked.issues, locale));
  }
  return {
    value: out.value,
    citations,
    model: out.model,
    provider: order[current]!.provider,
    promptTokens,
    completionTokens,
    cost,
  };
}

/**
 * Parole di un documento che non è un semplice scontrino (conferme di voli, hotel, biglietti):
 * lì serve capire che cos'è e che cosa creare, quindi si passa all'AI.
 */
const BOOKING_HINT =
  /\b(?:volo|voli|flight|boarding|imbarco|check[- ]?in|check[- ]?out|pnr|prenotazion[ei]|booking|reservation|e-?ticket|passeggero|passenger|andata|ritorno|partenza|arrivo|soggiorno|pernottamento|noleggio|itinerario|itinerary)\b/i;

/** Lo scontrino letto dall'OCR nella forma che l'app si aspetta per quel tipo di lavoro. */
function ocrResult(kind: 'receipt' | 'document', receipt: ParsedReceipt) {
  if (kind === 'receipt') return ReceiptResultSchema.parse(receipt);
  return DocumentResultSchema.parse({
    documentType: 'receipt',
    summary: `Scontrino${receipt.merchant ? ` · ${receipt.merchant}` : ''}`.slice(0, 300),
    expense: {
      title: receipt.title,
      ...(receipt.merchant ? { merchant: receipt.merchant } : {}),
      ...(receipt.date ? { date: receipt.date } : {}),
      total: receipt.total,
      currency: receipt.currency,
      category: receipt.category,
      emoji: receipt.emoji,
      status: 'paid',
      items: receipt.items.map(({ name, amount }) => ({ name, amount })),
    },
    bookings: [],
    places: [],
    confidence: receipt.confidence,
    ...(receipt.notes ? { notes: receipt.notes.slice(0, 400) } : {}),
  });
}

/** Chiude un lavoro "scontrino" o "documento" con il risultato dell'OCR: niente AI, niente quota. */
async function finishWithOcr(
  db: Database,
  jobId: string,
  kind: 'receipt' | 'document',
  receipt: ParsedReceipt,
) {
  const result = ocrResult(kind, receipt);
  await db
    .update(aiJob)
    .set({
      status: 'done',
      result: { ...result, source: 'ocr' },
      provider: 'ocr',
      model: 'tesseract',
      keySource: null,
      finishedAt: new Date(),
    })
    .where(eq(aiJob.id, jobId));
}

/** Gli ultimi messaggi di una chat (dal più vecchio), per dare contesto al modello. */
async function loadChatHistory(
  db: Database,
  tripId: string,
  userId: string,
  conversationId?: string,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const rows = await db
    .select({ role: aiChatMessage.role, content: aiChatMessage.content })
    .from(aiChatMessage)
    .where(
      and(
        eq(aiChatMessage.tripId, tripId),
        eq(aiChatMessage.userId, userId),
        conversationId
          ? eq(aiChatMessage.conversationId, conversationId)
          : isNull(aiChatMessage.conversationId),
      ),
    )
    .orderBy(desc(aiChatMessage.createdAt))
    .limit(12);
  return rows
    .reverse()
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
}

/** Esegue un lavoro: chiama il modello, valida la risposta (con correzioni) e salva il risultato. */
export async function processAiJob(deps: AiDeps, jobId: string) {
  await runAiJob(deps, jobId);
  if (!deps.emit) return;
  // Chi aspetta il risultato lo riceve subito, senza dover chiedere.
  const [row] = await deps.db
    .select({ userId: aiJob.userId, status: aiJob.status, error: aiJob.error })
    .from(aiJob)
    .where(eq(aiJob.id, jobId));
  if (row?.status === 'done') deps.emit({ userId: row.userId, jobId, phase: 'done' });
  else if (row?.status === 'error')
    deps.emit({ userId: row.userId, jobId, phase: 'error', error: row.error ?? 'AI_FAILED' });
}

async function runAiJob(deps: AiDeps, jobId: string) {
  const { db } = deps;
  const [job] = await db.select().from(aiJob).where(eq(aiJob.id, jobId));
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
  await db.update(aiJob).set({ status: 'running' }).where(eq(aiJob.id, jobId));

  let promptTokens = 0;
  let completionTokens = 0;
  let cost: number | null = null;
  let model: string | null = null;
  let provider: string | null = null;
  let keySource: string | null = null;
  const trail: AiAttempt[] = [];
  try {
    const input = AiInputSchema.parse(job.input);
    const [owner] = await db
      .select({ locale: user.locale })
      .from(user)
      .where(eq(user.id, job.userId));
    const locale: Locale = owner?.locale && isLocale(owner.locale) ? owner.locale : 'it';
    // Scontrino: prima l'OCR (gratis, senza AI). Se il risultato è sicuro il lavoro finisce qui;
    // altrimenti si passa all'AI e, se non c'è, si offre comunque la lettura incerta.
    let ocrPartial: ParsedReceipt | null = null;
    if (
      (input.kind === 'receipt' || input.kind === 'document') &&
      input.engine !== 'ai' &&
      input.mime !== 'application/pdf' &&
      (await deps.settings.get('ocr.receipts'))
    ) {
      const data = await deps.storage?.readPrivate(input.file);
      if (data) {
        try {
          const read = await ocrReceipt(data, { currency: input.tripCurrency });
          // Un "documento" può essere una conferma di volo o di hotel: se il testo lo fa pensare
          // non è uno scontrino semplice e lo legge l'AI.
          const plainReceipt = input.kind === 'receipt' || !(read && BOOKING_HINT.test(read.text));
          if (read && plainReceipt && read.receipt.confidence === 'high') {
            await finishWithOcr(db, jobId, input.kind, read.receipt);
            return;
          }
          ocrPartial = read && plainReceipt ? read.receipt : null;
        } catch (err) {
          deps.log?.(`[ocr] lavoro ${jobId}: ${String(err)}`);
        }
      }
    }
    let access: Awaited<ReturnType<typeof resolveAiAccess>>;
    try {
      access = await resolveAiAccess(deps, job.userId, PURPOSE[input.kind]);
    } catch (err) {
      if (ocrPartial && err instanceof AiAccessError) {
        await finishWithOcr(db, jobId, input.kind as 'receipt' | 'document', ocrPartial);
        return;
      }
      throw err;
    }
    provider = access.provider;
    model = access.model;
    keySource = access.source;

    const ctx: TaskContext = { locale };
    let plan: TripDocument | undefined;
    if (job.tripId && input.kind !== 'generate' && input.kind !== 'generateTrip') {
      const t = await loadTripContext(db, job.tripId, locale, job.userId);
      plan = t.plan;
      ctx.plan = plan;
      ctx.extra = t.extra;
      if (input.kind === 'refine')
        ctx.extra = { ...t.extra, target: describeTarget(plan, input.target) };
    }
    if (input.kind === 'receipt' || input.kind === 'booking' || input.kind === 'document')
      ctx.fileDataUrl = await fileDataUrl(deps.storage, input.file, input.mime);
    if (input.kind === 'refine' && job.tripId && input.conversationId)
      ctx.history = await loadChatHistory(db, job.tripId, job.userId, input.conversationId);
    if (input.kind === 'chat') {
      if (!job.tripId) throw new AiJobError('TRIP_NOT_FOUND');
      ctx.history = await loadChatHistory(db, job.tripId, job.userId, input.conversationId);
      await db.insert(aiChatMessage).values({
        tripId: job.tripId,
        userId: job.userId,
        conversationId: input.conversationId ?? null,
        role: 'user',
        content: input.message,
      });
    }

    if (input.kind === 'generateTrip') {
      if (!job.tripId) throw new AiJobError('TRIP_NOT_FOUND');
      const out = await runGeneration(deps, {
        userId: job.userId,
        tripId: job.tripId,
        locale,
        access,
        from: input.from,
        until: input.until,
        keep: input.keep,
        skip: input.skip,
      });
      model = out.model;
      promptTokens = out.promptTokens;
      completionTokens = out.completionTokens;
      cost = out.cost;
      await db
        .update(aiJob)
        .set({
          status: 'done',
          result: { failedStep: out.failedStep ?? null },
          model,
          provider,
          keySource,
          promptTokens,
          completionTokens,
          cost,
          finishedAt: new Date(),
        })
        .where(eq(aiJob.id, jobId));
      return;
    }

    const spec = buildTask(input, ctx);
    if ((input.kind === 'chat' || input.kind === 'refine') && plan) {
      // Le modifiche proposte devono potersi applicare davvero al programma attuale.
      const base = plan;
      const own = spec.validate;
      spec.validate = (value) => {
        const issues = own?.(value);
        if (issues?.length) return issues;
        try {
          applyPlanOps(base, (value as ChatResult | RefineResult).actions);
          return null;
        } catch (err) {
          return [
            {
              path: 'actions',
              message: err instanceof PlanOpError || err instanceof Error ? err.message : 'invalid',
            },
          ];
        }
      };
    }

    // Nella chat la risposta si vede mentre il modello la scrive.
    const streaming =
      input.kind === 'chat' && deps.emit
        ? throttleText((raw) => {
            const reply = replyFromPartialJson(raw);
            if (reply) deps.emit!({ userId: job.userId, jobId, phase: 'delta', text: reply });
          })
        : undefined;
    const run = await runSpec(deps, access, spec, locale, streaming, trail);
    model = run.model;
    provider = run.provider;
    promptTokens += run.promptTokens;
    completionTokens += run.completionTokens;
    if (run.cost !== null) cost = (cost ?? 0) + run.cost;
    const value = run.value;
    const citations = run.citations;

    if (input.kind === 'verify') {
      const v = value as VerifyResult;
      if (v.sources.length === 0 && citations.length)
        v.sources = citations.slice(0, 5).map((c) => ({ title: c.title ?? c.url, url: c.url }));
    }
    let result: unknown =
      input.kind === 'receipt' || input.kind === 'document'
        ? { ...(value as object), source: 'ai' }
        : value;
    if (input.kind === 'refine' && job.tripId && input.conversationId) {
      // La richiesta resta nella chat del viaggio: Nina la ricorda e si può continuare lì.
      const refined = value as RefineResult;
      const asked = input.label ? `«${input.label}»: ${input.instruction}` : input.instruction;
      await db.insert(aiChatMessage).values({
        tripId: job.tripId,
        userId: job.userId,
        conversationId: input.conversationId,
        role: 'user',
        content: asked,
      });
      const [msg] = await db
        .insert(aiChatMessage)
        .values({
          tripId: job.tripId,
          userId: job.userId,
          conversationId: input.conversationId,
          role: 'assistant',
          content: refined.summary,
          actions: refined.actions.length ? refined.actions : null,
        })
        .returning({ id: aiChatMessage.id });
      await db
        .update(aiConversation)
        .set({ updatedAt: new Date() })
        .where(eq(aiConversation.id, input.conversationId));
      result = { ...refined, messageId: msg!.id, conversationId: input.conversationId };
    }
    if (input.kind === 'chat') {
      const chat = value as ChatResult;
      const [msg] = await db
        .insert(aiChatMessage)
        .values({
          tripId: job.tripId!,
          userId: job.userId,
          conversationId: input.conversationId ?? null,
          role: 'assistant',
          content: chat.reply,
          actions: chat.actions.length ? chat.actions : null,
          expenses: chat.expenses.length ? chat.expenses : null,
        })
        .returning({ id: aiChatMessage.id });
      result = { ...chat, messageId: msg!.id };
      if (input.conversationId)
        await db
          .update(aiConversation)
          .set({ updatedAt: new Date() })
          .where(eq(aiConversation.id, input.conversationId));
    }
    await db
      .update(aiJob)
      .set({
        status: 'done',
        result: result as object,
        model,
        provider,
        keySource,
        attempts: trail.length ? trail : null,
        promptTokens,
        completionTokens,
        cost,
        finishedAt: new Date(),
      })
      .where(eq(aiJob.id, jobId));
  } catch (err) {
    const code =
      err instanceof AiJobError || err instanceof AiAccessError || err instanceof AiError
        ? err.message
        : 'AI_FAILED';
    deps.log?.(`[ai] lavoro ${jobId} (${job.kind}) non riuscito: ${String(err)}`);
    await db
      .update(aiJob)
      .set({
        status: 'error',
        error: code.slice(0, 500),
        model,
        provider,
        keySource,
        attempts: trail.length ? trail : null,
        promptTokens: promptTokens || null,
        completionTokens: completionTokens || null,
        cost,
        finishedAt: new Date(),
      })
      .where(eq(aiJob.id, jobId));
  }
}

/** Messaggi di una conversazione con l'assistente (dal più vecchio). */
export async function chatHistory(
  db: Database,
  tripId: string,
  userId: string,
  conversationId: string,
) {
  const rows = await db
    .select()
    .from(aiChatMessage)
    .where(
      and(
        eq(aiChatMessage.tripId, tripId),
        eq(aiChatMessage.userId, userId),
        eq(aiChatMessage.conversationId, conversationId),
      ),
    )
    .orderBy(desc(aiChatMessage.createdAt))
    .limit(100);
  return rows.reverse();
}
