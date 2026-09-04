import { defineConfig } from 'tsdown'

/**
 * Node-half build for the host package: mirrors the root workspace default
 * (the same entries the root workspace config would merge in), so the host
 * Loader can import the built lib from a real install.
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
