---
description: "Function plugin checking law citations against the law index shipped with the package: article and guideline-section reference parsing, a per-law index recording each entry's source and verification date, decisions that never report an unverified article as checked, and the law_verify tool."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-law

English | [中文](README.zh.md)

## Summary

Function plugin checking law citations against the law index shipped with the package: article and guideline-section reference parsing, a per-law index recording each entry's source and verification date, decisions that never report an unverified article as checked, and the law_verify tool.

## Table of Contents

- [law_verify tool](#law-verify-tool)
- [Citation decisions and policy](#citation-decisions-and-policy)
- [Law index assets](#law-index-assets)
- [Library API](#library-api)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="law-verify-tool"></a>
## law_verify tool

law_verify reads the citations of a text, or the references passed directly, and decides each one against the index this deployment ships: 《专利法》 and 《专利法实施细则》 by article, 《专利审查指南》 by normalized section path. Each finding carries the decision, the policy the deployment applies to it, and the reason.

The tool exists because citation checking was previously split across four unrelated places — a static topic table in the workflow quality gate, an article ceiling in the rule assets, the `legalBasis` prose of 145 rule files, and a user-level baseline file that is not shipped — so a wrong article number could pass unnoticed. One index, one parser, one decision fixes the reference form; it does not decide whether the law is right, and it says so.

<a id="citation-decisions-and-policy"></a>
## Citation decisions and policy

| Decision | Meaning |
| --- | --- |
| 已核验 (`valid`) | Indexed, transcribed from a recorded source, and the proposition (when given) is supported by the entry's topics. |
| 与所引命题不符 (`mismatch`) | Indexed and transcribed, but the cited paragraph does not exist or the proposition is not supported. |
| 条号超出有效范围 (`out-of-range`) | Beyond the article ceiling **and** that ceiling has itself been verified. |
| 索引中不存在 (`not-indexed`) | Not in the index at all, or the law has no index in this deployment. |
| 条文未转录（未核验）(`unverified`) | Indexed, but its text, its recorded source, or its verification date is still missing; also what an article beyond an unverified ceiling reports. |

The four policies are per-decision Config fields (`onMismatch`, `onOutOfRange`, `onNotIndexed`, `onUnverified`), each `block`, `warn`, or `allow`. The shipped default blocks a contradiction or a verified out-of-range number and warns on a gap in the index, so a partially transcribed index stays usable while every gap stays visible.

<a id="law-index-assets"></a>
## Law index assets

`assets/law/` holds one file per document (`cn-patent-law.yaml`, `cn-implementing-regulations.yaml`, `cn-examination-guidelines.yaml`). An entry records the article or section path, the topic keywords used to test a proposition, and where the text came from: `text`, `sourceDoc`, `verifiedOn`. An article ceiling carries its own `maxVerifiedOn`, because a ceiling nobody has verified must not produce an `out-of-range` verdict.

```yaml
- law: 专利法
  article: 22
  paragraphs: [1, 2, 3]
  topics: [新颖性, 创造性]
  text: <现行条文>
  sourceDoc: <官方文本标识>
  verifiedOn: 2026-01-01
```

The shipped index is an index only: article numbers and topic keywords collected from this repository's existing citations, with every `text` and `verifiedOn` still null, and with the 62/69/70 group flagged in the file header as apparently carrying pre-2020 numbering. Until a person transcribes the articles from an official source, every citation against it reports 未核验 — never 已核验.

<a id="library-api"></a>
## Library API

- `parseLawReference(text)` / `extractLawReferences(text)` / `formatLawReference(reference)` — the reference forms: `专利法第22条第3款`, `《专利法》第二十二条第三款`, `A22.3`, `细则第112条`, `审查指南第二部分第四章3.2.1.1`.
- `parseCnNumber(text)` / `formatCnNumber(value)` — Chinese numerals (`一百一十二` ↔ `112`).
- `loadLawBaselines(dir?)` / `parseLawBaseline(source, origin)` / `findArticle` / `findSection` — the index, validated fail-loud.
- `verifyCitation(reference, baselines, options)` / `verifyCitations(text, baselines, options)` — decisions.
- `resolveCitationPolicy(finding, policies)` / `renderCitationFindings` / `renderCitationRows` — policy and rendering.

No service is published: the index is a read-only asset and the tool is the in-process consumer. A second consumer imports the library, the way `dsh-patent-core` is consumed as a pure library, rather than resolving a service for a value that never changes at runtime.

<a id="configuration"></a>
## Configuration

Schemastery configuration; `baselineDir` is optional, every policy field defaults.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| baselineDir | string | packaged assets | Directory holding the law-index YAML files. A missing, empty, or malformed directory fails the plugin load. |
| onMismatch | `block` \| `warn` \| `allow` | `block` | Treatment of a citation whose proposition a verified entry does not support. |
| onOutOfRange | `block` \| `warn` \| `allow` | `block` | Treatment of a citation beyond a verified article ceiling. |
| onNotIndexed | `block` \| `warn` \| `allow` | `warn` | Treatment of a citation the index does not hold. |
| onUnverified | `block` \| `warn` \| `allow` | `warn` | Treatment of an indexed entry awaiting transcription. |

<a id="model-experience"></a>
## Model Experience

### law_verify tool

#### What the model sees

One registered tool named `law_verify` with optional `text` (whose citations are extracted), optional `references` (exact references), and optional `proposition` (what the citations support); at least one of `text` or `references` is required. The result is the canonical finding list — raw reference, law, article, paragraph, section path, decision, policy, reason — plus a `blocked` flag and decision counts, rendered as a Markdown table followed by the notes a gap or a block implies. The tool description states the five decisions, that an unverified article is never reported as checked, and that a reference which is not exactly one reference is an input error.

#### Token effect

Fixed definition cost on every request while the tool is enabled; each result is one short table plus notes, resent only until compaction.

#### KV Cache effect

Append-only; newly visible result prose follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The shipped index is not a law text.** It holds article numbers and topic keywords only; every entry is 未核验 until a person transcribes it from an official source. Citations therefore stay 未核验 in a default deployment, which is the intended behavior, not a clean result.
- **The 62/69/70 group in the 专利法 index appears to carry pre-2020 numbering**, inconsistent with the 2020 numbering used elsewhere in this repository (第71条 damages, 第74条 limitation period). The file header records this; do not treat the index as authority on article numbers before verification.
- **Proposition matching is lexical.** A topic keyword must appear in the proposition or vice versa; a proposition phrased around a synonym the entry does not list reports `mismatch`. Topics must be maintained with the transcription.
- **The compact `A22.3` form is accepted only at a token boundary**, and it is always read as 《专利法》: a deployment that needs the form for another statute would need its own reference reader.
- **The guideline index is section-path keyed.** A citation written in a form the normalizer does not reproduce (for example a section nested deeper than the captured tail) lands in `not-indexed` rather than being guessed at.
- **The automatic gates keep their own tables.** The patent preset mounts this plugin, so the model runs law_verify first; feeding the workflow quality gate's static topic table and the rule assets' citation ceiling from this index is follow-up work, because a gate that delegated to an entry with no transcribed text could only downgrade today's topic check to a warning.
- **No package invariant is published.** Baseline correctness is a property of the content, and no runtime observation can falsify it independently; the mechanically checkable parts (references parsing, article and section existence, the article ceiling) are checks the gate runs, so they do not meet the invariant bar.

### Dev Note

None.

No companion is published because the package owns no durable state or session event: the index is read at load, and every export is a pure function over an explicit query.
