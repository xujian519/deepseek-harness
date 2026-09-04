import { defineConfig } from 'tsdown'

/**
 * Desktop service definition: pure Cordis types plus a minimal invariant.
 * The runtime bundle mirrors the dsh-host-directory-picker shape.
 */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
