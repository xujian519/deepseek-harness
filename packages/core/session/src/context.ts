/**
 * Host-only Context augmentation: in the host program, `ctx.sessions` is the
 * concrete {@link SessionStore}. Client programs must not import this module —
 * they carry their own `ISessions` outward face — so the augmentation lives
 * apart from the package root: shared packages that import session types or
 * values from the root no longer drag the host merge into a client program.
 * Consuming packages that read `ctx.sessions` add a type-only import of this
 * module; the declaration is program-global once loaded, and the type-only
 * form keeps the import out of emitted declarations.
 * @module @deepseek-ai/dsh-session/context
 */

import type { SessionStore } from './index.ts'

export {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessions: SessionStore
  }
}
