// Genera le icone PNG della PWA a partire da public/favicon.svg.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url));
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname;

await sharp(svg).resize(192, 192).png().toFile(out('pwa-192.png'));
await sharp(svg).resize(512, 512).png().toFile(out('pwa-512.png'));
await sharp(svg)
  .resize(180, 180)
  .flatten({ background: '#0d9488' })
  .png()
  .toFile(out('apple-touch-icon.png'));
// Icona "maskable": il disegno resta nella zona sicura centrale (80%).
const inner = await sharp(svg).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0f9f95' } })
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(out('pwa-maskable-512.png'));
console.log('Icone generate');
