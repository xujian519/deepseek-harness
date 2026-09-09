import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    // Sandboxed Electron preloads run as CommonJS even though the application package is ESM.
    entry: {
      preload: 'lib/types/preload.js',
      'preload-app': 'lib/types/preload-app.js',
    },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
    // Sandboxed preloads cannot require a shared chunk file: any require
    // outside electron and Node builtins fails and the whole preload is
    // skipped silently, so each entry must inline its shared modules.
    splitting: false,
  },
])
