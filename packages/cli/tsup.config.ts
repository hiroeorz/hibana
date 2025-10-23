import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  publicDir: 'templates',
  shims: false,
  target: 'node18',
  tsconfig: './tsconfig.json'
});
