# Agent Note: Document-studio preview over the workspace-files Remote

Status: implemented

English | [中文](2026-09-19-document-studio-preview-over-the-workspace-files-remote.zh.md)

## Problem

The [upstream v0.1.2-alpha.1 sync](../process/2026-08-28-upstream-v0.1.2-alpha.1-sync.md) removed `packages/host/apiproxy`, which was the host surface behind the document studio's preview read (`connection.api.host.readFileText`). The studio kept a loud-failing inject with a `FIXME(port)`, so selecting a produced file showed an error instead of its text, and the print action could not re-read a truncated head at all. That sync note carries the gap as follow-up 1.

Upstream later added the session-scoped `workspaceFiles` Remote (`@deepseek-ai/dsh-api-workspace-files`), which serves bounded reads of files resolvable through a Session's filesystem to the web client: `stat`, text pages (`read`), byte windows (`readBytes`), complete bytes (`readAll`), directory listing, and a change feed. Its caps are the plugin's `Config` (`maxBytes`, `maxFileBytes`, `maxLines`), set by the composition.

## Decision

The studio reads produced files through `remote.workspaceFiles`, and the read semantics that used to live in the removed host RPC move to the studio's client half.

- **The preview takes one byte window.** `readBytes(sessionId, resolve(path), {})` asks for the host's configured window: `readBytes` refuses a window wider than `maxBytes` and never fails for a large file, which is what previewing a just-printed deliverable needs. `readAll` cannot serve the preview, because it refuses a file above `maxFileBytes` rather than returning a head.
- **Print re-reads completely.** When the preview head was truncated, `readAll(sessionId, resolve(path))` returns the whole file for the PDF, and the host's `workspace-file/too-large` refusal becomes the studio's existing too-large note. Any other failure keeps the host's message.
- **`truncated` has one meaning across both reads**: this read did not return the complete file — a window that stopped short of the last byte, or a complete read the host refused for size.
- **Paths resolve through the Session workspace**, exactly as the open and show-in-folder intents already do (`resolveWorkspacePath(cwd, path)`), so all three intents address one file.
- **Text decoding lives in `src/client/file-reads.ts`.** The host's byte window is raw by design — no decoding, no binary rejection — so `decodeByteWindow` owns the text contract: a character the window cut in half is dropped whole rather than decoded to replacement glyphs, and invalid UTF-8 throws, which the wiring reports as `not valid UTF-8: <path>`. The window is a prefix cut at a byte boundary, so the scan for an incomplete final sequence spans at most one character.
- **The view's injected face splits into two reads**, `readFileText` (the preview window) and `readFileTextComplete` (print), and the client's `maxBytes` parameter, its 1 MiB default, and the `PRINT_MAX_BYTES` ceiling are deleted: the host's `Config` owns read budgets, and the client names none.
- **The package declares what it calls.** `@deepseek-ai/dsh-api-workspace-files` joins the studio's dev dependencies (the import is type-only, for the generated Remote face and the byte-window types), the package's tsconfig references that package's client face config, and the plugin injects `remote.workspaceFiles` beside `remote` and `remote.session`.

## Consequences

Selecting a produced file previews it again, and printing a truncated preview exports the complete document instead of refusing. The studio now inherits the deployment's read caps: the preview head is the host's `maxBytes` window (2 MiB by default) rather than the removed 1 MiB client budget, a file above the host's `maxFileBytes` reports the too-large state instead of an error line, and raising either cap is a composition change to `dsh-api-workspace-files`, not a plugin change.

The FIXME is gone, and the [v0.1.2-alpha.1 sync note](../process/2026-08-28-upstream-v0.1.2-alpha.1-sync.md)'s follow-up 1 is closed; its follow-up 2 (synapse live-reply text) remains open. The studio's client source stays outside the per-file coverage gate under the existing bundle-artifact exemption, so the new reads are pinned by unit specs and by the artifact spec that applies the built plugin against a real registry.

## Alternatives considered

- **Add a host `readFileText` Remote of our own.** Rejected: upstream's `workspaceFiles` already serves session-scoped bounded reads with a resolved-workspace trust model, and a second file-read Remote would duplicate a capability seam rather than consume it.
- **Keep the caller's 1 MiB / 4 MiB budgets in the client.** Rejected: those are deployment-varying caps, which the host `Config` now owns; a client-chosen window above `maxBytes` is refused outright, so keeping the constants would have made the print re-read fail on a default composition.
- **Preview through `read` (paged lines) instead of a byte window.** Rejected: a page whose bytes exceed `maxBytes` fails rather than being shortened — upstream's deliberate choice, so a page never reads as the whole file — which would turn a large HTML deliverable into an error where a head and a truncation note belong.
- **Decode the window on the host.** Rejected: `readBytes` is documented as raw bytes with no decoding and no binary rejection, and the studio is the consumer that needs text; keeping the strict decode at the consumer preserves the removed RPC's behaviour without widening the shared endpoint's contract for every caller.
- **Report the full-file cap refusal as a thrown error and drop the `studio.print.tooLarge` copy.** Rejected: the localized note is the message the user needs, and an English host string would replace it in a bilingual UI.

## Testing

`pnpm exec vitest run packages/client/ui-document-studio` passes 41 tests across six files, including the new `file-reads.client.spec.ts` (window decode, a character cut in half, invalid UTF-8, the host cap refusal mapped to the too-large state, and both failure messages) and the tsdown artifact spec, which loads the built client, applies the plugin against real registries, and asserts the new inject list. The two view specs drive the print path through `readFileTextComplete`. `pnpm run typecheck` (both faces), `pnpm run lint`, `pnpm run duplication`, `pnpm run verify-package-dependencies` (71 packages), and the documentation gates pass on the change.
