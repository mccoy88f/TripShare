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
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
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
      if (url.startsWith('https://searx.example.org/search')) {
        return Response.json({
          results: [
            {
              title: 'Da SearXNG',
              img_src: 'https://93.184.216.34/castello.jpg',
              thumbnail_src: 'https://searx.example.org/t.jpg',
              url: 'https://www.sito.it/p',
            },
            { title: 'http', img_src: 'http://insecure.example.com/y.jpg' },
          ],
        });
      }
      if (url.startsWith('https://api.search.brave.com/')) {
        if (new Headers(init?.headers).get('x-subscription-token') === 'wrong-key-0000')
          return new Response('{}', { status: 401 });
        return Response.json({
          results: [
            {
              title: 'Castello',
              url: 'https://www.example.com/castello',
              source: 'www.example.com',
              thumbnail: { src: 'https://imgs.search.brave.com/t.jpg' },
              properties: { url: 'https://93.184.216.34/castello.jpg' },
            },
            // senza immagine originale o non https: scartati
            { title: 'x', thumbnail: { src: 'https://imgs.search.brave.com/u.jpg' } },
            {
              title: 'y',
              thumbnail: { src: 'https://imgs.search.brave.com/v.jpg' },
              properties: { url: 'http://insecure.example.com/y.jpg' },
            },
          ],
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

  it('searches, downloads safely, stores and cleans up place photos', async () => {
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

    // Ricerca sul web: serve SearXNG o la chiave Brave.
    const web = { tripId, query: 'castello', source: 'web' };
    const off = await t.trpc('plan.placePhotoSearch', owner, web, 'query');
    expect(off.error?.message).toBe('WEB_PHOTOS_NOT_CONFIGURED');
    const before = await t.trpc<{ placePhotosWeb: boolean }>(
      'public.config',
      '',
      undefined,
      'query',
    );
    expect(before.data.placePhotosWeb).toBe(false);

    await t.settings.set('searxng.url', 'https://searx.example.org/');
    const searx = await t.trpc<{ full: string; source: string }[]>(
      'plan.placePhotoSearch',
      owner,
      web,
      'query',
    );
    expect(searx.data).toEqual([
      expect.objectContaining({ full: 'https://93.184.216.34/castello.jpg', source: 'sito.it' }),
    ]);
    await t.settings.set('searxng.url', null);

    await t.settings.set('brave.apiKey', 'wrong-key-0000');
    const bad = await t.trpc('plan.placePhotoSearch', owner, web, 'query');
    expect(bad.error?.message).toBe('BRAVE_INVALID_KEY');
    await t.settings.set('brave.apiKey', 'good-brave-key-123');
    const config = await t.trpc<{ placePhotosWeb: boolean }>(
      'public.config',
      '',
      undefined,
      'query',
    );
    expect(config.data.placePhotosWeb).toBe(true);
    const found = await t.trpc<{ thumb: string; full: string; source: string }[]>(
      'plan.placePhotoSearch',
      owner,
      web,
      'query',
    );
    expect(found.data).toHaveLength(1);
    expect(found.data[0]).toMatchObject({
      full: 'https://93.184.216.34/castello.jpg',
      source: 'example.com',
    });

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
      url: found.data[0]!.full,
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
