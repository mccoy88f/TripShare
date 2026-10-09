import { defineConfig } from 'tsup';

// Un solo bundle per l'API e uno per il worker. I pacchetti del monorepo sono inclusi nel bundle,
// le dipendenze npm restano esterne e vengono installate nell'immagine Docker.
export default defineConfig({
  entry: ['src/main.ts', 'src/worker.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@tripshare\//],
});
