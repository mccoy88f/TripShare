import { describe, expect, it } from 'vitest';
import { cleanQuery, searchPhotos, searchWeb, titleMatchesName } from '../src/photo-search.js';

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
      String(url).includes('commons.wikimedia.org') ? json({}, 500) : json(searx)) as typeof fetch;
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

describe('titleMatchesName', () => {
  it('requires the main words of the name in the file title', () => {
    expect(titleMatchesName('Trattoria da Mario - Firenze', 'Trattoria da Mario')).toBe(true);
    expect(titleMatchesName('Edinburgh Castle from Princes Street', 'Edinburgh Castle')).toBe(true);
    expect(titleMatchesName('Piatto di pasta', 'Trattoria da Mario')).toBe(false);
    expect(titleMatchesName('Caffè Florian', 'Caffe Florian')).toBe(true);
    expect(titleMatchesName('qualsiasi', 'Il')).toBe(true);
  });

  it('filters Commons by name and can put the web first', async () => {
    const commonsBody = {
      query: {
        pages: {
          '1': {
            index: 1,
            title: 'File:Piatto di pasta.jpg',
            imageinfo: [
              {
                thumburl: 'https://upload.wikimedia.org/a/960px-a.jpg',
                mime: 'image/jpeg',
                width: 960,
              },
            ],
          },
          '2': {
            index: 2,
            title: 'File:Trattoria da Mario.jpg',
            imageinfo: [
              {
                thumburl: 'https://upload.wikimedia.org/b/960px-b.jpg',
                mime: 'image/jpeg',
                width: 960,
              },
            ],
          },
        },
      },
    };
    const fake = (async (url: string | URL | Request) =>
      String(url).includes('commons.wikimedia.org') ? json(commonsBody) : json(searx)) as typeof fetch;
    const base = {
      query: 'Trattoria da Mario Firenze',
      appName: 'TripShare',
      searxngUrl: 'http://searxng:8080',
      fetch: fake,
      name: 'Trattoria da Mario',
    };
    const commonsFirst = await searchPhotos(base);
    expect(commonsFirst.map((p) => p.title)).toEqual([
      'Trattoria da Mario',
      'Castello di Edimburgo',
      '',
    ]);
    const webFirst = await searchPhotos({ ...base, webFirst: true });
    expect(webFirst.map((p) => p.source)).toEqual([
      'example.org',
      'example.net',
      'commons.wikimedia.org',
    ]);
  });
});

describe('cleanQuery', () => {
  it('removes operators and special characters, keeping letters and accents', () => {
    expect(cleanQuery('Pane & Vino (Firenze)')).toBe('Pane e Vino Firenze');
    expect(cleanQuery('!g site:example.com "Caffè Florian"  ')).toBe(
      'g site example.com Caffè Florian',
    );
    expect(cleanQuery("L'Osteria dell'Orso - Roma")).toBe("L'Osteria dell'Orso - Roma");
    expect(cleanQuery('  ??  ')).toBe('');
  });

  it('sends the cleaned query to both sources', async () => {
    const asked: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      asked.push(decodeURIComponent(String(url).replace(/\+/g, ' ')));
      return json(String(url).includes('commons.wikimedia.org') ? { query: { pages: {} } } : { results: [] });
    }) as typeof fetch;
    await searchPhotos({
      query: '!bing Pane & Vino',
      appName: 'TripShare',
      searxngUrl: 'http://searxng:8080',
      fetch: fake,
    });
    expect(asked).toHaveLength(2);
    expect(asked.some((u) => u.includes('gsrsearch=bing Pane e Vino'))).toBe(true);
    expect(asked.some((u) => u.includes('q=bing Pane e Vino'))).toBe(true);
  });
});
