import { describe, expect, it } from 'vitest';
import { searchPhotos, searchWeb } from '../src/photo-search.js';

const searx = {
  results: [
    {
      img_src: 'https://example.org/a.jpg',
      thumbnail_src: 'https://example.org/a-t.jpg',
      title: 'Castello <b>di Edimburgo</b>',
      url: 'https://www.example.org/castello',
    },
    { img_src: 'https://example.org/a.jpg', url: 'https://example.org/dup' },
    { img_src: 'http://insecure.example.org/b.jpg', url: 'http://insecure.example.org/' },
    { img_src: 'https://cdn.example.net/c.jpg', url: 'https://www.example.net/page' },
    { url: 'https://example.com/no-image' },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('searchWeb (SearXNG)', () => {
  it('keeps unique https images and credits the source site', async () => {
    let asked = '';
    const fake = (async (url: string | URL | Request) => {
      asked = String(url);
      return json(searx);
    }) as typeof fetch;
    const out = await searchWeb('castello edimburgo', 'http://searxng:8080/', fake);
    expect(asked).toContain('http://searxng:8080/search?');
    expect(asked).toContain('format=json');
    expect(asked).toContain('categories=images');
    expect(out.map((p) => p.full)).toEqual([
      'https://example.org/a.jpg',
      'https://cdn.example.net/c.jpg',
    ]);
    expect(out[0]).toMatchObject({
      thumb: 'https://example.org/a-t.jpg',
      title: 'Castello di Edimburgo',
      credit: 'example.org',
    });
    expect(out[1]!.thumb).toBe('https://cdn.example.net/c.jpg');
  });

  it('fails when SearXNG answers with an error', async () => {
    const fake = (async () => json({}, 403)) as typeof fetch;
    await expect(searchWeb('x', 'http://searxng:8080', fake)).rejects.toThrow('SEARXNG_HTTP_403');
  });
});

describe('searchPhotos', () => {
  it('falls back to the web when Commons is down, and fails only if both are', async () => {
    const webOnly = (async (url: string | URL | Request) =>
      String(url).includes('commons') ? json({}, 500) : json(searx)) as typeof fetch;
    const out = await searchPhotos({
      query: 'castello',
      appName: 'TripShare',
      searxngUrl: 'http://searxng:8080',
      fetch: webOnly,
    });
    expect(out).toHaveLength(2);

    const down = (async () => json({}, 500)) as typeof fetch;
    await expect(
      searchPhotos({
        query: 'castello',
        appName: 'TripShare',
        searxngUrl: 'http://searxng:8080',
        fetch: down,
      }),
    ).rejects.toThrow();
  });

  it('uses only Commons when SearXNG is not configured', async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return json({ query: { pages: {} } });
    }) as typeof fetch;
    expect(await searchPhotos({ query: 'castello', appName: 'TripShare', fetch: fake })).toEqual(
      [],
    );
    expect(calls).toBe(1);
  });
});
