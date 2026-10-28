/**
 * Bound for one assembled viewer artifact case.
 *
 * Each case boots the whole Web client in jsdom under coverage. The case measures 76–93 s on the faster
 * hosted CPU class and 131–162 s on the slower one, so the bound covers the slower class with headroom;
 * the coverage lane's 90 s budget sits below that cost, which is why every artifact case declares its own.
 */
export const ARTIFACT_MOUNT_TIMEOUT_MS = 240_000
