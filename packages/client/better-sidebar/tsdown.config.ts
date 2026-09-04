/**
 * tsdown build for @deepseek-ai/dsh-better-sidebar, on the shared client
 * package contract: the node-half lib bundles the tsc-emitted `lib/types`
 * entries, and the browser client bundle plus the lazy feature chunks build
 * during the Client pass.
 *
 * The browser half replicates the shared client-bundle preset
 * (packages/client/tsdown.client.ts `clientBundle`) with one addition the
 * preset does not have: lazy chunks. The preset builds a single
 * `lib/client.js`; this package splits the heavy preview/terminal libraries
 * (CodeMirror, xterm, mermaid) into standalone chunk bundles
 * (src/client/chunks/<name>.tsx) fetched on first use from the plugin's own
 * `/sidebar/bundle` route. The shared parts of the pipeline mirror the preset
 * deliberately, and the two must not drift silently:
 *
 * - externals resolve through the loader module table at runtime (the
 *   PLATFORM_MODULES seed list from packages/client/web/src/platform.ts),
 * - everything else is inlined into the bundle (xterm, clsx, ...),
 * - the purity gate rejects any other @deepseek-ai value import: cross-plugin
 *   collaboration goes through cordis services, never value imports,
 * - CSS Modules compile to hashed class maps and inject <style data-plugin>
 *   tags at factory execution,
 * - the artifact registers itself via window.__ModuleLoader__.load({id,
 *   factory}) with the (require) => exports CJS closure shape, and the
 *   compose contract keys the bundle id on package.json `name` — keep the
 *   id below in sync with the package name.
 *
 * Lazy chunks (lib/client-<name>.js) do NOT register with the module loader:
 * each script assigns its CJS factory to the plugin-owned global registry
 * `globalThis.__dshChunks__[<name>]`, materialized by the client chunk
 * loader (src/client/chunk-loader.ts). `codeSplitting: false` keeps every
 * chunk a single script; the core client.js must never statically import a
 * chunks/ entry. Chunk entries follow the preset's face rule: the Client
 * pass consumes the tsc-emitted `lib/types/client/` tree, a faceless `tsdown`
 * run consumes src.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve as resolvePath, sep } from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'
import { clientLibrary, INLINE_SAFE } from '../tsdown.client.ts'

const require = createRequire(import.meta.url)

/** Node builtins must never survive into the browser module-loader factory. */
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map(id => `node:${id}`),
])

/** Module specifiers the web shell shares into the frozen module table — the
 *  PLATFORM_MODULES list from packages/client/web/src/platform.ts. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** The bundle/loader id: must equal package.json `name` (client-modules compose contract). */
const PLUGIN_ID = '@deepseek-ai/dsh-better-sidebar'

/** The lazy chunk names (keep in sync with src/bundle-route.ts CHUNK_NAMES). */
const CHUNKS = ['terminal', 'editor', 'mermaid']

/**
 * react-icons' exports map lists `require` BEFORE `import`, so the shared
 * conditionNames resolve the unshakeable CJS entry and the whole icon set
 * lands in the core bundle (~6.4 MB extra). Pin the two sets the client
 * uses to their ESM entries, which tree-shake down to the imported icons.
 */
const reactIconsRoot = dirname(dirname(require.resolve('react-icons/lib')))
const REACT_ICONS_ESM_ALIAS = {
  'react-icons/si': join(reactIconsRoot, 'si/index.mjs'),
  'react-icons/vsc': join(reactIconsRoot, 'vsc/index.mjs'),
}

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Mirror of the preset's private marker: the lib/types subtree boundary. */
const TYPES_MARKER = `${sep}lib${sep}types${sep}`

/** Workspace mode removes this package from the face's build (mirror of the preset's private constant). */
const SKIP_WORKSPACE_BUILD: UserConfig = { entry: '' }

/** Rebase a physical lib-relative source onto a browser URL that mirrors the repository directories. */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith('.')) return source
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  const repositoryPath = relative(REPOSITORY_ROOT, physicalSource).split(sep).join('/')
  return repositoryPath.startsWith('packages/') ? `../../../${repositoryPath}` : source
}

/**
 * Remap a stylesheet imported from the tsc-emitted tree back to its src
 * original when tsc did not copy it (mirror of the preset's private
 * `sourceAssetPath`). relative css imports survive compilation, so a bundle
 * consuming `lib/types/client/*.js` resolves its sheets against src.
 */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}

/** The style-injection prologue shared by module css and plain css loads. */
function injectTag(pluginId: string, fileId: string, cssText: string): string {
  const tagId = `${pluginId}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(cssText)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    `  tag.dataset.pluginCss = tagId;`,
    `  tag.textContent = css;`,
    `  document.head.appendChild(tag);`,
    `}`,
  ].join('\n')
}

/** A rolldown plugin as tsdown's config accepts it (contextual `this` for load/resolveId). */
type BuildPlugin = NonNullable<UserConfig['plugins']>

/** One build face selector, mirroring the shared preset's BuildFaceConfig. */
type FaceConfig = (inlineConfig: Pick<UserConfig, 'env'>) => UserConfig[]

function buildFace(value: unknown): 'host' | 'client' | undefined {
  if (value === undefined || value === 'host' || value === 'client') return value
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/** Mermaid-chunk-only alias: pin uuid's BROWSER entry. The mermaid core
 *  (mindmap definition) imports the bare `uuid` specifier, which rolldown
 *  resolves to uuid's node entry — its dist-node modules import
 *  `node:crypto` and trip the client purity gate. The browser entry
 *  (uuid/dist/index.js, Web Crypto based) carries no Node builtins, so alias
 *  the specifier there instead of special-casing the gate. Resolved relative
 *  to mermaid's own dependency tree (pnpm/npm layout agnostic). */
function mermaidChunkAliases(): BuildPlugin {
  const uuidBrowserEntry = resolvePath(
    dirname(require.resolve('uuid/package.json', { paths: [dirname(require.resolve('mermaid/package.json'))] })),
    'dist/index.js',
  )
  return {
    name: 'dsh-mermaid-uuid-browser-alias',
    resolveId(source: string) {
      if (source === 'uuid') return uuidBrowserEntry
      return null
    },
  }
}

/** The shared client-bundle purity gate (see the shared preset's clientBundle doc). */
function purityGatePlugin(): BuildPlugin {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (NODE_BUILTINS.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table — `
          + 'select the dependency browser export or add an explicit browser implementation',
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null // platform module: external wins
      if (INLINE_SAFE.test(source)) return null // wire/type layer: inline is the point
      if (source === `${PLUGIN_ID}/client`) return null // this package's own client face
      throw new Error(
        `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS) and not an inline-safe wire layer — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
      )
    },
  }
}

/** The shared CSS-inline virtual-module plugin (one <style data-plugin> per file). */
function makeCssPlugin(pluginId: string): BuildPlugin {
  return {
    name: 'dsh-css-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css')) return null
      // Relative/absolute paths resolve against the importer; bare
      // specifiers (e.g. '@xterm/xterm/css/xterm.css') resolve from the package.
      let abs: string
      if (source.startsWith('.') || source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source)) {
        abs = importer === undefined ? source : resolvePath(dirname(importer), source)
      } else {
        abs = require.resolve(source)
      }
      if (!existsSync(abs)) abs = sourceAssetPath(source, importer ?? abs)
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      // CSS Modules (x.module.css) become hashed class maps; plain css
      // (xterm's stylesheet) is inlined verbatim.
      if (fileId.endsWith('.module.css')) {
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: `[hash]_[local]` },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        return [
          injectTag(pluginId, fileId, code.toString()),
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      }
      return [
        injectTag(pluginId, fileId, source.toString('utf8')),
        'export default "";',
      ].join('\n')
    },
  }
}

/** Shared define + resolve shape for every browser bundle of this package. */
function browserShared(face: 'client' | undefined): Pick<UserConfig, 'define' | 'inputOptions'> {
  return {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      // No bundled chunk uses import.meta.resolve; keep the stub so a stray
      // reference cannot resolve to Node's loader (browser CJS has none).
      'import.meta.resolve': 'undefined',
    },
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'import', 'require', 'default'],
        ...(face === undefined ? { alias: REACT_ICONS_ESM_ALIAS } : {}),
      },
    },
  }
}

/**
 * The browser client bundle for the profile channel, registering under the
 * package name. The Client pass consumes the tsc-emitted tree; a faceless
 * `tsdown` run consumes src (same convention as the shared preset).
 */
function clientBundleConfig(face: 'client' | undefined): UserConfig {
  return {
    entry: { client: face === 'client' ? 'lib/types/client/index.js' : 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    ...browserShared(face),
    // External wins for module-table entries; every other dependency inlines.
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [purityGatePlugin(), makeCssPlugin(PLUGIN_ID)],
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: `return module.exports; } });`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      // The CJS wrapper factory's `require` only resolves module-table entries
      // (react, cordis, ...); it cannot load relative chunk URLs in the browser.
      // Disable code splitting so every artifact is one script (the lazy chunk
      // files themselves are separate bundles — see chunkBundle below).
      codeSplitting: false,
    },
  }
}

/**
 * One lazy chunk bundle: a heavy feature slice of the client built as a
 * standalone single script (lib/client-<name>.js), fetched by the client on
 * first use through the plugin's /sidebar/bundle route. The core bundle must
 * never statically import the chunk entry.
 * @param name - chunk name; keep in sync with CHUNK_NAMES in src/bundle-route.ts.
 * @param face - the build face selecting the entry tree (see clientBundleConfig).
 */
function chunkBundle(name: string, face: 'client' | undefined): UserConfig {
  return {
    entry: { [name]: face === 'client' ? `lib/types/client/chunks/${name}.js` : `src/client/chunks/${name}.tsx` },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    ...browserShared(face),
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [
      purityGatePlugin(),
      makeCssPlugin(PLUGIN_ID),
      ...(name === 'mermaid' ? [mermaidChunkAliases()] : []),
    ],
    outputOptions: {
      entryFileNames: `client-${name}.js`,
      sourcemapPathTransform: browserSourcePath,
      banner: `globalThis.__dshChunks__ = globalThis.__dshChunks__ || {}; globalThis.__dshChunks__[${JSON.stringify(name)}] = (require) => {`,
      footer: 'return module.exports; };',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      codeSplitting: false,
    },
  }
}

/** The node-half lib: bundles the tsc-emitted lib/types entries (shared preset shape). */
const lib = clientLibrary(PLUGIN_ID, ['lib/types/index.js'])

export default ((inlineConfig: Pick<UserConfig, 'env'>): UserConfig[] => {
  const face = buildFace(inlineConfig.env?.DSH_BUILD_FACE)
  // Client packages emit both halves during the Client pass; the Host pass
  // skips the package entirely (shared clientLibrary contract).
  if (face === 'host') return [SKIP_WORKSPACE_BUILD]
  const browser = [clientBundleConfig(face), ...CHUNKS.map(name => chunkBundle(name, face))]
  return [...lib(inlineConfig), ...browser]
}) satisfies FaceConfig
