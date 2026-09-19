// A row whose config the plugin's own schema refuses at mount. Import-free on
// purpose — the Loader resolves entry modules through Node's ESM resolver,
// which cannot see this workspace's TypeScript sources — so the validator is
// the standard-schema contract directly, emitting the `$.prefix missing
// required value` line schemastery produced when the 2026-09-06 persona field
// rename reached a deployment. The shipped presets are held against the real
// persona schema by `scripts/verify-agent-preset-config`.
export const name = 'requires-prefix'

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'agent-presets-fixture',
    validate(config) {
      return typeof config?.prefix === 'string' && config.prefix !== ''
        ? { value: config }
        : { issues: [{ message: '$.prefix missing required value', path: [] }] }
    },
  },
}

export function apply() {}
