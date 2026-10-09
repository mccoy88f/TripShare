import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

run('place photos (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let image: Buffer;
  beforeAll(async () => {
    image = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#2a9d8f' },
    })
      .jpeg()
      .toBuffer();
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://commons.wikimedia.org/w/api.php')) {
        return Response.json({
          query: {
            pages: {
              '2': {
                index: 2,
                title: 'File:Altro_castello.png',
                imageinfo: [
                  {
                    thumburl: 'https://upload.wikimedia.org/thumb/a/ab/B.png/1200px-B.png',
                    mime: 'image/png',
                    extmetadata: {
                      Artist: { value: '<a href="x">Mario Rossi</a>' },
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                    },
                  },
                ],
              },
              '1': {
                index: 1,
                title: 'File:Edinburgh_Castle.jpg',
                imageinfo: [
                  {
                    thumburl: 'https://upload.wikimedia.org/thumb/a/aa/A.jpg/1200px-A.jpg',
                    mime: 'image/jpeg',
                    extmetadata: {
                      Artist: { value: 'Ada &amp; Bob' },
                      LicenseShortName: { value: 'CC BY 2.0' },
                    },
                  },
                ],
              },
              '3': {
                index: 3,
                title: 'File:Mappa.svg',
                imageinfo: [
                  { thumburl: 'https://upload.wikimedia.org/x.png', mime: 'image/svg+xml' },
                ],
              },
            },
          },
        });
      }
      if (url === 'https://93.184.216.34/castello.jpg')
        return new Response(new Uint8Array(image), { headers: { 'content-type': 'image/jpeg' } });
      if (url === 'https://93.184.216.34/page.html')
        return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    t = await createTestApp(
      DATABASE_URL!,
      await mkdtemp(join(tmpdir(), 'tripshare-place-photo-')),
      fakeFetch,
    );
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t?.close());

  it('searches Commons, downloads safely, stores and cleans up place photos', async () => {
    const owner = (await t.signUp('owner@example.com', 'Owner')).cookie;
    const { data: trip } = await t.trpc<{ id: string }>('trips.create', owner, {
      title: 'Scozia',
      currency: 'EUR',
    });
    const tripId = trip.id;

    // Wikimedia Commons: sempre disponibile, ordinata, con autore e licenza, solo jpeg/png/webp.
    const commons = await t.trpc<{ full: string; title: string; credit: string }[]>(
      'plan.placePhotoSearch',
      owner,
      { tripId, query: 'edinburgh castle' },
      'query',
    );
    expect(commons.data.map((p) => p.title)).toEqual(['Edinburgh Castle', 'Altro castello']);
    expect(commons.data[0]!.credit).toBe('Ada & Bob · CC BY 2.0');
    expect(commons.data[1]!.credit).toBe('Mario Rossi · CC BY-SA 4.0');

    for (const url of [
      'http://93.184.216.34/castello.jpg',
      'https://127.0.0.1/a.jpg',
      'https://10.0.0.5/a.jpg',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/a.jpg',
    ]) {
      const refused = await t.trpc('plan.placePhotoFromUrl', owner, { tripId, url });
      expect(refused.error?.message, url).toBe('INVALID_URL');
    }
    const html = await t.trpc('plan.placePhotoFromUrl', owner, {
      tripId,
      url: 'https://93.184.216.34/page.html',
    });
    expect(html.error?.message).toBe('NOT_AN_IMAGE');

    const saved = await t.trpc<{ url: string }>('plan.placePhotoFromUrl', owner, {
      tripId,
      url: 'https://93.184.216.34/castello.jpg',
    });
    expect(saved.data.url).toMatch(/^\/api\/files\/place-[a-f0-9]{32}\.webp$/);
    const served = await t.app.inject({ method: 'GET', url: saved.data.url });
    expect(served.statusCode).toBe(200);

    await t.trpc('plan.applyOps', owner, {
      tripId,
      ops: [
        {
          type: 'upsertPlace',
          place: { id: 'castello', name: 'Castello', kind: 'sight', photo: saved.data.url },
        },
      ],
    });
    const plan = await t.trpc<{ plan: { places: { photo?: string }[] } }>(
      'plan.get',
      owner,
      { tripId },
      'query',
    );
    expect(plan.data.plan.places[0]!.photo).toBe(saved.data.url);

    // Un indirizzo che non è https né un nostro file non è ammesso come foto.
    const wrong = await t.trpc('plan.applyOps', owner, {
      tripId,
      ops: [
        {
          type: 'upsertPlace',
          place: { id: 'altro', name: 'Altro', kind: 'sight', photo: 'javascript:alert(1)' },
        },
      ],
    });
    expect(wrong.status).toBe(400);

    // Togliendo il luogo, il file della foto viene eliminato.
    await t.trpc('plan.applyOps', owner, {
      tripId,
      ops: [{ type: 'deletePlace', id: 'castello' }],
    });
    const gone = await t.app.inject({ method: 'GET', url: saved.data.url });
    expect(gone.statusCode).toBe(404);
  });
});
