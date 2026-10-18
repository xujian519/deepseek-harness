---
kind: upgrade-guide
description: "verify_deliverable now requires every path to be a regular file no larger than 64 MiB; directories, devices, FIFOs, and oversized files are reported as violations instead of being read."
---

# Deliverable paths must be regular files within the hash limit

English | [中文](guide.zh.md)

## Change

`verify_deliverable` hashed every model-supplied path with `readFileSync` and no type or size check. A character device such as `/dev/zero` has no end-of-file and a FIFO blocks until a writer appears, so either path could hang or exhaust memory; a very large file was read whole before hashing. The check now stats first and requires a regular file no larger than 64 MiB. A missing or unreadable path keeps the existing message; a directory, device, or FIFO reports 不是普通文件, and an oversized file reports the 64 MiB limit. The violation rules are unchanged (`artifact_missing`, `figure_missing`, `rendered_missing`, `requirement_evidence_missing`), so existing rule-based handling still applies.

## Migration

1. Pass the document, drawing, or evidence file itself; copy or render one where a directory was passed.
2. Split or compress a deliverable above 64 MiB before verifying it.
3. Confirm: a directory in `canonical_path` reports 不是普通文件; a 64 MiB + 1 byte file reports the size limit; both leave `manifest` without the rejected path.
