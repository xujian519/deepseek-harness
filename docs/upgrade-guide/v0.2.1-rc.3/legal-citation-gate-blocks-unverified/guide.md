---
kind: upgrade-guide
description: "Legal mode now blocks citations it cannot check, and the shipped index transcribes seventeen core statutes instead of none."
---

# Legal citations must be checkable before delivery

English | [中文](guide.zh.md)

## Change

`legal_law_verify` decides an indexed article as `unverified` when its text has not been transcribed, and a law or article the index does not carry as `not-indexed`. Both decisions now default to `block` instead of `warn`, and the `legal` preset states that policy explicitly. The delivery gate on `document_deliver` additionally requires the verification result to carry at least one finding, so a call over empty text no longer satisfies the prerequisite.

The shipped index transcribes seventeen core statutes: 民法典, 刑法, 公司法, 劳动法, 劳动合同法, 民事诉讼法, 刑事诉讼法, 行政诉讼法, 专利法, 商标法, 著作权法, 反不正当竞争法, 个人信息保护法, 行政处罚法, 行政许可法, 行政复议法, and 仲裁法. Each entry records the source file and the transcription date. That date records a mechanical copy from the source, not that a qualified person read the text back. The remaining generated files keep `text: null` and are decided `unverified`.

Two source gaps are recorded: the corpus omits 刑事诉讼法 article 128, and an amendment article written as `第 N 条之一` is folded into its base article instead of indexed separately.

## Migration

1. A legal deliverable that cites a statute outside the seventeen transcribed laws, or an article the corpus omits, is now refused at `document_deliver`. Either cite a transcribed provision, point `baselineDir` at a deployment index that transcribes the provisions you need, or relax `onUnverified` / `onNotIndexed` in `Config` when that is the deliberate policy for a narrower corpus. A deployment index must now carry the `manifest.json` the loader reads to learn which law each file holds; `assertLegalLawIndexReadable` rejects a directory without it at plugin load.
2. Running `legal_law_verify` over empty text no longer satisfies the delivery gate: the result must carry at least one finding.
3. Re-generating the index through the transcription path: `tsx scripts/legal-knowledge-import/generate-law-yaml.ts <source-dir> packages/legal/legal-law/assets/legal-law --transcribe --verified-on <YYYY-MM-DD> --only <names>`. Without `--transcribe` the entries return to `text: null`. The command rewrites `manifest.json` after the YAML files; a directory whose YAML files were changed by hand needs `tsx scripts/legal-knowledge-import/generate-law-manifest.ts <dir>`, and a file whose `law` or `document` disagrees with its manifest row fails when that law is next cited.
4. Reviewers should read `unverified` as "this index cannot decide the citation", not as "the citation is wrong"; a transcribed entry that does not carry the proposition is reported `mismatch`.
