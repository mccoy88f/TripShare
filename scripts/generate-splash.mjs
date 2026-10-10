/**
 * Genera le immagini di avvio per iOS (apple-touch-startup-image) a partire dalla schermata
 * di avvio definita in apps/web/index.html, così sono identiche a quella dell'app, e aggiorna
 * i link nell'index. Serve Playwright (con Chromium) e sharp; il risultato è già nel repository,
 * si rilancia solo se cambia la schermata di avvio:
 *   node scripts/generate-splash.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(root, 'apps/api/package.json'));
const sharp = req('sharp');
const { chromium } = createRequire(
  process.env.PLAYWRIGHT_MODULES ?? '/opt/node22/lib/node_modules/',
)('playwright');

// larghezza × altezza in punti CSS, densità dei pixel
const SIZES = [
  [440, 956, 3],
  [430, 932, 3],
  [428, 926, 3],
  [402, 874, 3],
  [393, 852, 3],
  [390, 844, 3],
  [414, 896, 3],
  [414, 896, 2],
  [375, 812, 3],
  [414, 736, 3],
  [375, 667, 2],
  [320, 568, 2],
  [1024, 1366, 2],
  [834, 1194, 2],
  [820, 1180, 2],
];

const indexPath = join(root, 'apps/web/index.html');
let index = readFileSync(indexPath, 'utf8');
const css = /<style id="boot-css">[\s\S]*?<\/style>/.exec(index)[0];
const boot = /<div class="boot"[\s\S]*?<\/div>/
  .exec(index)[0]
  .replace(
    '/favicon.svg',
    'data:image/svg+xml;base64,' +
      readFileSync(join(root, 'apps/web/public/favicon.svg')).toString('base64'),
  );

mkdirSync(join(root, 'apps/web/public/splash'), { recursive: true });
const browser = await chromium.launch();
const links = [];
for (const [w, h, dpr] of SIZES) {
  const page = await (
    await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr })
  ).newPage();
  await page.setContent(
    `<!doctype html><html><head>${css.replace('animation: boot-slide 1.1s ease-in-out infinite;', '')}<style>body{margin:0}</style></head><body>${boot}</body></html>`,
  );
  const png = await page.screenshot({ type: 'png' });
  const name = `${w * dpr}x${h * dpr}.png`;
  await sharp(png)
    .png({ palette: true, quality: 85, compressionLevel: 9, dither: 1 })
    .toFile(join(root, 'apps/web/public/splash', name));
  links.push(
    `    <link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" href="/splash/${name}" />`,
  );
  await page.close();
}
await browser.close();
index = index.replace(
  /<!-- splash:start -->[\s\S]*?<!-- splash:end -->/,
  `<!-- splash:start -->\n${links.join('\n')}\n    <!-- splash:end -->`,
);
writeFileSync(indexPath, index);
console.log(`${SIZES.length} immagini in apps/web/public/splash`);
