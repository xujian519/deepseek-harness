/**
 * Virtual root of the worker host's in-memory filesystem. The root and the
 * home leaf come from {@link DEFAULT_ROOT} / {@link IMAGE_HOME_DIRECTORY}, the
 * layout the packer writes and the host mounts; the remaining leaves are
 * runtime-only paths under that root.
 */

import { DEFAULT_ROOT, IMAGE_HOME_DIRECTORY } from '../image-layout.ts'

/** Virtual filesystem root; `process.cwd()` and every absolute path start here. */
export const DSH_ROOT = DEFAULT_ROOT

/** `$DSH_HOME`: durable-state directory inside the image. */
export const DSH_HOME = `${DSH_ROOT}/${IMAGE_HOME_DIRECTORY}`

/** Flat, symlink-free package tree resolved by the worker module loader. */
export const DSH_NODE_MODULES = `${DSH_ROOT}/node_modules`

/** Directory holding the composed cordis.yml. */
export const DSH_CONFIG = `${DSH_ROOT}/config`

/** Default (empty) workspace directory. */
export const DSH_WORKSPACE = `${DSH_ROOT}/workspace`

/** Temporary directory reported by `os.tmpdir()`. */
export const DSH_TMP = `${DSH_ROOT}/tmp`
