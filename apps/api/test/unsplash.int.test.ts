import sharp from 'sharp';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

const PHOTO = {
  id: 'abc123',
  color: '#2a4d69',
  alt_description: 'Castello di Edimburgo al tramonto',
  urls: {
    small: 'https://images.unsplash.com/small.jpg',
    regular: 'https://images.unsplash.com/regular.jpg',
  },
  links: { download_location: 'https://api.unsplash.com/photos/abc123/download' },
  user: { name: 'Ada Lovelace', links: { html: 'https://unsplash.com/@ada' } },
};

run('Unsplash covers (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  const urls: string[] = [];

  beforeAll(async () => {
    const image = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#336699' },
    })
      .jpeg()
      .toBuffer();
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (new Headers(init?.headers).get('authorization') === 'Client-ID wrong-key-000')
        return new Response('{}', { status: 401 });
      if (url.includes('/search/photos')) return Response.json({ results: [PHOTO] });
      if (url.endsWith('/photos/abc123')) return Response.json(PHOTO);
      if (url.endsWith('/regular.jpg')) return new Response(image);
      if (url.endsWith('/download')) return Response.json({ url: 'x' });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    t = await createTestApp(
      DATABASE_URL!,
      await mkdtemp(join(tmpdir(), 'tripshare-unsplash-')),
      fakeFetch,
    );
  });
  beforeEach(async () => {
    await t.reset();
    urls.length = 0;
  });
  afterAll(async () => t?.close());

  it('searches photos and sets a cover with author credit', async () => {
    const marco = (await t.signUp('marco@example.com', 'Marco')).cookie;
    const { data: trip } = await t.trpc<{ id: string }>('trips.create', marco, {
      title: 'Scozia',
      currency: 'EUR',
    });
    const off = await t.trpc('trips.coverSearch', marco, { query: 'Edimburgo' }, 'query');
    expect(off.error?.message).toBe('UNSPLASH_NOT_CONFIGURED');

    await t.settings.set('unsplash.accessKey', 'good-access-key-123');
    const config = await t.trpc<{ unsplash: boolean }>('public.config', '', undefined, 'query');
    expect(config.data.unsplash).toBe(true);
    const found = await t.trpc<{ id: string; author: string; authorUrl: string }[]>(
      'trips.coverSearch',
      marco,
      { query: 'Edimburgo' },
      'query',
    );
    expect(found.data[0]).toMatchObject({ id: 'abc123', author: 'Ada Lovelace' });
    expect(found.data[0]!.authorUrl).toContain('utm_medium=referral');

    const set = await t.trpc<{ url: string }>('trips.setUnsplashCover', marco, {
      id: trip.id,
      photoId: 'abc123',
    });
    expect(set.status).toBe(200);
    expect(urls.some((u) => u.endsWith('/download'))).toBe(true);
    const detail = await t.trpc<{ coverImage: string; coverCredit: { name: string } }>(
      'trips.get',
      marco,
      { id: trip.id },
      'query',
    );
    expect(detail.data.coverImage).toBe(set.data.url);
    expect(detail.data.coverCredit.name).toBe('Ada Lovelace');

    await t.trpc('trips.removeCover', marco, { id: trip.id });
    const after = await t.trpc<{ coverCredit: unknown }>(
      'trips.get',
      marco,
      { id: trip.id },
      'query',
    );
    expect(after.data.coverCredit).toBeNull();
  });
});
