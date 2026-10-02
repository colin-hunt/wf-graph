import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: 'esm',
  target: 'node20',
  outDir: 'dist',
  clean: false,
  banner: { js: '#!/usr/bin/env node' },
});
