---
description: "Function plugin giving a patent drafter or agent the writing patterns this deployment applies: the packaged YAML corpus of drafting and office-action situations reaches the model through the query_writing_patterns tool and one writing-patterns:skills system-prompt section carrying the compiled `<writing_skills>` block, and ships as a keyless library API for prompt assembly. Selection is lexical and offline — keyword search, case-feature match, category listing, or the whole library — so the same query always selects the same patterns."
kind: "package-reference"
---

# @deepseek-ai/dsh-writing-patterns

English | [中文](README.zh.md)

## Summary

Function plugin giving a patent drafter or agent the writing patterns this deployment applies: the packaged YAML corpus of drafting and office-action situations reaches the model through the query_writing_patterns tool and one writing-patterns:skills system-prompt section carrying the compiled `<writing_skills>` block, and ships as a keyless library API for prompt assembly. Selection is lexical and offline — keyword search, case-feature match, category listing, or the whole library — so the same query always selects the same patterns.

## Table of Contents

- [query_writing_patterns tool](#query_writing_patterns-tool)
- [Pattern corpus and library API](#pattern-corpus-and-library-api)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## query_writing_patterns tool

query_writing_patterns returns the writing patterns that fit a drafting or office-action situation, compiled into a `<writing_skills>` block. Each pattern covers one situation — claim drafting, specification drafting, disclosure drafting, IPC strategy, embodiment writing, and office-action replies on inventiveness, novelty, and clarity — with ordered steps and the rules to follow or avoid.

Selection order is fixed and reaches no model. A call that sets `query` searches the corpus by keyword; a call that sets features but no query matches those features against pattern names, summaries, and step names, with the category standing in as the case type; a call that sets only `category` lists that category in id order; a call with no argument lists the library. `limit` caps the returned count and defaults to the deployment's `matchLimit`.

Scoring is term containment over the authored fields. A keyword search adds 3 for a hit in the name, 2 for the summary, 1.5 for the context, 1 for a step name, 0.5 for a step instruction or a do-rule, and multiplies the total by the pattern's quality. A feature match adds 5 when the category contains the case type, 3 for a hit in the name, 2 for the summary, 1.5 for a step name, and 1 for each pattern keyword contained in the query. Equal scores are ordered by ascending pattern id, so a repeated call returns the same list.

The result carries the selection mode, each matched pattern with its id, category, name, summary, and quality, the library size, and the compiled block. A call that matches nothing returns an empty pattern list, an empty `skills`, and a line naming the library size and the way to widen the call.

## Pattern corpus and library API

The corpus ships at `assets/patterns/`, one YAML file per pattern, and resolves relative to the module through `import.meta.url`, so the source tree and the built package read the same directory. A file declares either one pattern or a `patterns` list of several, with `id`, `name`, `category`, `summary`, optional `sub_category`, `context`, `source_ref`, and `version`, plus `steps`, `examples`, `dos`, `donts`, and `quality`. The shipped ten are the seed patterns of the MIT-licensed Go project `Mady/domains/writing`: utility-model claim drafting, dependent-claim layering, background technique, invention content, the three-step inventiveness reply, separate-comparison novelty, clarity and support, the disclosure PFE triple, IPC strategy, and embodiment writing.

Loading is fail-loud. `loadPatternStore()` reads the packaged directory and `loadPatternStore(patternDir)` reads an explicit one; an unreadable directory, a directory without a pattern file, a YAML syntax error, a duplicated id, or a missing, mistyped, or out-of-range field throws `PatternAssetError` naming the file and the field. A category outside the nine known ones fails the same way, because the tool's category enum could never select such a pattern. A missing or zero `quality` takes the ported default of 0.8.

The library API exports the loaded pieces directly: `PatternStore` (`size`, `get`, `all`, `byCategory`, `search`, `match`), `loadPatternCorpus`, `parsePatternFile`, `patternKeywords`, `compileWritingSkills`, `escapeXmlText`, and `evaluateQuality`. The compiler is a pure function of the patterns and emits the exact block the prompt section injects, so a caller can assert the injected text.

`evaluateQuality(text)` scores a drafted passage on the four dimensions the source defines — structure (heading levels and paragraphs), citation (statute, decision, and patent-document references), argument (logical connectors and evidence, less filler phrasing), and terminology (domain terms, less commercial or absolute wording) — and reports their mean. The scores are a first-pass suggestion from a lexical heuristic, not a judgment of the drafting.

## Configuration

Schemastery configuration, every field optional.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| patternDir | string | packaged asset | Directory holding the pattern YAML files; must mirror the packaged layout. A missing or invalid corpus fails the plugin load. |
| matchLimit | number | 5 | Result cap applied when a call omits its own limit. The ported source capped a match at 5. |
| registerSection | boolean | true | Register the always-on writing-patterns:skills system-prompt section. |
| sectionCategories | string[] | all nine categories | Categories whose patterns the section injects; an empty list injects the instruction prose alone. |
| sectionOrder | number | 112 | Position of the injected section in the assembled system prompt, next to the patent-domain TRIZ section at 111. |

## Model Experience

### query_writing_patterns tool

#### What the model sees

One registered tool named `query_writing_patterns` with four optional parameters: `category` (one of the nine pattern categories), `query` (search keywords), `features` (the technical features of the case), and `limit`. The result renders as the matched patterns — id, category label, name, and summary — followed by the compiled `<writing_skills>` block holding their steps, do-rules, and do-not-rules. A `limit` below 1 comes back as a tool error naming the parameter, and the category enum rejects an unknown category before execution.

#### Token effect

Fixed definition cost on every request while the tool is enabled; each result repeats the selected patterns and their compiled block, so a wider `limit` costs proportionally more until compaction.

#### KV Cache effect

Append-only; newly visible result text follows the reusable request prefix and does not invalidate existing KV-cache entries.

### writing-patterns:skills system prompt section

#### What the model sees

One always-on prompt section named `writing-patterns:skills`, registered at order 112 only while `registerSection` is `true` (the default), carrying the compiled `<writing_skills>` block of the patterns in `sectionCategories` (every category by default). Its instruction prose is:

##### Verbatim instruction prose

```markdown
The <writing_skills> block below lists the writing patterns of this deployment for patent drafting and office-action replies; each pattern names one drafting situation with its ordered steps and the rules to follow or avoid.
When the case at hand is not covered by those patterns, call query_writing_patterns with the case category, the case features, or search keywords to retrieve the patterns that match it.
```

#### Token effect

Fixed cost of the two instruction lines on every request, plus the compiled block of the injected categories, which is resent only until compaction; an empty `sectionCategories` leaves the two lines alone, and `registerSection: false` removes the section entirely.

#### KV Cache effect

Prefix-stable while the section text, its order, and the compiled block are unchanged; changing `sectionCategories`, `sectionOrder`, `patternDir`, or a pattern asset recompiles the block and invalidates reuse from that section onward.

## Known Limitations and Deferred Work

- **The shipped corpus is ten seed patterns** — they cover the situations of the ported seed set and nothing else. Point `patternDir` at a deployment's own directory to replace them; every file there must satisfy the same field rules, or the plugin fails to load.
- **Selection is lexical, never semantic** — a query matches substrings of the authored Chinese fields, so a differently worded question about the same situation can miss. The last paragraph of the tool result names the library size so a model can tell a narrow library from a narrow query.
- **`query` and `features` are scored differently and do not combine** — a call that sets both searches by keyword and ignores the feature match; the feature match exists for a case whose features are known but whose wording is not.
- **The prompt section injects the whole library by default** — about 24 KB of compiled text on every request at the shipped corpus. Narrow `sectionCategories` when a deployment drafts only some of the situations; the tool stays complete regardless.
- **`examples` is parsed but never compiled** — the compiled block carries steps, do-rules, and do-not-rules, matching the ported compiler, and the seed corpus sets no examples. A consumer that renders examples reads them from the store itself.
- **The quality evaluation is a heuristic, not a judge** — four lexical dimensions with fixed term tables. The ported source also held an in-memory user-feedback store, user ratings, and an auto-versus-user calibration; none of them ship here, because a rating that lives only in one process is not durable evidence.
- **The tool is read-only and state-free** — it reads the corpus loaded at plugin load and writes no durable state or session event of its own; its results reach the log only as ordinary tool results.
- **Assets fail the load, not the call** — an invalid or missing corpus throws `PatternAssetError` while the plugin is mounting, so a deployment never reaches a model with an empty pattern library.

### Dev Note

None.

No companion is published because the package owns no durable state or event: every export is a pure function over the corpus, and the one asset directory it reads is validated fail-loud at plugin load.
