# Agent Note: A byte write path on the filesystem seam, so a rendered DOCX can reach disk

Status: implemented

English | [中文](2026-10-19-document-write-bytes-seam.zh.md)

## Problem

The document preset promised Word output and could not produce it. `render_doc_template` rendered a `.docx` package and returned it base64-encoded in the result's `content` field, but the tool's rendered text only said how many base64 characters the field held, and the durable event omits tool-result values. The model therefore never saw the bytes it was supposed to save, while `document-word` told it to pipe them through `base64 -d`. The package was reachable in the tool result and nowhere else: the one route to a `.docx` file was a shell command whose input the model could not read.

The filesystem seam had no way to change that. `FileSystem` exposed `writeText` and `editText`, both UTF-8; a DOCX package is a zip, so a consumer holding bytes had no service method to publish them. Writing through `node:fs/promises` inside the tool would have bypassed the `fs/write-intent` policy and the `fs-sandbox` workspace fence that every other write in the process goes through.

## Decision

**`FileSystem` gains `writeBytes`.** It mirrors `writeText`: the same `FsWriteIntent` guard, the same atomic publication and outcome, the same optional per-call `SandboxExecutionPolicy`, and `before`/`after` left `null` because there is no text diff basis for a binary document. The three providers implement it — `fs-local` shares the locked write path with `writeText`, `fs-sandbox` fences the target and then delegates, and `fs-ssh` writes the buffer over SFTP. Test doubles that extend the abstract class implement it too.

**`render_doc_template` becomes the consumer.** The tool gains an optional `output_path`: with it, a Markdown or HTML render is written through `writeText` and a DOCX render through `writeBytes`, and the result reports the path and byte count alongside the same content; without it, the result is exactly what it was. The call omits `sandboxPolicy`, so the write runs under the deployment default — a workspace-confined deployment refuses a path outside its root instead of silently allowing it. That limit is recorded in the package's Known Limitations rather than negotiated per call.

**The packaging consequence is a published one.** A third-party `FileSystem` provider must implement the new abstract method; the upgrade guide names it. `doc-template` now declares `fs` as an injection, so a composition that mounts the template tools without a filesystem fails at load instead of at the first render.

## Alternatives considered

**Write the bytes from `doc-template` with `node:fs/promises`.** Rejected: it bypasses the write-intent policy and the sandbox fence, and it would have made the template package the only writer in the repository that no `fs` provider observes.

**Move the write into `document_deliver`.** Rejected by the 2026-10-13 delivery-gate ruling: the registration tool verifies bytes that already exist, and turning it into a writer would duplicate `doc-template` while still missing the hand-written routes.

**Have the model decode the base64 itself.** Rejected: the base64 is not in the model's context (tool-result values are omitted from durable events), so the command had no input; and a shell route would still need the bytes to be visible first.

## Consequences

A DOCX is now reachable end to end: render with `output_path`, then `document_deliver` reads the file it just wrote and reports `checked` instead of `unreadable`. Binary writes from other tools have a service method to call instead of reaching for `node:fs`. The cost is one more method every provider must implement, and one more injection the template package requires.

## Deferred

Per-call sandbox escalation for `doc-template` writes. The tool does not resolve a policy for the call, so a deployment that wants the tool to ask for escalation on an out-of-workspace path would need the same `sandboxPolicy` negotiation `tool-fs` performs. No current consumer needs it.
