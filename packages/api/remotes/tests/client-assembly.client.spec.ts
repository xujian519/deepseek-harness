/** The Client assembly must mount every Remote namespace a shipped browser package injects. */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The assembly imports generated `/remote` artifacts, which resolve through package exports to
// built `lib/`. The unbuilt unit lane skips this suite; the built-artifact lane runs it.
const builtClientBundle = fileURLToPath(new URL('../lib/client.js', import.meta.url))

describe.skipIf(!existsSync(builtClientBundle))('Client Remote assembly', () => {
  it('selects the two plugin discovery namespaces their browser tabs inject', async () => {
    const { REMOTE_CONTRIBUTIONS } = await import('../src/client/index.ts')
    const namespaces = new Set(REMOTE_CONTRIBUTIONS.flatMap(contribution =>
      contribution.descriptors.map(descriptor => descriptor.namespace)))
    // ui-plugin-market injects remote.pluginMarket (index sources); ui-plugin-catalog injects remote.pluginCatalog.
    expect(namespaces).toContain('pluginMarket')
    expect(namespaces).toContain('pluginCatalog')
  })
})
