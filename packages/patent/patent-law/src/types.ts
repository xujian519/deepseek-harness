/**
 * Shared types of the law baseline: the reference forms the model and the rule
 * assets use, the indexed entries an asset file declares, and the verdict a
 * citation receives.
 * @module @deepseek-ai/dsh-patent-law/types
 */

/** Law documents the index covers. */
export type LawName = '专利法' | '专利法实施细则' | '专利审查指南'

/** Statute whose text is indexed article by article. */
export type StatuteName = '专利法' | '专利法实施细则'

/**
 * A reference to one article of a statute, optionally narrowed to a paragraph
 * and an item.
 */
export type LawArticleReference = {
  kind: 'law-article'
  law: StatuteName
  /** Article number, as an integer. */
  article: number
  /** Paragraph (款) number when the reference names one. */
  paragraph?: number
  /** Item (项) number when the reference names one. */
  item?: number
  /** The reference exactly as it appeared in the source text. */
  raw: string
}

/**
 * A reference to one section of 专利审查指南, whose division is a part and a
 * chapter rather than an article number.
 */
export type GuidelineReference = {
  kind: 'guideline-section'
  law: '专利审查指南'
  /** Normalized section path, e.g. `第二部分第四章3.2.1.1`. */
  path: string
  /** The reference exactly as it appeared in the source text. */
  raw: string
}

/** Any reference the baseline can resolve. */
export type LawReference = LawArticleReference | GuidelineReference

/**
 * One indexed article. `text`, `sourceDoc`, and `verifiedOn` record where the
 * article text came from and when that copy was checked against that source:
 * until the article is transcribed from an official source and the copy is
 * recorded, the entry is indexed but unverified. Who performed the check is a
 * property of the shipped asset, and the asset states it.
 */
export type ArticleEntry = {
  /** Article number. */
  article: number
  /** Paragraph numbers the entry knows to exist; omitted when not yet verified. */
  paragraphs?: number[]
  /**
   * Topic keywords a proposition can name. They are one of the two signals a
   * proposition is matched by — the other is `text` — and they are an index aid,
   * not statutory text.
   */
  topics: string[]
  /** Article text, or null while it has not been transcribed. */
  text: string | null
  /** Official source the text was taken from, or null while unverified. */
  sourceDoc: string | null
  /** Date the entry's text was checked against `sourceDoc`, or null while it has not been transcribed. */
  verifiedOn: string | null
}

/** One indexed guideline section, with the same source and verification fields as an article. */
export type SectionEntry = {
  /** Normalized section path. */
  path: string
  /** Topic keywords a proposition can name; one of the two signals a proposition is matched by. */
  topics: string[]
  /** Section text, or null while it has not been transcribed. */
  text: string | null
  /** Official source the text was taken from, or null while unverified. */
  sourceDoc: string | null
  /** Date the entry's text was checked against `sourceDoc`, or null while it has not been transcribed. */
  verifiedOn: string | null
}

/**
 * One guideline section whose indexed text predates the revision that
 * supersedes it. The record makes the stale text machine-readable: a citation
 * covering the section is reported as unverified instead of passing as current
 * law.
 */
export type StaleSection = {
  /** Normalized section path whose indexed text is stale. */
  path: string
  /** Why the indexed text is stale. */
  reason: string
}

/**
 * Sections one later revision changes. A version overrides the matching paths
 * of `LawBaseline.sections` and may add paths the base revision did not index.
 * Sections it does not name keep the base text.
 */
export type GuidelineVersion = {
  /** Revision these sections state, e.g. `2026 年修订版（2026-01-01 施行）`. */
  revision: string
  /** Sections this revision changes or adds. */
  sections: SectionEntry[]
}

/** One law document's index. */
export type LawBaseline = {
  law: LawName
  /** Document title. */
  document: string
  /** Revision the index targets, or null while it has not been stated. */
  revision: string | null
  /**
   * Revision that supersedes the indexed text, or null when the index targets
   * the current revision. When set, citations to `staleSections` are reported
   * as unverified rather than valid.
   */
  supersededBy: string | null
  /** Guideline sections whose indexed text predates `supersededBy`; empty for statutes. */
  staleSections: StaleSection[]
  /**
   * Revisions that change or add guideline sections, as transcribed overrides
   * of `sections`; empty for statutes and while no later revision has been
   * transcribed. Verification uses the latest available override unless the
   * caller names a revision.
   */
  versions: GuidelineVersion[]
  /**
   * Highest article number the law has, or null while it has not been verified.
   * A reference beyond a verified ceiling is out of range; beyond an unverified
   * ceiling it is only unverified.
   */
  maxArticle: number | null
  /** Date `maxArticle` was checked against `maxSource`, or null. */
  maxVerifiedOn: string | null
  /** Where the ceiling came from. */
  maxSource: string | null
  /** Indexed articles, ascending by article number. */
  articles: ArticleEntry[]
  /** Indexed guideline sections; empty for a statute. */
  sections: SectionEntry[]
}

/** Verdict for one citation. */
export type CitationDecision =
  /** Indexed, text verified, and the proposition (when given) matches. */
  | 'valid'
  /** Indexed and verified, but the claimed proposition does not match the entry. */
  | 'mismatch'
  /** Indexed and verified, but neither the entry nor any other matches the proposition lexically. */
  | 'unmatched'
  /** Beyond the law's verified article ceiling. */
  | 'out-of-range'
  /** Not present in the index at all. */
  | 'not-indexed'
  /** Indexed, but its text, its recorded source, or its verification date is missing. */
  | 'unverified'

/** One citation's verdict, with the reason and the entry it was decided against. */
export type CitationFinding = {
  /** The reference as written. */
  raw: string
  /** The parsed reference. */
  reference: LawReference
  decision: CitationDecision
  /** Why the decision was reached, in the model's language. */
  reason: string
  /** The indexed entry the decision used, when one was found. */
  entry?: ArticleEntry | SectionEntry
}

/** How a decision is turned into a tool result. */
export type CitationPolicy = 'block' | 'warn' | 'allow'

/** Per-decision policy, so a deployment chooses which gaps may pass. */
export type CitationPolicySet = {
  /**
   * Policy for `mismatch`: the entry itself does not carry the proposition, and
   * either the cited paragraph does not exist or another entry of the same law
   * does carry it.
   */
  mismatch: CitationPolicy
  /** Policy for `unmatched`: no entry of the law carries the proposition, so nothing here decides it. */
  unmatched: CitationPolicy
  /** Policy for `out-of-range`. */
  outOfRange: CitationPolicy
  /** Policy for `not-indexed`. */
  notIndexed: CitationPolicy
  /** Policy for `unverified`. */
  unverified: CitationPolicy
}
