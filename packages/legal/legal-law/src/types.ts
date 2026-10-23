/**
 * Shared types of the legal-law baseline: the reference forms the model and
 * the rule assets use, the indexed entries an asset file declares, and the
 * verdict a citation receives.
 * @module @deepseek-ai/dsh-legal-law/types
 */

/**
 * Law documents the index covers.
 *
 * Dynamically expanded: any statute name string is accepted. The constant
 * {@link LEGAL_LAW_NAMES} in `baseline.ts` lists the names the shipped asset
 * files declare, but new laws can be added without a type change.
 */
export type LegalLawName = string

/**
 * A reference to one article of a statute, optionally narrowed to a paragraph
 * and an item.
 */
export type LegalLawArticleReference = {
  kind: 'law-article'
  law: LegalLawName
  /** Article number, as an integer. */
  article: number
  /** Paragraph (款) number when the reference names one. */
  paragraph?: number
  /** Item (项) number when the reference names one. */
  item?: number
  /** The reference exactly as it appeared in the source text. */
  raw: string
}

/** Any reference the baseline can resolve. */
export type LegalLawReference = LegalLawArticleReference

/**
 * One indexed article. `text`, `sourceDoc`, and `verifiedOn` record where the
 * article text came from and when that copy was checked against that source:
 * until the article is transcribed from an official source and the copy is
 * recorded, the entry is indexed but unverified.
 */
export type LegalArticleEntry = {
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

/**
 * One law document's index.
 */
export type LegalLawBaseline = {
  law: LegalLawName
  /** Document title. */
  document: string
  /** Revision the index targets, or null while it has not been stated. */
  revision: string | null
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
  articles: LegalArticleEntry[]
}

/** Verdict for one citation. */
export type LegalCitationDecision =
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
export type LegalCitationFinding = {
  /** The reference as written. */
  raw: string
  /** The parsed reference. */
  reference: LegalLawReference
  decision: LegalCitationDecision
  /** Why the decision was reached, in the model's language. */
  reason: string
  /** The indexed entry the decision used, when one was found. */
  entry?: LegalArticleEntry
}

/** How a decision is turned into a tool result. */
export type LegalCitationPolicy = 'block' | 'warn' | 'allow'

/** Per-decision policy, so a deployment chooses which gaps may pass. */
export type LegalCitationPolicySet = {
  /**
   * Policy for `mismatch`: the entry itself does not carry the proposition, and
   * either the cited paragraph does not exist or another entry of the same law
   * does carry it.
   */
  mismatch: LegalCitationPolicy
  /** Policy for `unmatched`: no entry of the law carries the proposition, so nothing here decides it. */
  unmatched: LegalCitationPolicy
  /** Policy for `out-of-range`. */
  outOfRange: LegalCitationPolicy
  /** Policy for `not-indexed`. */
  notIndexed: LegalCitationPolicy
  /** Policy for `unverified`. */
  unverified: LegalCitationPolicy
}
