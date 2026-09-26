# Agent Note: shipped patent law index and citation verdicts

Status: implemented

English | [中文](2026-09-26-shipped-patent-law-index.zh.md)

## Problem

"What articles exist, and what does each cover" lived in four places that never met. `packages/patent/patent-workflow/src/quality-gate.ts` held a topic table covering roughly twenty articles of 《专利法》 and one article of 《专利法实施细则》. `packages/patent/patent-rule/assets/rules/patent/compliance.yaml` and `assets/rules/base/citation.yaml` each carried the same "82 条" ceiling. The 145 rule assets carried article numbers as free `legalBasis` prose. And the fact-check skill told the model to compare citations against `~/.agents/skills/patent-legal/_shared/patent-law-baseline-2024.md` — a Sati user-level file that no longer ships, so on any other machine the comparison had nothing to compare against while the skill still read as satisfied.

The gate consequence: a citation outside the table came back `unknown` and passed. Every 《专利法实施细则》 citation — including the article numbers the deadline labels themselves print — was in that category, so the pipeline could announce a verified citation set that nothing had verified.

## Decision

`@deepseek-ai/dsh-patent-law` owns one law index and one decision vocabulary for the patent domain, and ships as an ordinary function plugin in the `patent` agent preset.

- **Index, not law text.** `assets/law/` holds one file per document (《专利法》《专利法实施细则》《专利审查指南》). An entry records the article or normalized guideline section path, topic keywords, and where its text came from: `text` / `sourceDoc` / `verifiedOn`. The article ceiling carries its own `maxVerifiedOn`, because a ceiling nobody verified must not produce an out-of-range verdict.
- **Five verdicts, and `unverified` is not `valid`.** `已核验` / `与所引命题不符` / `条号超出有效范围` / `索引中不存在` / `条文未转录（未核验）`. An indexed entry whose text has not been transcribed reports `unverified`; an article beyond an unverified ceiling also reports `unverified`. Four per-decision policies (`onMismatch`, `onOutOfRange`, `onNotIndexed`, `onUnverified`) choose block, warn, or allow; the shipped defaults block a contradiction or a verified out-of-range number and warn on index gaps.
- **`law_verify` is the model-facing half.** It extracts references from text or takes them directly, decides each against the index, and renders the decision table plus the note a gap or a block implies. The tool description states that an unverified article is never reported as checked.
- **The shipped statutes are transcribed; the guideline sections are not.** Each 《专利法》 and 《专利法实施细则》 entry carries the text of the article it indexes, the document and revision that text was copied from, and the date of the copy, so a statute citation now decides to `valid` or `mismatch` instead of `unverified`. Both article ceilings are verified against the same text, which is what makes `out-of-range` reachable. The copy is mechanical — a verbatim transcription from the deployment's legal corpus — and the asset header states that no qualified person has read it back; `verifiedOn` records when the entry was checked against `sourceDoc`, not who performed the check. The 《专利审查指南》 sections carry topics only, so every guideline citation stays `unverified`.
- **The persona and the two gates read it first.** Persona discipline 3, the tool-and-skill section, and the delivery discipline in `presets/patent.patch.yml` now run `law_verify` before cnlaw; `patent-fact-check` gained the two-step rule (form and index membership first, then the official text) and `patent-quality-gate` item 2 and item 7 follow it. The unshipped user-level baseline path is gone.

## Verdict semantics

`索引中不存在` is not evidence that an article does not exist — a partial index cannot prove absence, and only a *verified* ceiling can. Coverage is deliberately partial: 《专利法》 indexes 36 of its 82 articles and 《专利法实施细则》 26 of its 149, so an existing article the index does not hold reports `not-indexed` and the reason says the index does not carry it rather than that the number is wrong. `条文未转录（未核验）` transfers no confidence in either direction: the entry's topic keywords are an index aid, and proposition matching runs only once an entry has transcribed text. Policy resolution therefore keeps `notIndexed` a warning by default, and a deployment that transcribes the entries it relies on can tighten `onUnverified` to `block` from its own profile patch.

The curated topics for 现有技术抗辩 / 不视为侵权 / 合法来源 arrived as the 2008 revision's article numbers 62 / 69 / 70. The 2020 text confirmed where the current revision carries them — 67 / 75 / 77 — and the entries moved there, with 62 re-topicked to the compulsory-licence royalty provision its 2020 text holds. The renumbering is recorded in the asset header because the workflow quality gate's static table held the same pre-2020 numbers, and a reader comparing the two would otherwise find two numbering systems.

Transcribing 《专利法实施细则》 also settled what its topics were attached to: nine of the 26 entries carried another article's topics — 第 42 条 held 分案申请, which is 第 48 条, and 第 114 条 held 印花税, which the current fee schedule does not charge — so the tool reported `mismatch` on propositions those articles do carry and passed propositions they do not. Each list was rewritten from the article the entry transcribes. Topics authored out of the repository's existing citations are claims about an article that nothing checks; the transcribed text is what checks them, which is why the asset header now records that the two statutes' lists were gone over against their text.

## Why the automatic gates keep their own tables

The workflow quality gate's static table and `patent-rule`'s `citation_analysis` ceiling are **not** rewired to the index in this change. The gate decides with a five-verdict vocabulary of its own (`valid` / `unknown` / `unverifiable` / `suspect` / `invalid`) and `unknown` passes, so delegating means deciding what the gate does with each decision this index returns — a change to the gate's contract rather than to the index. Its table was moved onto the 2020 article numbers in a stacked change, but it holds fewer articles than the index and passes a citation it has no row for. The duplication stays visible rather than half-fixed.

## Alternatives considered

**Ship the Sati baseline file with the package.** It is a 13 KB 2024 prose baseline, so it would restore the fact-check path with no new code. It lost because prose cannot be indexed, diffed, or checked per article: the gate would still be reading text a person wrote once, with no way to tell a transcribed article from a remembered one, and the file's own version header would drift from the law.

**Wire the index into the quality gate and `rule_check` immediately.** It would remove the duplicated ceiling in one move. It lost on the verdict-vocabulary problem above: with no transcribed entry, the strongest available verdict is `unverified`, and reporting that as a block would stop every delivery while reporting it as a pass would recreate the false confidence the index exists to remove.

**Keep article metadata in the rule assets and skip a package.** Cheaper — the ceiling already lives there. It lost because the fact-check skill needs a *decision*, not a keyword list, and the four homes would remain four: a rule asset can be checked for its own consistency but cannot answer what a citation decides.

**Transcribe both laws in full.** 《专利法》 has 82 articles and 《专利法实施细则》 149, and the text to copy them from was at hand, so indexing all 231 article numbers would remove the `not-indexed` gap class outright. It lost on what the asset is for: the entries exist to decide the citations this domain writes, and the 169 uncited articles would arrive without curated topics, so their only effect is to replace "the index does not carry it" with "the index carries it but cannot judge it". Coverage grows the way the topics do — as citations need it.

## Consequences

A default deployment now decides a statute citation against transcribed text and leaves a guideline citation honestly unverified, so what remains is to transcribe the guideline sections a deployment relies on and to decide the gate wiring above — both named here rather than hidden. In exchange, the domain has one home for article metadata, one parser for the four citation forms the model writes, and a verdict vocabulary that cannot present an unchecked entry as checked; the four places that used to answer "does this article exist" can now converge on it instead of drifting apart.

The `patent` preset has no recorded-session snapshot: its snapshots mount individual rows rather than the preset, because a preset is agent-plane and only `dsh-agent-preset-registry` mounts one. The composition itself is pinned by `packages/bundle/web-app/tests/patent-preset.spec.ts`, which now also fails if the `patent-law` row disappears while the persona and skills still instruct the model to call `law_verify`.
