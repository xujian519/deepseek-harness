---
kind: upgrade-guide
description: "`FileSystem` gains the abstract `writeBytes` mutation, `FsWriteOutcome.after` becomes nullable, and `render_doc_template` can write its result to an `output_path`."
---

# Filesystem providers gain byte writes

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-fs` adds the abstract `FileSystem.writeBytes(target, bytes, expected?, signal?, sandboxPolicy?)`, the mutation twin of `readBytes`. It shares `FsWriteIntent` (`createIfAbsent` / `replaceIfVersion`) and the per-target atomic publication with `writeText`, so a consumer can write a rendered document package, image, or archive through the provider instead of a host path. `FsWriteOutcome.before` and `FsWriteOutcome.after` are `null` for a byte write: bytes have no text projection. `FsWriteOutcome.after` is therefore now `string | null`, where it was `string`. `writeText` returns the new `FsTextWriteOutcome` (`FsWriteOutcome` with a non-null `after`), so a text-only caller keeps a non-null `after` without narrowing.

`LocalFileSystem` and `SandboxedFileSystem` implement the method on the existing atomic staging path; the sandbox backend fences it exactly as it fences `writeText`. `SshFileSystem` rejects it with a typed `FS_IO_ERROR` because the private SSH helper protocol has no byte-write operation yet. Any other provider class extending `FileSystem` must implement `writeBytes`; without it the subclass no longer satisfies the abstract contract and a deployment mounting it does not compile.

`render_doc_template` (`@deepseek-ai/dsh-doc-template`) gains the optional `output_path` argument. When supplied, the tool resolves the path against the calling session's workspace and writes the rendered document — UTF-8 text for `markdown`/`html`, the raw package for `docx` — returning `path` and `bytes` alongside the existing result fields. The write runs under the deployment's resolved file policy; no per-call escalation is negotiated. Omitting `output_path` keeps the previous behavior: the result carries `content` and writes nothing. The plugin now injects `fs`, so a composition mounting `doc-template` must mount a filesystem backend.

## Migration

1. Implement `writeBytes` on every `FileSystem` subclass outside this repository. Providers that cannot write raw bytes should reject with a typed `FsError` (`FS_IO_ERROR` or a capability-specific code) rather than encoding the bytes into `writeText`.
2. Treat `FsWriteOutcome.after` as nullable wherever a write outcome crosses a text-only assumption; `before === null` still means "no diff basis".
3. Mount a filesystem backend in every deployment that mounts `doc-template`; the plugin now requires `ctx.fs`.
4. Use `render_doc_template` with `output_path` instead of asking the model to decode a base64 `content` field into a file; the SSH filesystem backend cannot write those bytes yet.
5. Confirm: `pnpm exec vitest run packages/fs/ packages/ssh/fs-ssh/ packages/document/doc-template/` passes, and a `render_doc_template` call with `format: "docx", output_path: "out/report.docx"` produces a file that `extractDocxText` reads without a `not-a-zip` problem.
