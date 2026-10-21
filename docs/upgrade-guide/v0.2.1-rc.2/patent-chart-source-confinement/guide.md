---
kind: upgrade-guide
description: "Claim-chart source reads are confined to configured roots, text files, and a size limit, so a model-authored path can no longer reach arbitrary files."
---

# Claim-chart source reads are confined

English | [中文](guide.zh.md)

## Change

- `claim-chart` resolves every target `sourcePath` against the working directory, calls `realpath`, and requires the real path to lie inside an allowed root. The default root is the working directory; the `chart_source_roots` stage param replaces it, and an empty list denies every read. A path that escapes through `..` or through a symlink to outside a root fails the rows that reference it.
- Only regular text files are readable. A directory, a non-regular file, an extension outside the text allowlist (`.pdf`, `.docx`, …), or a file above `chart_source_max_bytes` fails the referencing rows. Extensionless paths are accepted. The allowlist covers `.txt`, `.text`, `.md`, `.markdown`, `.json`, `.jsonl`, `.csv`, `.tsv`, `.xml`, `.html`, `.htm`, `.yaml`, `.yml`, `.log`, `.rst`, and `.tex`.
- An invalid root (unresolvable or not a directory) or a malformed `chart_source_roots` / `chart_source_max_bytes` degrades the stage before any model call. `chart_source_max_bytes` defaults to 1 MiB and accepts integers from 1 byte to 16 MiB.
- Source text is still read only to verify pin-cites and quotes and never enters the prompt.

## Migration

1. Keep source files under the working directory, or set `chart_source_roots` to the directories they live in. A target that needs no source verification omits its `sourcePath`; `chart_source_roots: []` denies every read rather than skipping verification.
2. Convert PDF or DOCX evidence to text, or reference an already extracted `.txt`/`.md` file.
3. Raise `chart_source_max_bytes` (up to 16 MiB) when a legitimate source exceeds 1 MiB.
4. Confirm: a source outside the roots or over the limit produces a row error naming the file and the reason, and a source inside the roots passes pin-cite and quote verification as before.
