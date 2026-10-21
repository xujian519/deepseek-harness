---
kind: upgrade-guide
description: "Patent evidence judgments fail closed on unknown proof standards and unparseable sources, and evidence hashes move to prefixed SHA-256 with legacy FNV verification only."
---

# Patent evidence judgments fail closed and hash with SHA-256

English | [中文](guide.zh.md)

## Change

- `EvidenceEngine.assessProofStandard` now returns a required `status: 'evaluated' | 'unknown-standard'`. An unrecognized or blank standard produces `status: 'unknown-standard'`, `met: false`, and a `无法识别的证明标准` gap; the previous confidence-only fallback is gone. `preponderance`/`优势证据` and `clear_and_convincing`/`高度盖然性` keep their existing thresholds.
- `evaluatePublicIntent` returns `'public' | 'restricted' | 'unknown'`. A missing or unparseable source URI is `unknown` instead of `public`, and the engine marks a `major` review issue for internet-publication evidence rather than treating the source as open to the public.
- `contentHash` now emits `sha256:<64 lowercase hex>` and uses UTF-8 input. `buildWorkflowEvidenceLedger` receipt hashes and the ledger `digest` use the same form.
- `evidence-check` verifies a `sha256:` hash against the snippet and blocks on a mismatch. A legacy 1–8 character hex hash is verified with FNV-1a only: a match passes with an `EVID-FORM-INTEGRITY-LEGACY` pending item (`legacy-hash`) and a suggested SHA-256 value; a non-match, an arbitrary short hex string, an unprefixed digest, or any other external format becomes a pending integrity item instead of an automatic internal hash or a block.

## Migration

1. Update code that consumes `ProofStandardResult` to handle `status`. A request for an unfamiliar standard can no longer return `met: true`; map deployment-specific standard names to `preponderance`/`优势证据` or `clear_and_convincing`/`高度盖然性`, or keep them failing closed.
2. Treat `publicIntent: 'unknown'` as needing review. Supply a parseable `sourceUri` (including the `web:` prefix used by callers) before relying on an internet source as a public disclosure.
3. Recompute evidence hashes with `contentHash` or an equivalent `sha256sum`/`openssl dgst -sha256` value prefixed with `sha256:`. Stored ledgers need no rewrite: their hash strings are not revalidated on load, so old FNV values remain readable, but passing an old value to `evidence-check` produces the legacy pending item rather than a silent pass.
4. Confirm: an unknown standard reports `met: false` with `status: 'unknown-standard'`; an unparseable source reports `publicIntent: 'unknown'`; a tampered `sha256:` hash blocks; a matching legacy hash passes with `EVID-FORM-INTEGRITY-LEGACY`.
