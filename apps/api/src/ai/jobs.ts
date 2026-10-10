import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import { aiChatMessage, aiConversation, aiJob, trip, user, type Database } from '@tripshare/db';
import { isLocale, type Locale } from '@tripshare/shared';
import { applyPlanOps, PlanOpError, type TripDocument } from '@tripshare/shared/trip-format';
import { listMembers } from '../services/members.js';
import { activeMemberCount, readPlan } from '../services/plan.js';
import { computeLedgers } from '../services/trips.js';
import type { SettingsService } from '../settings.js';
import type { FileStorage } from '../storage.js';
import { AiAccessError, resolveAiAccess } from './access.js';
import { downloadImageFromAnyUrl } from '../image-download.js';
import { searchCommons } from '../photo-search.js';
import { AiError, complete, type ChatMessage } from './client.js';
import { runGeneration } from './generation.js';
import {
  AiInputSchema,
  buildRepairMessage,
  buildTask,
  checkResult,
  PURPOSE,
  type AiInput,
  type ChatResult,
  type PlacePhotoResult,
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
  httpFetch?: typeof fetch;
  /** Accoda il lavoro al worker; senza coda il lavoro gira subito nel processo. */
  enqueue?: (jobId: string) => Promise<void>;
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
  try {
    await resolveAiAccess(deps, userId, PURPOSE[parsed.kind]);
  } catch (err) {
    if (err instanceof AiAccessError) throw new AiJobError(err.message);
    throw err;
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
export interface SpecRun {
  value: unknown;
  citations: { url: string; title?: string }[];
  model: string | null;
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
): Promise<SpecRun> {
  const messages: ChatMessage[] = [...spec.messages];
  const out = { value: null as unknown, model: access.model as string | null };
  let citations: { url: string; title?: string }[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let cost: number | null = null;
  for (let attempt = 0; ; attempt++) {
    const res = await complete({
      provider: access.provider,
      apiKey: access.apiKey,
      model: access.model,
      fallbacks: access.fallbacks,
      messages,
      jsonSchema: { name: spec.schemaName, schema: spec.jsonSchema },
      web: spec.web,
      denyDataCollection: access.denyDataCollection,
      appUrl: deps.appUrl,
      appName: deps.appName,
      fetchImpl: deps.httpFetch,
    });
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
    promptTokens,
    completionTokens,
    cost,
  };
}

/** Esegue un lavoro: chiama il modello, valida la risposta (con correzioni) e salva il risultato. */
export async function processAiJob(deps: AiDeps, jobId: string) {
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
  try {
    const input = AiInputSchema.parse(job.input);
    const [owner] = await db
      .select({ locale: user.locale })
      .from(user)
      .where(eq(user.id, job.userId));
    const locale: Locale = owner?.locale && isLocale(owner.locale) ? owner.locale : 'it';
    const access = await resolveAiAccess(deps, job.userId, PURPOSE[input.kind]);
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
    if (input.kind === 'chat') {
      if (!job.tripId) throw new AiJobError('TRIP_NOT_FOUND');
      const history = await db
        .select({ role: aiChatMessage.role, content: aiChatMessage.content })
        .from(aiChatMessage)
        .where(
          and(
            eq(aiChatMessage.tripId, job.tripId),
            eq(aiChatMessage.userId, job.userId),
            input.conversationId
              ? eq(aiChatMessage.conversationId, input.conversationId)
              : isNull(aiChatMessage.conversationId),
          ),
        )
        .orderBy(desc(aiChatMessage.createdAt))
        .limit(12);
      ctx.history = history
        .reverse()
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
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

    const run = await runSpec(deps, access, spec, locale);
    model = run.model;
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
    let result: unknown = value;
    if (input.kind === 'placePhoto')
      result = {
        candidates: await fetchPlacePhotos(deps, input.name, value as PlacePhotoResult),
      };
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
        promptTokens: promptTokens || null,
        completionTokens: completionTokens || null,
        cost,
        finishedAt: new Date(),
      })
      .where(eq(aiJob.id, jobId));
  }
}

/**
 * Legge gli indirizzi proposti dall'AI: scarica le immagini (solo quelle che esistono davvero e
 * sono abbastanza grandi), le salva e restituisce le prime tre. Quelle che l'utente non sceglie
 * le elimina l'app con plan.placePhotoDiscard.
 */
async function fetchPlacePhotos(deps: AiDeps, name: string, found: PlacePhotoResult) {
  if (!deps.storage) return [];
  const storage = deps.storage;
  const maxBytes = (await deps.settings.get('uploads.maxMb')) * 1024 * 1024;
  const candidates: { photo: string; credit: string }[] = [];
  const seen = new Set<string>();
  let failures = 0;

  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  /** Scarica l'immagine (o quella di anteprima della pagina), la controlla e la salva. */
  const add = async (url: string, credit: string, download: () => Promise<Buffer>) => {
    try {
      const data = await download();
      const meta = await sharp(data, { limitInputPixels: 80_000_000 }).metadata();
      if ((meta.width ?? 0) < 500) throw new Error('TOO_SMALL');
      const photo = await storage.saveImage(data, 'place');
      candidates.push({ photo, credit });
      seen.add(url);
    } catch {
      failures++;
    }
  };

  // Gli indirizzi dell'AI si leggono in parallelo, poi si tengono i primi tre validi.
  const downloads = await Promise.allSettled(
    found.images.slice(0, 8).map(async (img) => {
      const data = await downloadImageFromAnyUrl(img.url, maxBytes, deps.httpFetch);
      const meta = await sharp(data, { limitInputPixels: 80_000_000 }).metadata();
      if ((meta.width ?? 0) < 500) throw new Error('TOO_SMALL');
      return { data, url: img.url };
    }),
  );
  for (const d of downloads) {
    if (d.status !== 'fulfilled') {
      failures++;
      continue;
    }
    if (candidates.length >= 3) continue;
    const photo = await storage.saveImage(d.value.data, 'place').catch(() => null);
    if (photo) candidates.push({ photo, credit: host(d.value.url) });
  }

  // Se l'AI non ne ha dati abbastanza di validi, si completa con le foto libere di Wikimedia.
  if (candidates.length < 3) {
    try {
      const commons = await searchCommons(name, deps.appName, deps.httpFetch);
      for (const c of commons) {
        if (candidates.length >= 3) break;
        if (seen.has(c.full)) continue;
        await add(c.full, c.credit ?? c.source, () =>
          downloadImageFromAnyUrl(c.full, maxBytes, deps.httpFetch),
        );
      }
    } catch (err) {
      deps.log?.(`[ai] foto da Wikimedia: ${String(err)}`);
    }
  }
  deps.log?.(
    `[ai] foto di "${name}": ${found.images.length} proposte dall'AI, ${candidates.length} valide, ${failures} scartate`,
  );
  return candidates;
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
