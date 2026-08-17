/**
 * Host-face context augmentation bridge. Every host-face test program that
 * reads `ctx.sessions` needs the host merge visible; the augmentation lives in
 * `@deepseek-ai/dsh-session/context`, and a type-only import keeps it out of
 * any emitted declarations. This file sits in the host aggregate (apps/cli
 * tests) and outside the client aggregate, so a client program never loads
 * the host `SessionStore` face.
 * @module context-host
 */

import type {} from '@deepseek-ai/dsh-session/context'

export {}
