import { readFile } from 'node:fs/promises';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { memory, trip, tripMember, type Database } from '@tripshare/db';
import type { FileStorage } from '../storage.js';
import { transcodeVideo, withTempFile } from './media.js';

export const MEDIA_QUEUE = 'media';

/**
 * Ricodifica il video di un ricordo in MP4 leggibile ovunque e sostituisce il file originale.
 * Se fallisce il ricordo resta, segnato come non elaborato (l'originale si conserva).
 */
export async function processVideoMemory(
  deps: { db: Database; storage: FileStorage; log?: (msg: string) => void },
  memoryId: string,
): Promise<void> {
  const [row] = await deps.db.select().from(memory).where(eq(memory.id, memoryId));
  if (!row || row.kind !== 'video' || row.status !== 'processing') return;
  const source = await deps.storage.readPrivate(row.storageName);
  if (!source) {
    await deps.db.update(memory).set({ status: 'failed' }).where(eq(memory.id, memoryId));
    return;
  }
  try {
    const encoded = await withTempFile(
      source,
      row.storageName.split('.').pop() ?? 'mp4',
      async (input) => {
        const output = `${input}.out.mp4`;
        await transcodeVideo(input, output);
        return readFile(output);
      },
    );
    const storageName = await deps.storage.savePrivate(encoded, 'mp4');
    await deps.db
      .update(memory)
      .set({ storageName, mimeType: 'video/mp4', size: encoded.length, status: 'ready' })
      .where(eq(memory.id, memoryId));
    await deps.storage.removePrivate(row.storageName);
  } catch (err) {
    deps.log?.(`[media] ricodifica del ricordo ${memoryId}: ${String(err)}`);
    await deps.db.update(memory).set({ status: 'failed' }).where(eq(memory.id, memoryId));
    throw err;
  }
}

/** Ricordo che l'utente può vedere: il proprio, oppure uno condiviso di un viaggio a cui partecipa. */
export function visibleTo(userId: string) {
  return or(
    eq(memory.userId, userId),
    and(
      eq(memory.shared, true),
      sql`${memory.tripId} in (select ${tripMember.tripId} from ${tripMember} where ${tripMember.userId} = ${userId} and ${tripMember.removedAt} is null)`,
    ),
  );
}

/** Il viaggio dell'utente che comprende la data, se ce n'è uno solo. */
export async function tripForDate(
  db: Database,
  userId: string,
  takenAt: Date,
): Promise<string | null> {
  const day = takenAt.toISOString().slice(0, 10);
  const rows = await db
    .select({ id: trip.id })
    .from(trip)
    .innerJoin(tripMember, eq(tripMember.tripId, trip.id))
    .where(
      and(
        eq(tripMember.userId, userId),
        isNull(tripMember.removedAt),
        sql`${trip.startDate} <= ${day}`,
        sql`${trip.endDate} >= ${day}`,
      ),
    );
  return rows.length === 1 ? rows[0]!.id : null;
}
