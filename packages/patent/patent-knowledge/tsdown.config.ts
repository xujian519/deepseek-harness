import { defineConfig } from 'tsdown'

/**
 * patent-knowledge ships TWO runtime entries: the plugin (index) and the
 * patent-knowledge-install CLI (bin). Each is built as a self-contained file
 * with code splitting disabled, so the shared install/engine modules are
 * inlined into every entry instead of emitting a hashed chunk the published
 * files list would miss (same pattern as dsh-sdk-jsonrpc-demo). Declarations
 * come from tsc -b (dts: false).
 */
export default defineConfig([
  { entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false },
  { entry: ['lib/types/bin.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false },
])
