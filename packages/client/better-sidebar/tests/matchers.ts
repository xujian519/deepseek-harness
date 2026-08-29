import { expect } from 'vitest'

/**
 * Typed vitest asymmetric matchers. Vitest declares every matcher return as
 * `any`, which object-literal assignment positions reject under
 * no-unsafe-assignment; these wrappers restore a concrete type at the cast.
 */

/** A {@link expect.stringContaining} matcher typed as `string`. */
export const anyString = (part: string): string => expect.stringContaining(part) as string

/** An {@link expect.any} instance matcher typed as the constructor's instance. */
export const anyInstanceOf = <T>(ctor: new (...args: never[]) => T): T => expect.any(ctor) as T
