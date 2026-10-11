import { describe, expect, it } from 'vitest';
import { memoryFileName } from '../src/memory-name.js';

describe('memoryFileName', () => {
  const at = new Date('2026-10-12T08:05:30Z');
  const id = 'abcdef12-3456-7890-abcd-ef1234567890';

  it('usa data e ora UTC e l’inizio dell’identificativo', () => {
    expect(memoryFileName({ id, kind: 'photo', at }, true)).toBe(
      'ricordo-20261012-0805-abcdef.jpg',
    );
  });

  it('estensione: video mp4, foto jpg o webp', () => {
    expect(memoryFileName({ id, kind: 'video', at }, true)).toMatch(/\.mp4$/);
    expect(memoryFileName({ id, kind: 'photo', at }, false)).toMatch(/\.webp$/);
  });
});
