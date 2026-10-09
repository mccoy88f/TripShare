import { describe, expect, it } from 'vitest';
import en from './en.json';
import itLocale from './it.json';

type Tree = { [key: string]: string | Tree | Tree[] };

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [`${prefix}${k}`]
      : Array.isArray(v)
        ? [`${prefix}${k}[${v.length}]`]
        : keys(v, `${prefix}${k}.`),
  );
}

describe('locales', () => {
  it('Italian and English have the same keys', () => {
    expect(keys(en as Tree).sort()).toEqual(keys(itLocale as Tree).sort());
  });

  it('interpolations match between languages', () => {
    const vars = (tree: Tree) =>
      Object.fromEntries(
        keys(tree)
          .filter((k) => !k.includes('['))
          .map((k) => [
            k,
            (k.split('.').reduce<unknown>((o, p) => (o as Tree)[p], tree) as string)
              .match(/{{\w+}}/g)
              ?.sort() ?? [],
          ]),
      );
    expect(vars(en as Tree)).toEqual(vars(itLocale as Tree));
  });
});
