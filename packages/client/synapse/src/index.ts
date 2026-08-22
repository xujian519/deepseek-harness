/**
 * Browser-half plugin, node side. The node half stays empty: the whole
 * behavior lives in the browser half (`./client`) and the host half
 * (`@deepseek-ai/dsh-host-synapse`), so this entry exists only to appear in
 * the host cordis.yml / Loader.
 */

/** Host plugin body — no host-side behavior for the map switch plugin. */
export function apply(): void {}
