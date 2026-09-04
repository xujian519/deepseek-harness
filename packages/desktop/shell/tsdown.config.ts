import { defineConfig } from 'tsdown'

/**
 * Desktop shell provider: JSON-RPC bridge client plus the Cordis service that
 * registers `ctx.desktop` for the packaged Electron app.
 */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/bridge-client.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
