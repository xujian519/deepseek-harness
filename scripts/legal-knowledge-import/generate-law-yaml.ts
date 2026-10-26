/**
 * Generate `LegalLawBaseline`-format YAML index files from parsed law Markdown.
 *
 * The generator produces one `.yaml` file per law document. Each file declares
 * the law name, document title, revision, article ceiling, and an article list
 * that the `@deepseek-ai/dsh-legal-law/baseline` loader consumes at runtime.
 *
 * @module generate-law-yaml
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { dump as yamlDump } from 'js-yaml'
import { parseLawMarkdown, type ParsedLaw } from './parse-law-md.ts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Options that control what the generated index records. */
export type GenerateIndexOptions = {
  /**
   * Write each article's body, source file, and transcription date into the
   * index. Without this, entries stay `text: null` and cite only existence.
   */
  transcribe?: boolean
  /** Date recorded as the transcription check date; required when transcribing. */
  verifiedOn?: string
}

/** Options for a batch run: index options plus the law documents to emit. */
export type BatchGenerateOptions = GenerateIndexOptions & {
  /**
   * Emit only these law keys, each either a `shortName` (e.g. `民法典`) or a
   * split-file key (e.g. `民法典·总则`). Omit to emit every law.
   */
  only?: readonly string[]
}

/** Result summary for a batch run. */
export type BatchResult = {
  /** Number of files successfully processed. */
  processed: number
  /** Number of files skipped (e.g. `_index.md`). */
  skipped: number
  /** Files that failed to parse, with their error messages. */
  failures: Array<{ file: string; error: string }>
  /** Output files written. */
  written: string[]
}

// ---------------------------------------------------------------------------
// Topic extraction
// ---------------------------------------------------------------------------

/**
 * Pre-defined legal terms frequently found in Chinese law texts.
 *
 * Organised by domain so the extractor can surface domain-specific keywords
 * rather than generic ones.  The list is intentionally conservative — only
 * terms that are unambiguous when they appear as substrings are included.
 */
const LEGAL_TERMS: readonly string[] = [
  // ── General legal concepts ──────────────────────────────────────
  '新颖性', '创造性', '实用性',
  '专利权', '商标权', '著作权', '知识产权',
  '侵权责任', '违约责任', '赔偿责任', '民事责任', '刑事责任', '行政责任',
  '合同', '违约', '赔偿', '诉讼时效', '管辖权', '仲裁', '调解',
  '证据', '举证责任', '鉴定', '保全', '强制执行',
  '行政处罚', '行政许可', '行政强制', '行政复议', '行政诉讼',
  '法人', '自然人', '非法人组织', '民事权利', '民事义务',
  '物权', '债权', '担保', '抵押', '质押', '留置',
  '继承', '遗嘱', '法定继承', '遗嘱继承',
  '婚姻', '离婚', '抚养', '赡养', '收养',
  '劳动者', '用人单位', '劳动合同', '劳动争议', '工伤保险',
  '消费者', '经营者', '产品质量', '食品安全',
  '环境保护', '环境影响评价', '排污', '生态',
  '税收', '纳税人', '应纳税额', '税率', '免征',
  '证券', '保险', '银行', '信托',
  '土地', '建设用地', '宅基地', '承包经营权',
  '规划', '建设许可', '房屋征收',
  '个人信息', '隐私权', '数据安全', '网络安全',
  '反垄断', '反不正当竞争', '商业秘密',
  '国防', '国家安全', '军事',
  '教育', '义务教育', '高等教育',
  '医疗卫生', '药品', '中医药',
  '农产品', '种子', '农药',
  '野生动物', '森林', '草原', '渔业',
  '矿产资源', '水资源',
  '交通运输', '铁路', '民用航空', '港口',
  '电力', '能源', '核安全',
  '计量', '标准化', '质量',
  '审计', '会计', '政府采购', '招标投标',
  '海关', '进出口', '商品检验', '检疫',
  '消防', '安全生产', '矿山安全',
  '防洪', '防震减灾', '突发事件',
  '传染病', '公共卫生',
  '慈善', '红十字会', '未成年人', '老年人', '妇女', '残疾人',
  '公务员', '法官', '检察官', '律师', '公证',
]

/**
 * Regex patterns that capture common legal-concept compounds.
 *
 * Each pattern captures a 2–4 character prefix followed by a legal suffix
 * such as 权 / 责任 / 行为 / 制度 / 管理 / 保护.
 */
const CONCEPT_PATTERNS: readonly RegExp[] = [
  /[\u4e00-\u9fa5]{2,4}权/g,
  /[\u4e00-\u9fa5]{2,4}责任/g,
  /[\u4e00-\u9fa5]{2,4}行为/g,
  /[\u4e00-\u9fa5]{2,4}制度/g,
  /[\u4e00-\u9fa5]{2,4}管理/g,
  /[\u4e00-\u9fa5]{2,4}保护/g,
]

/**
 * Extract keyword topics from an article's text.
 *
 * The extracted topics always include the law's short name, followed by
 * domain-specific legal terms found in the text, and finally concept
 * compounds matched by {@link CONCEPT_PATTERNS}.
 *
 * @param text - the full article text.
 * @param lawName - the law's short name (always included as the first topic).
 * @returns a deduplicated array of topic strings.
 */
export function extractTopicsFromText(text: string, lawName: string): string[] {
  const topics: string[] = [lawName]

  // 1. Match pre-defined legal terms (up to 3)
  const matchedTerms = LEGAL_TERMS.filter(term => text.includes(term))
  topics.push(...matchedTerms.slice(0, 3))

  // 2. Extract concept compounds via regex (up to 2)
  const concepts: string[] = []
  for (const pattern of CONCEPT_PATTERNS) {
    // Reset stateful regex — patterns carry the `g` flag
    pattern.lastIndex = 0
    const matches = text.match(pattern) ?? []
    for (const m of matches) {
      if (!concepts.includes(m)) concepts.push(m)
    }
  }
  topics.push(...concepts.slice(0, 2))

  // Deduplicate while preserving insertion order
  return [...new Set(topics)]
}

// ---------------------------------------------------------------------------
// YAML generation
// ---------------------------------------------------------------------------

/**
 * Convert a {@link ParsedLaw} into a `LegalLawBaseline`-compatible YAML string.
 *
 * The generated YAML has the shape:
 * ```yaml
 * law: <shortName>
 * document: <name>
 * revision: <latest amendment description or null>
 * maxArticle: <highest article number>
 * maxVerifiedOn: null
 * maxSource: <source file path>
 * articles:
 *   - article: 1
 *     topics: []
 *     text: null
 *     sourceDoc: null
 *     verifiedOn: null
 * ```
 *
 * @param parsed - the parsed law data.
 * @param options - whether to transcribe article text and the date to record.
 * @returns the YAML string.
 */
export function generateYamlIndex(parsed: ParsedLaw, options: GenerateIndexOptions = {}): string {
  const transcribe = options.transcribe === true
  if (transcribe && options.verifiedOn === undefined) {
    throw new Error('generateYamlIndex: transcribe requires verifiedOn')
  }
  const verifiedOn = transcribe ? options.verifiedOn ?? null : null
  const sourceDoc = transcribe ? basename(parsed.sourceFile) : null
  const maxArticle = parsed.articles.length > 0
    ? Math.max(...parsed.articles.map(a => a.number))
    : null

  // Use the latest amendment date as revision label, or the adopt date
  const revision = buildRevisionLabel(parsed)

  // Deduplicate articles by number, keeping the first occurrence
  const seenArticles = new Set<number>()
  const uniqueArticles = []
  for (const article of parsed.articles) {
    if (!seenArticles.has(article.number)) {
      seenArticles.add(article.number)
      uniqueArticles.push(article)
    }
  }

  const articles = uniqueArticles.map(article => ({
    article: article.number,
    topics: extractTopicsFromText(article.text, parsed.shortName),
    text: transcribe && article.text.trim() !== '' ? article.text : null,
    sourceDoc,
    verifiedOn,
  }))

  const header = `# ${parsed.name}法条索引 — 自动生成。${parsed.subtitle ? `（${parsed.subtitle}）` : ''}\n#\n# 源文件：${basename(parsed.sourceFile)}\n`

  const data = {
    // For split files (e.g. 民法典 合同编), use a compound law name to avoid duplicate keys
    law: parsed.subtitle ? `${parsed.shortName}·${parsed.subtitle}` : parsed.shortName,
    document: parsed.name + (parsed.subtitle ? ` · ${parsed.subtitle}` : ''),
    revision,
    maxArticle,
    maxVerifiedOn: verifiedOn,
    maxSource: sourceDoc,
    articles,
  }

  return header + yamlDump(data, {
    lineWidth: -1,
    noRefs: true,
    quotingType: "'",
    sortKeys: false,
  })
}

/**
 * Build a human-readable revision label from the parsed amendment history.
 */
function buildRevisionLabel(parsed: ParsedLaw): string | null {
  if (parsed.amendments.length === 0) {
    // Use adopt date as the revision label when there are no amendments
    if (parsed.adoptDate) {
      return `${parsed.adoptDate} 通过`
    }
    return null
  }
  // Use the latest amendment
  const latest = parsed.amendments[parsed.amendments.length - 1]
  if (!latest) return null
  return `${latest.date} ${latest.description}`
}

// ---------------------------------------------------------------------------
// File-name mapping
// ---------------------------------------------------------------------------

/**
 * Derive a stable YAML file name from a law's short name.
 *
 * Examples:
 * - `民法典` → `civil-code.yaml` (special case)
 * - `公司法` → `company-law.yaml`
 * - `行政处罚法` → `administrative-penalty-law.yaml`
 *
 * The mapping uses a hand-curated table for well-known laws and falls back to
 * a pinyin-based slug for the rest.
 */
export function lawYamlFilename(shortName: string, subtitle?: string): string {
  // Well-known mappings
  const known: Record<string, string> = {
    '民法典': 'civil-code',
    '民事诉讼法': 'civil-procedure-law',
    '劳动合同法': 'labor-contract-law',
    '公司法': 'company-law',
    '宪法': 'constitution',
    '刑法': 'criminal-law',
    '刑事诉讼法': 'criminal-procedure-law',
    '行政处罚法': 'administrative-penalty-law',
    '行政许可法': 'administrative-license-law',
    '行政强制法': 'administrative-coercion-law',
    '行政复议法': 'administrative-reconsideration-law',
    '专利法': 'patent-law',
    '商标法': 'trademark-law',
    '著作权法': 'copyright-law',
    '合同法': 'contract-law',
    '物权法': 'property-law',
    '侵权责任法': 'tort-liability-law',
    '婚姻法': 'marriage-law',
    '继承法': 'succession-law',
    '收养法': 'adoption-law',
    '劳动法': 'labor-law',
    '社会保险法': 'social-insurance-law',
    '企业所得税法': 'enterprise-income-tax-law',
    '个人所得税法': 'individual-income-tax-law',
    '增值税法': 'value-added-tax-law',
    '税收征收管理法': 'tax-collection-law',
    '环境保护法': 'environmental-protection-law',
    '土地管理法': 'land-administration-law',
    '城市房地产管理法': 'urban-real-estate-law',
    '城乡规划法': 'urban-rural-planning-law',
    '建筑法': 'construction-law',
    '道路交通安全法': 'road-traffic-safety-law',
    '网络安全法': 'cybersecurity-law',
    '数据安全法': 'data-security-law',
    '个人信息保护法': 'personal-information-protection-law',
    '反垄断法': 'anti-monopoly-law',
    '反不正当竞争法': 'anti-unfair-competition-law',
    '消费者权益保护法': 'consumer-protection-law',
    '产品质量法': 'product-quality-law',
    '食品安全法': 'food-safety-law',
    '药品管理法': 'drug-administration-law',
    '证券法': 'securities-law',
    '保险法': 'insurance-law',
    '银行法': 'banking-law',
    '商业银行法': 'commercial-bank-law',
    '中国人民银行法': 'people-s-bank-law',
    '教育法': 'education-law',
    '高等教育法': 'higher-education-law',
    '义务教育法': 'compulsory-education-law',
    '科学技术进步法': 'science-technology-progress-law',
    '促进科技成果转化法': 'scientific-achievement-transformation-law',
    '红十字会法': 'red-cross-law',
    '慈善法': 'charity-law',
    '未成年人保护法': 'minors-protection-law',
    '老年人权益保障法': 'elderly-rights-law',
    '妇女权益保障法': 'women-rights-law',
    '残疾人保障法': 'disabled-persons-protection-law',
    '公务员法': 'civil-servant-law',
    '法官法': 'judges-law',
    '检察官法': 'prosecutors-law',
    '律师法': 'lawyers-law',
    '公证法': 'notarization-law',
    '仲裁法': 'arbitration-law',
    '人民调解法': 'people-s-mediation-law',
    '国防法': 'national-defense-law',
    '兵役法': 'military-service-law',
    '国防动员法': 'national-defense-mobilization-law',
    '反分裂国家法': 'anti-secession-law',
    '国家安全法': 'national-security-law',
    '反间谍法': 'counter-espionage-law',
    '反恐怖主义法': 'counter-terrorism-law',
    '境外非政府组织境内活动管理法': 'ngo-management-law',
    '立法法': 'legislation-law',
    '监督法': 'supervision-law',
    '选举法': 'election-law',
    '地方各级人民代表大会和地方各级人民政府组织法': 'local-organization-law',
    '民族区域自治法': 'ethnic-regional-autonomy-law',
    '特别行政区基本法': 'special-administrative-region-basic-law',
    '村民委员会组织法': 'village-committee-law',
    '居民委员会组织法': 'residents-committee-law',
    '工会法': 'trade-union-law',
    '矿山安全法': 'mine-safety-law',
    '安全生产法': 'work-safety-law',
    '消防法': 'fire-control-law',
    '突发事件应对法': 'emergency-response-law',
    '传染病防治法': 'infectious-disease-prevention-law',
    '中医药法': 'traditional-chinese-medicine-law',
    '基本医疗卫生与健康促进法': 'basic-healthcare-law',
    '人口与计划生育法': 'population-family-planning-law',
    '住房公积金管理条例': 'housing-provident-fund-regulation',
    '企业破产法': 'enterprise-bankruptcy-law',
    '海商法': 'maritime-law',
    '票据法': 'negotiable-instruments-law',
    '信托法': 'trust-law',
    '个人独资企业法': 'sole-proprietary-enterprise-law',
    '合伙企业法': 'partnership-enterprise-law',
    '全民所有制工业企业法': 'ownership-industrial-enterprise-law',
    '乡镇企业法': 'township-enterprise-law',
    '外资企业法': 'foreign-capital-enterprise-law',
    '中外合资经营企业法': 'sino-foreign-joint-venture-law',
    '中外合作经营企业法': 'sino-foreign-cooperative-joint-venture-law',
    '野生动物保护法': 'wildlife-protection-law',
    '森林法': 'forestry-law',
    '草原法': 'grassland-law',
    '渔业法': 'fishery-law',
    '水法': 'water-law',
    '水土保持法': 'soil-water-conservation-law',
    '防沙治沙法': 'sand-prevention-law',
    '可再生能源法': 'renewable-energy-law',
    '节约能源法': 'energy-conservation-law',
    '清洁生产促进法': 'cleaner-production-promotion-law',
    '循环经济促进法': 'circular-economy-promotion-law',
    '环境影响评价法': 'environmental-impact-assessment-law',
    '排污许可管理条例': 'pollutant-discharge-permit-regulation',
    '气象法': 'meteorology-law',
    '测绘法': 'surveying-mapping-law',
    '标准化法': 'standardization-law',
    '计量法': 'metrology-law',
    '统计法': 'statistics-law',
    '审计法': 'audit-law',
    '会计法': 'accounting-law',
    '注册会计师法': 'certified-public-accountant-law',
    '价格法': 'pricing-law',
    '政府采购法': 'government-procurement-law',
    '招标投标法': 'bidding-law',
    '海关法': 'customs-law',
    '进出口商品检验法': 'import-export-commodity-inspection-law',
    '国境卫生检疫法': 'frontier-health-quarantine-law',
    '进出境动植物检疫法': 'entry-exit-animal-plant-quarantine-law',
    '农产品质量安全法': 'agricultural-product-quality-safety-law',
    '种子法': 'seed-law',
    '农药管理条例': 'pesticide-management-regulation',
    '兽药管理条例': 'veterinary-drug-management-regulation',
    '动物防疫法': 'animal-epidemic-prevention-law',
    '植物检疫条例': 'plant-quarantine-regulation',
    '防震减灾法': 'earthquake-prevention-disaster-reduction-law',
    '防洪法': 'flood-prevention-law',
    '抗旱条例': 'drought-resistance-regulation',
    '自然灾害救助条例': 'natural-disaster-relief-regulation',
    '铁路法': 'railway-law',
    '民用航空法': 'civil-aviation-law',
    '港口法': 'port-law',
    '航道法': 'waterway-law',
    '公路法': 'highway-law',
    '邮政法': 'postal-law',
    '电力法': 'electric-power-law',
    '煤炭法': 'coal-law',
    '石油天然气管道保护法': 'oil-gas-pipeline-protection-law',
    '核安全法': 'nuclear-safety-law',
    '放射性污染防治法': 'radioactive-pollution-prevention-law',
    '矿产资源法': 'mineral-resources-law',
    '物业管理条例': 'property-management-regulation',
    '城市维护建设税法': 'urban-maintenance-construction-tax-law',
    '资源税法': 'resource-tax-law',
    '耕地占用税法': 'farmland-occupation-tax-law',
    '车辆购置税法': 'vehicle-purchase-tax-law',
    '船吨税法': 'tonnage-tax-law',
    '环境保护税法': 'environmental-protection-tax-law',
    '烟叶税法': 'tobacco-leaf-tax-law',
    '契税法': 'deed-tax-law',
    '印花税法': 'stamp-tax-law',
    '房产税暂行条例': 'property-tax-interim-regulation',
    '城镇土地使用税暂行条例': 'urban-land-use-tax-interim-regulation',
    '土地增值税暂行条例': 'land-appreciation-tax-interim-regulation',
    '车船税法': 'vehicle-vessel-tax-law',
    '船舶吨税法': 'ship-tonnage-tax-law',
    '关税法': 'customs-duty-law',
  }

  // Build a compound key for 民法典 split files
  const compoundKey = subtitle ? `${shortName}-${subtitle}` : shortName
  const knownCompound: Record<string, string> = {
    '民法典-总则': 'civil-code-general-provisions',
    '民法典-物权编': 'civil-code-real-rights',
    '民法典-合同编': 'civil-code-contracts',
    '民法典-人格权编': 'civil-code-personality-rights',
    '民法典-婚姻家庭编': 'civil-code-marriage-family',
    '民法典-继承编': 'civil-code-succession',
    '民法典-侵权责任编': 'civil-code-tort-liability',
    '民法典-附则': 'civil-code-supplementary',
  }

  if (knownCompound[compoundKey]) return `${knownCompound[compoundKey]}.yaml`
  if (known[shortName]) return `${known[shortName]}.yaml`

  // Fallback: use the short name directly, sanitised for file systems
  const slug = shortName
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'unknown'}.yaml`
}

// ---------------------------------------------------------------------------
// Batch processing
// ---------------------------------------------------------------------------

/**
 * Recursively collect all `.md` files under a directory, skipping `_index.md`
 * and corpus README files, which are not statutes.
 */
function collectMdFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === '__pycache__' || entry === 'scripts') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...collectMdFiles(full))
    } else if (entry.endsWith('.md') && entry !== '_index.md' && !entry.toLowerCase().startsWith('readme')) {
      results.push(full)
    }
  }
  return results
}

/**
 * Group parsed laws by their short name, keeping only the latest version
 * (by file-name date or amendment date) when multiple versions exist.
 */
function deduplicateLaws(laws: ParsedLaw[]): Map<string, ParsedLaw> {
  const byKey = new Map<string, { law: ParsedLaw; sortKey: string }>()

  for (const law of laws) {
    // Use shortName + subtitle as the dedup key (民法典 split files are separate entries)
    const key = law.subtitle ? `${law.shortName}-${law.subtitle}` : law.shortName

    // Sort key: prefer the latest amendment date, fall back to adopt date
    const lastAmendment = law.amendments[law.amendments.length - 1]
    const sortKey = lastAmendment
      ? lastAmendment.date
      : law.adoptDate

    const existing = byKey.get(key)
    if (!existing || sortKey > existing.sortKey) {
      byKey.set(key, { law, sortKey })
    }
  }

  const result = new Map<string, ParsedLaw>()
  for (const [key, { law }] of byKey) {
    result.set(key, law)
  }
  return result
}

/**
 * Batch-process all legal Markdown files in a directory tree, generating one
 * YAML index per unique law document.
 *
 * When multiple versions of the same law exist (e.g. `公司法(2018-10-26).md`
 * and `公司法(2023-12-29).md`), only the latest version is emitted.
 *
 * @param inputDir - root directory to scan recursively.
 * @param outputDir - directory to write `.yaml` index files into.
 * @param options - which documents to emit and whether to transcribe their text.
 * @returns a summary of the batch run.
 */
// oxlint-disable-next-line typescript/require-await -- batch entry keeps an async signature for callers; the generator is synchronous
export async function batchGenerate(
  inputDir: string,
  outputDir: string,
  options: BatchGenerateOptions = {},
): Promise<BatchResult> {
  const result: BatchResult = { processed: 0, skipped: 0, failures: [], written: [] }

  // Collect all .md files
  const files = collectMdFiles(inputDir)
  console.log(`[batch] Found ${files.length} Markdown files under ${inputDir}`)

  // Parse all files
  const parsed: ParsedLaw[] = []
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8')
      const law = parseLawMarkdown(content, file)
      if (law.articles.length === 0) {
        result.skipped++
        continue
      }
      parsed.push(law)
      result.processed++
    } catch (error) {
      result.failures.push({ file: relative(inputDir, file), error: (error as Error).message })
    }
  }

  console.log(`[batch] Parsed ${parsed.length} laws (${result.skipped} skipped, ${result.failures.length} failures)`)

  // Deduplicate — keep latest version of each law
  const deduped = deduplicateLaws(parsed)
  console.log(`[batch] After deduplication: ${deduped.size} unique law documents`)

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true })

  const only = options.only === undefined ? undefined : new Set(options.only)

  // Generate YAML files
  for (const [, law] of deduped) {
    const lawKey = law.subtitle ? `${law.shortName}·${law.subtitle}` : law.shortName
    if (only !== undefined && !only.has(lawKey)
      && !(law.subtitle === undefined && only.has(law.shortName))) {
      result.skipped++
      continue
    }
    const yaml = generateYamlIndex(law, options)
    const filename = lawYamlFilename(law.shortName, law.subtitle)
    const outPath = join(outputDir, filename)
    writeFileSync(outPath, yaml, 'utf8')
    result.written.push(outPath)
  }

  console.log(`[batch] Wrote ${result.written.length} YAML index files to ${outputDir}`)
  return result
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/** Parse CLI arguments, keeping positional directories separate from flags. */
function parseCli(argv: string[]): { inputDir: string; outputDir: string; options: BatchGenerateOptions } {
  const positional: string[] = []
  const options: BatchGenerateOptions = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? ''
    if (arg === '--transcribe') {
      options.transcribe = true
    } else if (arg === '--verified-on') {
      const value = argv[++index]
      if (value === undefined) throw new Error('--verified-on 需要一个 YYYY-MM-DD 日期')
      options.verifiedOn = value
    } else if (arg === '--only') {
      const value = argv[++index]
      if (value === undefined) throw new Error('--only 需要一个逗号分隔的法律名列表')
      options.only = value.split(',').map(name => name.trim()).filter(name => name !== '')
    } else {
      positional.push(arg)
    }
  }
  const [inputDir, outputDir] = positional
  if (inputDir === undefined || outputDir === undefined) {
    throw new Error('Usage: tsx generate-law-yaml.ts <input-dir> <output-dir> [--transcribe --verified-on YYYY-MM-DD] [--only 名称1,名称2]')
  }
  return { inputDir, outputDir, options }
}

/** Run the batch generator from the command line. */
async function main(): Promise<void> {
  const { inputDir, outputDir, options } = parseCli(process.argv.slice(2))

  const result = await batchGenerate(inputDir, outputDir, options)

  console.log('\n=== Batch Summary ===')
  console.log(`Processed: ${result.processed}`)
  console.log(`Skipped:   ${result.skipped}`)
  console.log(`Failures:  ${result.failures.length}`)
  console.log(`Written:   ${result.written.length}`)

  if (result.failures.length > 0) {
    console.log('\nFailures:')
    for (const f of result.failures) {
      console.log(`  ${f.file}: ${f.error}`)
    }
  }
}

// Run when executed directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('generate-law-yaml.ts') ||
  process.argv[1].endsWith('generate-law-yaml')
)
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
