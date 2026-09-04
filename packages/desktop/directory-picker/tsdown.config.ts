import { defineConfig } from 'tsdown'

/**
 * Electron-backed directory picker provider: registers `ctx.directoryPicker`
 * with the `electron` capability, delegating to `ctx.desktop.showOpenDialog`.
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
