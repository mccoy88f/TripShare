import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function multipart(
  fields: Record<string, string>,
  file: { name: string; type: string; data: Buffer },
) {
  const boundary = '----tripshare-memory';
  const parts = Object.entries(fields).map(([k, v]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
  );
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      ...parts,
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

/** JPEG con data, fuso e posizione (Milano) nell'EXIF. */
async function photoWithExif() {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: '#2a9d8f' } })
    .withExif({
      IFD2: { DateTimeOriginal: '2026:10:13 15:30:00', OffsetTimeOriginal: '+02:00' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '45/1 30/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '9/1 12/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
}

function makeVideo(seconds: number, withLocation: boolean) {
  const out = join(tmpdir(), `tripshare-test-${Date.now()}-${seconds}.mp4`);
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=320x240:rate=10:duration=${seconds}`,
      '-pix_fmt',
      'yuv420p',
      ...(withLocation
        ? [
            '-metadata',
            'location=+45.4642+009.1900/',
            '-metadata',
            'creation_time=2026-10-14T10:00:00Z',
          ]
        : []),
      out,
    ],
    { stdio: 'ignore' },
  );
  return readFile(out);
}

run('memories (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestApp(DATABASE_URL!, await mkdtemp(join(tmpdir(), 'tripshare-memories-')));
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t?.close());

  const upload = (
    cookie: string,
    fields: Record<string, string>,
    file: { name: string; type: string; data: Buffer },
  ) => {
    const body = multipart(fields, file);
    return t.app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { cookie, origin: 'http://localhost:5173', 'content-type': body.contentType },
      payload: body.payload,
    });
  };
  const fileOf = (cookie: string, id: string, v = '', range?: string) =>
    t.app.inject({
      method: 'GET',
      url: `/api/memories/${id}/file${v ? `?v=${v}` : ''}`,
      headers: { cookie, ...(range ? { range } : {}) },
    });

  it('reads date and position from the photo, links the trip and shares it with members only', async () => {
    const owner = (await t.signUp('owner@example.com', 'Owner')).cookie;
    const { data: trip } = await t.trpc<{ id: string }>('trips.create', owner, {
      title: 'Milano',
      currency: 'EUR',
      startDate: '2026-10-12',
      endDate: '2026-10-16',
    });
    const invite = await t.trpc<{ token: string }>('invitations.create', owner, {
      tripId: trip.id,
      email: 'friend@example.com',
    });
    const friend = (
      await t.signUp('friend@example.com', 'Friend', { 'x-invite-token': invite.data.token })
    ).cookie;
    await t.trpc('invitations.accept', friend, { token: invite.data.token });
    const stranger = (await t.signUp('stranger@example.com', 'Stranger')).cookie;

    const res = await upload(
      owner,
      {},
      { name: 'a.jpg', type: 'image/jpeg', data: await photoWithExif() },
    );
    expect(res.statusCode).toBe(200);
    const { id } = res.json() as { id: string };

    const mine = await t.trpc<
      { id: string; takenAt: string; lat: number; lon: number; tripId: string; shared: boolean }[]
    >('memories.list', owner, {}, 'query');
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0]).toMatchObject({ id, tripId: trip.id, shared: true });
    // 15:30 a +02:00 = 13:30 UTC
    expect(mine.data[0]!.takenAt).toBe('2026-10-13T13:30:00.000Z');
    expect(mine.data[0]!.lat).toBeCloseTo(45.5, 3);
    expect(mine.data[0]!.lon).toBeCloseTo(9.2, 3);

    // Il file è WebP senza metadati; l'amico del viaggio lo vede, l'estraneo no.
    const full = await fileOf(owner, id);
    expect(full.headers['content-type']).toBe('image/webp');
    expect((await sharp(full.rawPayload).metadata()).exif).toBeUndefined();
    expect((await fileOf(friend, id, 'thumb')).statusCode).toBe(200);
    expect((await fileOf(stranger, id)).statusCode).toBe(404);
    const tripView = await t.trpc<{ id: string }[]>(
      'memories.list',
      friend,
      { tripId: trip.id },
      'query',
    );
    expect(tripView.data.map((m) => m.id)).toEqual([id]);
    expect((await t.trpc('memories.list', stranger, { tripId: trip.id }, 'query')).status).toBe(
      404,
    );
    // La notifica del ricordo condiviso arriva all'amico.
    const unread = await t.trpc<{ total: number }>(
      'notifications.unread',
      friend,
      undefined,
      'query',
    );
    expect(unread.data.total).toBeGreaterThan(0);

    // Reso privato, sparisce dalla vista del viaggio e il file non si legge più.
    await t.trpc('memories.update', owner, { id, shared: false, caption: 'Duomo' });
    expect((await fileOf(friend, id)).statusCode).toBe(404);
    expect(
      (await t.trpc<unknown[]>('memories.list', friend, { tripId: trip.id }, 'query')).data,
    ).toHaveLength(0);
    // "none": resta personale anche se la data cade in un viaggio.
    const solo = await upload(
      owner,
      { tripId: 'none' },
      { name: 'b.jpg', type: 'image/jpeg', data: await photoWithExif() },
    );
    const soloId = (solo.json() as { id: string }).id;
    const all = await t.trpc<{ id: string; tripId: string | null; shared: boolean }[]>(
      'memories.list',
      owner,
      {},
      'query',
    );
    expect(all.data.find((m) => m.id === soloId)).toMatchObject({ tripId: null, shared: false });
    // Solo l'autore modifica o elimina.
    expect((await t.trpc('memories.delete', friend, { id })).status).toBe(404);
    expect((await t.trpc('memories.delete', owner, { id })).status).toBe(200);
    expect((await fileOf(owner, id)).statusCode).toBe(404);
  });

  it('lets the author place and date a memory by hand', async () => {
    const owner = (await t.signUp('owner@example.com', 'Owner')).cookie;
    const plain = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const res = await upload(
      owner,
      { takenAt: '2026-05-01T10:00:00.000Z', lat: '48.85', lon: '2.35', caption: 'Parigi' },
      { name: 'a.png', type: 'image/png', data: plain },
    );
    const { id } = res.json() as { id: string };
    const list = await t.trpc<
      { lat: number; caption: string; tripId: string | null; shared: boolean }[]
    >('memories.list', owner, {}, 'query');
    expect(list.data[0]).toMatchObject({
      lat: 48.85,
      caption: 'Parigi',
      tripId: null,
      shared: false,
    });
    await t.trpc('memories.update', owner, { id, lat: null, lon: null });
    const after = await t.trpc<{ lat: number | null }[]>('memories.list', owner, {}, 'query');
    expect(after.data[0]!.lat).toBeNull();
    const bad = await upload(
      owner,
      {},
      { name: 'x.txt', type: 'text/plain', data: Buffer.from('hi') },
    );
    expect(bad.statusCode).toBe(415);
  });

  it('downloads memories as JPEG files and as a ZIP, only the visible ones', async () => {
    const owner = (await t.signUp('owner@example.com', 'Owner')).cookie;
    const other = (await t.signUp('other@example.com', 'Other')).cookie;
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c33' } })
      .png()
      .toBuffer();
    const ids: string[] = [];
    for (const name of ['a.png', 'b.png']) {
      const r = await upload(owner, {}, { name, type: 'image/png', data: png });
      ids.push((r.json() as { id: string }).id);
    }
    const jpg = await t.app.inject({
      method: 'GET',
      url: `/api/memories/${ids[0]}/file?v=jpg&download=1`,
      headers: { cookie: owner },
    });
    expect(jpg.headers['content-type']).toBe('image/jpeg');
    expect(String(jpg.headers['content-disposition'])).toMatch(
      /^attachment; filename="ricordo-\d{8}-\d{4}-[0-9a-f]{6}\.jpg"$/,
    );
    expect((await sharp(jpg.rawPayload).metadata()).format).toBe('jpeg');

    const zipRes = await t.app.inject({
      method: 'GET',
      url: `/api/memories/zip?ids=${ids.join(',')}`,
      headers: { cookie: owner },
    });
    expect(zipRes.statusCode).toBe(200);
    expect(zipRes.headers['content-type']).toBe('application/zip');
    const files = unzipSync(new Uint8Array(zipRes.rawPayload));
    expect(Object.keys(files)).toHaveLength(2);
    expect(Object.keys(files)[0]).toMatch(/^001-ricordo-.*\.jpg$/);
    // Chi non vede i ricordi non ne scarica nessuno.
    const denied = await t.app.inject({
      method: 'GET',
      url: `/api/memories/zip?ids=${ids.join(',')}`,
      headers: { cookie: other },
    });
    expect(denied.statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/memories/zip?ids=x' })).statusCode).toBe(
      401,
    );
  });

  it.skipIf(!hasFfmpeg)(
    're-encodes videos, reads their location and limits the duration',
    async () => {
      const owner = (await t.signUp('owner@example.com', 'Owner')).cookie;
      const ok = await upload(
        owner,
        {},
        { name: 'v.mp4', type: 'video/mp4', data: await makeVideo(2, true) },
      );
      expect(ok.statusCode).toBe(200);
      const { id } = ok.json() as { id: string };
      const list = await t.trpc<
        { kind: string; status: string; lat: number; takenAt: string; durationSec: number }[]
      >('memories.list', owner, {}, 'query');
      expect(list.data[0]).toMatchObject({ kind: 'video', status: 'ready' });
      expect(list.data[0]!.lat).toBeCloseTo(45.4642, 3);
      expect(list.data[0]!.takenAt).toBe('2026-10-14T10:00:00.000Z');
      const head = await fileOf(owner, id, '', 'bytes=0-99');
      expect(head.statusCode).toBe(206);
      expect(head.rawPayload.length).toBe(100);
      expect(head.headers['content-type']).toBe('video/mp4');
      expect((await fileOf(owner, id, 'thumb')).headers['content-type']).toBe('image/webp');

      const long = await upload(
        owner,
        {},
        { name: 'long.mp4', type: 'video/mp4', data: await makeVideo(125, false) },
      );
      expect(long.statusCode).toBe(413);
      expect(long.json()).toMatchObject({ error: 'VIDEO_TOO_LONG' });
    },
    60_000,
  );
});

run('memory places (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/reverse'))
      return Response.json({
        name: '',
        display_name: 'Via Roma, Torino, Italia',
        address: { city: 'Torino', country: 'Italia' },
      });
    return Response.json([
      {
        name: 'Edinburgh Castle',
        display_name: 'Edinburgh Castle, Castlehill, Edimburgo, Scozia, Regno Unito',
        lat: '55.9486',
        lon: '-3.1999',
        address: { city: 'Edimburgo', country: 'Regno Unito' },
      },
    ]);
  }) as typeof fetch;
  beforeAll(async () => {
    t = await createTestApp(
      DATABASE_URL!,
      await mkdtemp(join(tmpdir(), 'tripshare-places-')),
      fakeFetch,
    );
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t?.close());

  it('searches places by name, resolves a point to a name and saves it with the memory', async () => {
    const owner = (await t.signUp('owner@example.com', 'Owner')).cookie;
    const hits = await t.trpc<{ label: string; lat: number; lon: number }[]>(
      'memories.searchPlace',
      owner,
      { query: 'Edinburgh Castle' },
      'query',
    );
    expect(hits.data[0]).toMatchObject({
      label: 'Edinburgh Castle, Edimburgo',
      lat: 55.9486,
      lon: -3.1999,
    });
    const named = await t.trpc<{ label: string | null }>(
      'memories.reverse',
      owner,
      { lat: 45.07, lon: 7.686 },
      'query',
    );
    expect(named.data.label).toBe('Torino, Italia');
    // Stessa ricerca: risposta dalla cache, senza nuove richieste al servizio.
    const before = calls.length;
    await t.trpc('memories.searchPlace', owner, { query: 'edinburgh castle' }, 'query');
    expect(calls.length).toBe(before);
    expect((await t.trpc('memories.searchPlace', owner, { query: 'x' }, 'query')).status).toBe(400);

    const plain = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const body = multipart({}, { name: 'a.png', type: 'image/png', data: plain });
    const up = await t.app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { cookie: owner, origin: 'http://localhost:5173', 'content-type': body.contentType },
      payload: body.payload,
    });
    const { id } = up.json() as { id: string };
    await t.trpc('memories.update', owner, {
      id,
      lat: hits.data[0]!.lat,
      lon: hits.data[0]!.lon,
      placeName: hits.data[0]!.label,
    });
    const list = await t.trpc<{ placeName: string | null }[]>('memories.list', owner, {}, 'query');
    expect(list.data[0]!.placeName).toBe('Edinburgh Castle, Edimburgo');
    // Togliendo la posizione sparisce anche il nome.
    await t.trpc('memories.update', owner, { id, lat: null, lon: null });
    const after = await t.trpc<{ placeName: string | null }[]>('memories.list', owner, {}, 'query');
    expect(after.data[0]!.placeName).toBeNull();
  });
});
