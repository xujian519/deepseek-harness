/**
 * Import the `claude-for-legal-ZH` skill corpus into the `web-app` bundle.
 *
 * The legal mode ships its skills inside `packages/bundle/web-app/skills/legal`
 * so the preset resolves them through the package that ships it, with no
 * external checkout at runtime. This script is the regeneration path: it reads
 * the source repository named by `LEGAL_ZH_ROOT`, namespaces every skill as
 * `legal-<domain>-<skill>` so the flat catalog has no collisions, rewrites the
 * Claude Code configuration paths and slash commands to the legal-mode layout,
 * and copies the practice profiles and legal references the mode reads.
 *
 * Generated paths:
 *
 * - `skills/legal/<domain>/legal-<domain>-<skill>/` — imported skills and their
 *   resources.
 * - `skills/legal/mode/legal-setup/references/practice/<domain>.md` — practice
 *   profile templates seeded into `<workspace>/.legal/practice`.
 * - `skills/legal/mode/legal-setup/references/law/<domain>/` — domain legal
 *   baselines seeded into `<workspace>/.legal/references/<domain>`.
 * - `skills/legal/mode/legal-setup/references/shared/` — shared references
 *   seeded into `<workspace>/.legal/references`.
 *
 * Hand-written mode skills (`legal-setup`, `legal-matter`, `legal-research`,
 * `legal-citation-check`, `legal-quality-gate`) live beside the generated
 * references and are never overwritten.
 *
 * Usage: `LEGAL_ZH_ROOT=/path/to/claude-for-legal-ZH pnpm tsx scripts/import-legal-content.ts`
 * The root defaults to a sibling checkout beside this repository.
 * @module scripts/import-legal-content
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'

/** One source domain and the short name its imported skills carry. */
interface Domain {
  /** Directory name in the source repository. */
  readonly dir: string
  /** Short namespace inserted into every skill name. */
  readonly short: string
  /** Chinese label used in generated comments and the summary. */
  readonly label: string
}

/** Source repository root; defaults to the sibling checkout named by the import. */
const SOURCE_ROOT = process.env.LEGAL_ZH_ROOT
  ?? resolve(import.meta.dirname, '..', '..', 'claude-for-legal-ZH')

/** Imported content root inside the bundle. */
const TARGET_ROOT = resolve(import.meta.dirname, '..', 'packages/bundle/web-app/skills/legal')

/** Canonical upstream repository for the imported legal corpus. */
const SOURCE_URL = 'https://github.com/CSlawyer1985/claude-for-legal-ZH'

/** Header written into every installed practice profile. */
function profileHeader(domain: Domain): string {
  return `<!--
工作副本 / WORKING PROFILE

本文件是当前工作区的法律实务画像，由冷启动访谈写入，之后可直接编辑。
路径：./.legal/practice/${domain.dir}.md
画像仍含 [PLACEHOLDER] 时，先运行 /legal-${domain.short}-cold-start-interview。
共享事实在 ./.legal/company-profile.md。
-->`
}

/** Matter paragraph written into every imported skill that carries one. */
const MATTER_PARAGRAPH = '**案件上下文。** 读取 `./.legal/active-matter`。文件不存在或为空时，询问："这是哪个案件的？运行 `/legal-matter new <slug>`，或说 `practice-level`。" 有活动案件时，加载 `matters/<slug>/matter.md`，把输出写入 `matters/<slug>/`。除非用户明确要求跨案比较，不读取其他案件的文件。'

/** Canonical matter section written into every practice profile. */
const MATTER_SECTION = `## 案件工作区

案件指针统一由 \`./.legal/active-matter\` 管理；运行 \`/legal-matter new | list | switch | close\`。案件资料存放在 \`matters/<slug>/\`，跨案件默认隔离。`

/**
 * Professional practice domains ported from the source corpus.
 *
 * The source also ships `law-student` (law-school drills), `legal-clinic`
 * (supervised clinic administration with U.S. jurisdiction bands), and
 * `legal-builder-hub` (plugin installation and self-update). Those are
 * education or deployment tooling rather than personal Chinese-law practice,
 * so the mode leaves them in the source repository.
 */
const DOMAINS: readonly Domain[] = [
  { dir: 'ai-governance-legal', short: 'ai', label: 'AI 治理' },
  { dir: 'commercial-legal', short: 'commercial', label: '商事合同' },
  { dir: 'corporate-legal', short: 'corporate', label: '公司并购' },
  { dir: 'criminal-legal', short: 'criminal', label: '刑事辩护' },
  { dir: 'employment-legal', short: 'employment', label: '劳动用工' },
  { dir: 'ip-legal', short: 'ip', label: '知识产权' },
  { dir: 'law-practice-cn', short: 'practice', label: '律师业务' },
  { dir: 'legal-research-cn', short: 'research', label: '中国法研究' },
  { dir: 'litigation-legal', short: 'litigation', label: '诉讼仲裁' },
  { dir: 'privacy-legal', short: 'privacy', label: '数据隐私' },
  { dir: 'procurement-legal', short: 'procurement', label: '政府采购' },
  { dir: 'product-legal', short: 'product', label: '产品合规' },
  { dir: 'regulatory-legal', short: 'regulatory', label: '监管合规' },
]

/** Extensions whose contents receive the path and command rewrites. */
const TEXT_EXTENSIONS = new Set(['.md', '.yaml', '.yml', '.json', '.txt', '.csv'])

/**
 * Imported prose wraps YAML keys and research dimensions in backticks. The
 * preset tool-reference gate reads backticked snake_case as a tool name, so
 * these data keys are emitted as plain text; none names a tool this preset
 * mounts or should mount.
 */
const DATA_KEY_REFERENCES = [
  'agent_managed',
  'authority_and_interpretation',
  'cancel_by_calendar',
  'cancel_by_effective',
  'claims_and_elements',
  'closing_action',
  'cn_nexus',
  'confirmed_good_standing',
  'confirm_routing',
  'current_term_end',
  'custom_rules',
  'due_soon',
  'exposure_range',
  'filed_date',
  'gap_type',
  'initial_term_end',
  'last_fee',
  'last_filed',
  'last_updated',
  'needs_review',
  'next_deadline',
  'next_deadlines',
  'next_review',
  'not_present',
  'notice_deadline',
  'obligations_note',
  'outcomes_and_enforcement',
  'owner_contact',
  'quote_mismatch',
  'related_matters',
  'role_basis',
  'send_by_effective',
  'strategy_and_uncertainty',
  'task_context',
  'tier_basis',
  'type_unknown',
] as const

/**
 * Source skills whose responsibility this mode carries elsewhere. The three
 * per-domain `matter-workspace` skills each define their own case root and
 * active-matter pointer; `legal-matter` owns one root and one pointer for the
 * whole mode, so importing them would split that state. `review-proposals`
 * consumes a monitoring agent that this composition does not run.
 */
const SKIPPED_SKILLS = new Set(['matter-workspace', 'review-proposals'])

/** One parsed skill source. */
interface ParsedSkill {
  /** Source directory name; equals the original skill name. */
  readonly dir: string
  /** Frontmatter fields, with block scalars folded into one string. */
  readonly fields: ReadonlyMap<string, string>
  /** The Markdown body after the closing frontmatter fence. */
  readonly body: string
}

/**
 * Whether a character is CJK ideography or full-width punctuation.
 * @param value - the character to test.
 * @returns true when the character is CJK.
 */
function isCjk(value: string): boolean {
  return /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/u.test(value)
}

/**
 * Fold the lines of a YAML block scalar into one string.
 *
 * Chinese descriptions break at sentence boundaries, so a folded scalar joins
 * CJK neighbours without inserting a space while keeping spaces between Latin
 * words.
 * @param lines - the scalar's lines with their shared indentation removed.
 * @returns the folded scalar.
 */
function foldLines(lines: readonly string[]): string {
  let result = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    if (result === '') {
      result = line
      continue
    }
    const previous = result.at(-1) ?? ''
    const next = line.at(0) ?? ''
    result += isCjk(previous) && isCjk(next) ? '' : ' '
    result += line
  }
  return result
}

/**
 * Strip matching quotes from an inline YAML scalar.
 * @param value - the scalar text after the colon.
 * @returns the unquoted value.
 */
function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed.at(0)
    const last = trimmed.at(-1)
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

/**
 * Split a skill file into frontmatter fields and body.
 * @param source - the complete file text.
 * @param file - path used in diagnostics.
 * @returns the parsed fields and body.
 */
function parseSkill(source: string, file: string): ParsedSkill {
  if (!source.startsWith('---\n')) throw new Error(`${file}: missing frontmatter`)
  const end = source.indexOf('\n---\n', 4)
  if (end === -1) throw new Error(`${file}: unterminated frontmatter`)
  const lines = source.slice(4, end).split('\n')
  const fields = new Map<string, string>()
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/u.exec(line)
    if (match === null) continue
    const key = match[1] ?? ''
    const value = match[2] ?? ''
    if (/^[>|][-+]?$/u.test(value)) {
      const collected: string[] = []
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1] ?? ''
        if (nextLine.trim() !== '' && !nextLine.startsWith('  ')) break
        index += 1
        collected.push(nextLine.replace(/^ {2}/u, ''))
      }
      fields.set(key, foldLines(collected))
      continue
    }
    fields.set(key, unquote(value))
  }
  return { dir: '', fields, body: source.slice(end + 5) }
}

/**
 * Build the namespace prefix and full name for one skill.
 * @param domain - the owning domain.
 * @param name - the source skill name.
 * @returns the namespaced skill name.
 */
function namespaced(domain: Domain, name: string): string {
  return `legal-${domain.short}-${name}`
}

/**
 * Rewrite Claude Code paths, slash commands, and skill references for one
 * domain's content.
 * @param text - source text.
 * @param domain - the domain being imported.
 * @param skillNames - every source skill name in that domain.
 * @returns the rewritten text.
 */
function rewriteDomainText(
  text: string,
  domain: Domain,
  skillNames: readonly string[],
  references: ReadonlyMap<string, string>,
): string {
  let result = text
  const profile = `~/.claude/plugins/config/claude-for-legal-zh/${domain.dir}`
  result = result.replaceAll(`${profile}/CLAUDE.md`, `./.legal/practice/${domain.dir}.md`)
  result = result.replaceAll(`${profile}/matters/`, 'matters/')
  result = result.replaceAll(`${profile}/`, `./.legal/${domain.dir}/`)
  result = result.replace(
    /~\/\.claude\/plugins\/config\/claude-for-legal-zh\/company-profile\.md/gu,
    './.legal/company-profile.md',
  )
  result = result.replaceAll('~/.claude/plugins/config/claude-for-legal-zh/', './.legal/')
  result = result.replace(/~\/\.claude\/plugins\/cache\/claude-for-legal-zh\/[^\s`)]*/gu, './.legal')
  result = result.replaceAll('~/.claude/', './.legal/')

  result = result.replace(/\/([a-z0-9-]+):([a-z0-9-]+)/gu, (whole: string, commandDomain: string, skill: string) => {
    const owner = DOMAINS.find(candidate => candidate.dir === commandDomain)
    if (owner === undefined) return whole
    return `/${namespaced(owner, skill)}`
  })
  for (const candidate of DOMAINS) {
    result = result.replaceAll(`/${candidate.dir}:`, `/legal-${candidate.short}-`)
  }

  for (const name of skillNames) {
    const target = namespaced(domain, name)
    result = result.replaceAll(`\`${name}\``, `\`${target}\``)
    result = result.replace(new RegExp(`(^|\\n)# \\/${name}\\b`, 'gu'), `$1# /${target}`)
  }

  result = result.replaceAll('本插件', '本模式')
  result = result.replaceAll('该插件', '该模式')
  result = result.replace(
    /4\. On first run after a plugin update,[\s\S]*?before proceeding\./u,
    '4. 本模式没有旧版缓存路径；配置文件只存在于上述路径。',
  )
  result = result.replaceAll('all 12 plugins', 'all legal-mode domains')
  result = result.replaceAll('12 个插件', '法律模式的各领域')
  result = result.replaceAll('本模式 CLAUDE.md', '本模式实务画像')
  result = result.replaceAll('业务领域级 CLAUDE.md', `实务画像 ./.legal/practice/${domain.dir}.md`)
  result = result.replaceAll('实务级 CLAUDE.md', `实务画像 ./.legal/practice/${domain.dir}.md`)
  result = result.replaceAll('CLAUDE.md', '实务画像')
  for (const key of DATA_KEY_REFERENCES) result = result.replaceAll(`\`${key}\``, key)
  // The source corpus targets hosts with a legal MCP. This mode retrieves
  // through ego lite instead, so the legal-research source names point at the
  // browser path; integration checks for contract and signature systems stay
  // as conditional prose because those systems remain unmounted.
  result = result.replaceAll('元典或北大法宝 MCP', '元典/北大法宝（若 ego lite 已登录）')
  result = result.replaceAll('yuandian MCP', 'ego lite 官方法源')
  result = result.replaceAll('yuan dian MCP', 'ego lite 官方法源')
  result = result.replaceAll('yuan dian 检索', 'ego lite 官方检索')
  result = result.replaceAll('yuandian 检索', 'ego lite 官方检索')
  result = result.replaceAll('元典 MCP', 'ego lite 官方法源')
  result = result.replaceAll('[yuandian检索]', '[ego检索]')
  // The mode has no `web_search` tool. Point the source's generic "web search"
  // instructions at the ego lite path that actually exists.
  result = result.replaceAll('联网搜索', 'ego lite 网页检索')
  result = result.replaceAll('网络搜索', 'ego lite 网页检索')
  result = result.replaceAll('送往 MCP', '送往外部检索源')
  result = result.replaceAll('外部 MCP 可传数据范围', '外部检索源可传数据范围')
  result = result.replaceAll('发送到商业 MCP', '发送到商业检索库')
  result = result.replaceAll('不可将 MCP 命中', '不可将商用库命中')
  result = result.replaceAll('“MCP/商用库命中”', '“商用库命中”')
  // Imported workflows still gate on a profile toggle this mode removed.
  result = result.replaceAll('如果案件工作空间已启用，', '读取 `./.legal/active-matter`；有活动案件时，')
  result = result.replaceAll('如果案件工作空间已启用', '有活动案件时')
  result = result.replaceAll('如果案件工作空间启用', '有活动案件时')
  result = result.replaceAll('如果事项工作空间已启用', '有活动案件时')
  result = result.replaceAll('案件工作空间已启用', '有活动案件')
  result = result.replaceAll('事项工作空间已启用', '有活动案件')
  // One case pointer for the whole mode: replace every imported matter-context
  // paragraph, which otherwise reads a profile section this mode no longer owns.
  result = result.replace(
    /\*\*(?:事项上下文|案件上下文|Matter context)[^\n]*\*\*[^\n]*(?:\n(?!\n)[^\n]*)*/gu,
    MATTER_PARAGRAPH,
  )
  result = result.replace(
    /(?:检查|读取)实务画像[^\n]*`## (?:Matter workspaces|事项工作区|案件工作空间)`[^\n]*/gu,
    MATTER_PARAGRAPH,
  )
  for (const candidate of DOMAINS) {
    result = result.replaceAll(`/legal-${candidate.short}-matter-workspace`, '/legal-matter')
    result = result.replaceAll(`/${candidate.dir}:matter-workspace`, '/legal-matter')
  }
  result = result.replaceAll('`matter-workspace`', '`legal-matter`')
  // One case root for every domain: domain-local matter trees become the
  // shared `matters/` root, and the imported `outputs/` folder uses the mode's
  // `output/` name.
  result = result.replaceAll(`./.legal/${domain.dir}/matters/`, './matters/')
  result = result.replace(
    new RegExp(`\\.\\/\\.legal\\/${domain.dir}\\/\\n(?:[│├└][^\\n]*\\n)+`, 'gu'),
    `./.legal/practice/${domain.dir}.md\n./matters/\n`,
  )
  result = result.replaceAll('outputs/', 'output/')
  result = rewriteCommonText(result)
  for (const [from, to] of references) result = result.replaceAll(from, to)
  result = result.replaceAll('law-practice-cn/实务画像', './.legal/practice/law-practice-cn.md')
  result = result.replaceAll('仓库 `./.legal/references/', '`./.legal/references/')
  result = result.replaceAll('./.legal/./.legal/', './.legal/')
  result = result.replace(/(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/gu, '')
  return result
}

/**
 * Rewrite host-integration and plugin wording shared by skills, practice
 * profiles, and the shared references.
 *
 * The source corpus targets Claude Code installations with legal MCP
 * connectors. This mode mounts no MCP and retrieves through ego lite, so
 * integration checks must report an unmounted connector instead of instructing
 * the model to configure one.
 * @param text - source text.
 * @returns the rewritten text.
 */
function rewriteCommonText(text: string): string {
  let result = text
  result = result.replaceAll('~/.claude/plugins/config/claude-for-legal-zh/', './.legal/')
  result = result.replaceAll('~/.claude/', './.legal/')
  result = result.replaceAll('插件配置', '实务画像')
  result = result.replaceAll('全部12个插件', '法律模式各领域')
  result = result.replaceAll('全部 12 个插件', '法律模式各领域')
  result = result.replaceAll('12个插件', '法律模式各领域')
  result = result.replaceAll('全部插件', '法律模式各领域')
  result = result.replaceAll('其他法律插件', '其他法律领域')
  result = result.replaceAll('第一个插件', '第一个领域')
  result = result.replaceAll('插件特定问题', '领域特定问题')
  result = result.replaceAll('插件', '模式')
  result = result.replaceAll('plugin config', "mode's practice profile")
  result = result.replaceAll('Plugin', 'Mode')
  result = result.replaceAll('plugin', 'mode')

  // Source tags stay short; integration prose names the retrieval path that
  // exists in this mode.
  result = result.replaceAll('[元典MCP]', '[元典]')
  result = result.replaceAll('[yuandian检索]', '[ego检索]')
  result = result.replaceAll('元典MCP', 'ego lite 官方法源')
  result = result.replaceAll('元典（yuan dian）MCP', 'ego lite 官方法源')
  result = result.replaceAll('yuandian MCP', 'ego lite 官方法源')
  result = result.replaceAll('法律研究MCP', 'ego lite 官方法源')
  result = result.replaceAll('法律数据库MCP', 'ego lite 官方法源')
  result = result.replaceAll('企业信用信息 MCP 连接器', '国家企业信用信息公示系统（经 ego lite）')
  result = result.replaceAll('企业信用信息 MCP', '国家企业信用信息公示系统（经 ego lite）')
  result = result.replaceAll('MCP工具名称', '检索工具名称')
  result = result.replaceAll('MCP 工具名称', '检索工具名称')
  result = result.replaceAll('MCP工具名', '检索工具名')
  result = result.replaceAll('MCP 工具调用', '外部工具调用')
  result = result.replaceAll('MCP工具调用', '外部工具调用')
  result = result.replaceAll('调用简单的 MCP 工具', '调用简单的外部工具')
  result = result.replaceAll('调用简单 MCP 工具', '调用简单外部工具')
  result = result.replaceAll('测试MCP连接', '测试外部连接')
  result = result.replaceAll('MCP 设置', '宿主连接设置')
  result = result.replaceAll('MCP设置', '宿主连接设置')
  result = result.replaceAll('连接或断开一个 MCP', '连接或断开一个外部工具')
  result = result.replaceAll('连接或断开 MCP', '连接或断开外部工具')
  result = result.replaceAll('将网盘 MCP 添加到你的配置或通过 `/mcp`', '在宿主配置中接入网盘连接器')
  result = result.replaceAll('将飞书多维表格MCP添加到您的配置或通过 `/mcp`', '在宿主配置中接入飞书多维表格连接器')
  result = result.replaceAll('将飞书多维表格 MCP 添加到您的配置或通过 `/mcp`', '在宿主配置中接入飞书多维表格连接器')
  result = result.replaceAll('MCP 检索', 'ego lite 检索')
  result = result.replaceAll('MCP检索', 'ego lite 检索')
  result = result.replaceAll('MCP 连接器', '外部连接器')
  result = result.replaceAll('MCP 连接', '外部连接')
  result = result.replaceAll('MCP已连接', '外部工具已连接')
  result = result.replaceAll('MCP 已连接', '外部工具已连接')
  result = result.replaceAll('外部 MCP', '外部检索源')
  result = result.replaceAll('商业 MCP', '商业检索库')
  result = result.replaceAll('MCP', '外部连接')

  result = result.replaceAll('联网搜索', 'ego lite 网页检索')
  result = result.replaceAll('网络搜索', 'ego lite 网页检索')
  result = result.replaceAll('`.mcp.json`', '连接器清单')
  result = result.replaceAll('.mcp.json', '连接器清单')
  result = result.replaceAll('Claude Code 不自行排期', '本模式不自行排期；需要时用 `tool-schedule` 建立提醒')
  result = result.replaceAll(
    '在 Claude Cowork：Settings → Connectors → Add → 网盘 → 登录。在 Claude Code：在宿主配置中接入网盘连接器。',
    '在宿主连接设置中接入网盘连接器。',
  )
  result = result.replaceAll(
    '在 Cowork：Settings → Connectors。在 Claude Code：当技能提示你时授权。',
    '在宿主连接设置中接入检索工具。',
  )
  result = result.replaceAll('Claude Code', '宿主')
  result = result.replaceAll('Claude Cowork', '宿主')
  result = result.replaceAll('Cowork', '宿主')
  result = result.replaceAll('检查事项工作区。', '读取 `./.legal/active-matter`；无活动案件时询问归属。')
  result = result.replaceAll('如事项工作区已启用且有活跃事项，写入', '读取 `./.legal/active-matter`；有活动案件时写入')
  result = result.replaceAll('**事项工作区** — 是否启用多案件隔离', '**案件工作区** — 由 `legal-matter` 统一管理')
  result = result.replaceAll('事项工作区', '案件工作区')
  result = result.replaceAll('事项工作空间', '案件工作区')
  result = result.replace(/cancel_by_prove[n]ance/gu, 'cancel_by_source')
  result = result.replaceAll('依据模式根目录 `./.legal/references/company-profile-template.md` 的模板', '依据 `./.legal/company-profile.md` 的模板')
  result = result.replaceAll('./.legal/./.legal/', './.legal/')
  result = result.replace(/\.\/\.legal\/<[^>]+>\/outputs?\//gu, './.legal/output/')
  result = result.replace(/(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/gu, '')
  return result
}

/**
 * Rewrite a practice profile template.
 *
 * Practice profiles live in `<workspace>/.legal/practice` and read shared
 * references from `<workspace>/.legal/references`; relative `references/...`
 * mentions are resolved to that seeded directory.
 * @param text - source profile text.
 * @param domain - the profile's domain.
 * @param skillNames - the domain's source skill names.
 * @returns the rewritten profile.
 */
function rewriteProfile(
  text: string,
  domain: Domain,
  skillNames: readonly string[],
  references: ReadonlyMap<string, string>,
): string {
  let rewritten = rewriteDomainText(text, domain, skillNames, references)
  rewritten = rewritten.replace(/^<!--[\s\S]*?-->\n/u, `${profileHeader(domain)}\n`)
  rewritten = rewritten.replace(
    /\*This file is written by the cold-start interview[\s\S]*?fixed everywhere\.\*/u,
    '本文件由冷启动访谈写入；之后可直接编辑。所有法律技能在动手前读取本文件。',
  )
  rewritten = rewritten.replace(
    /## (?:事项工作空间|事项工作区|案件工作空间)\n[\s\S]*?(?=\n---\n|\n## )/u,
    `${MATTER_SECTION}\n`,
  )
  if (!rewritten.includes('## 案件工作区')) rewritten = `${rewritten.trimEnd()}\n\n---\n\n${MATTER_SECTION}\n`
  // The mode has no legal MCP. The profiles' source-discipline paragraphs keep
  // the same rules but name the retrieval surfaces that actually exist.
  rewritten = rewritten
    .replaceAll('任何MCP工具、ego lite 网页检索', '任何检索工具（ego lite、文件读取）')
    .replaceAll('任何 MCP 工具、ego lite 网页检索', '任何检索工具（ego lite、文件读取）')
    .replaceAll('当检索MCP、ego lite 网页检索', '当检索工具（ego lite、文件读取）')
    .replaceAll('该MCP工具结果', '该检索工具结果')
    .replaceAll('该MCP来源标签', '该来源标签')
    .replaceAll('商业数据库 MCP', '商业数据库（若 ego lite 已登录）')
    .replaceAll('外部 MCP', '外部检索源')
    .replaceAll('连接器已声明', '检索源已声明')
    .replaceAll('MCP 可用？', 'ego 可访问？')
    .replaceAll('插件仓库', '工作区外')
    .replaceAll('插件', '模式')
    .replaceAll('plugin', 'mode')
  return stripTrailing(rewritten)
}

/**
 * Whether a path exists.
 * @param path - path to probe.
 * @returns true when the path exists.
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * List immediate subdirectories.
 * @param directory - directory to read.
 * @returns child directory names.
 */
async function subdirectories(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
}

/**
 * Read every skill in a domain.
 * @param domain - the domain to read.
 * @returns parsed skills sorted by directory name.
 */
async function readDomainSkills(domain: Domain): Promise<ParsedSkill[]> {
  const skillsRoot = join(SOURCE_ROOT, domain.dir, 'skills')
  const skills: ParsedSkill[] = []
  for (const directory of await subdirectories(skillsRoot)) {
    if (SKIPPED_SKILLS.has(directory)) continue
    const file = join(skillsRoot, directory, 'SKILL.md')
    const parsed = parseSkill(await readFile(file, 'utf8'), file)
    skills.push({ ...parsed, dir: directory })
  }
  return skills
}

/**
 * Copy a directory tree, rewriting text files.
 * @param source - source directory.
 * @param target - target directory.
 * @param rewrite - text transform applied to recognised extensions.
 */
async function copyTree(source: string, target: string, rewrite: (text: string) => string): Promise<void> {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) {
      await copyTree(from, to, rewrite)
      continue
    }
    if (!entry.isFile()) continue
    if (TEXT_EXTENSIONS.has(extname(entry.name))) {
      await writeFile(to, stripTrailing(rewrite(await readFile(from, 'utf8'))), 'utf8')
      continue
    }
    await copyFile(from, to)
  }
}

/**
 * Remove trailing horizontal whitespace so generated Markdown passes the
 * repository's pre-commit check.
 * @param text - text to normalize.
 * @returns the text with trailing spaces and tabs removed per line.
 */
function stripTrailing(text: string): string {
  return text.replace(/[ \t]+$/gmu, '').replace(/\n+$/u, '\n')
}

/**
 * Render a generated SKILL.md.
 * @param name - namespaced skill name.
 * @param description - catalog description.
 * @param userInvocable - false keeps the skill out of human `/name` commands.
 * @param body - rewritten skill body.
 * @returns the complete file text.
 */
function renderSkill(name: string, description: string, userInvocable: boolean, body: string): string {
  const lines = ['---', `name: ${name}`, `description: ${JSON.stringify(description)}`]
  if (!userInvocable) lines.push('user-invocable: false')
  lines.push('---', '', stripTrailing(body.trimStart()))
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * Map `references/<relative-path>` mentions to the workspace path where the
 * seed step installs them.
 * @param target - map to fill; later entries win.
 * @param source - reference directory to walk.
 * @param prefix - workspace directory the files are seeded into.
 */
async function collectReferenceTargets(
  target: Map<string, string>,
  source: string,
  prefix: string,
): Promise<void> {
  if (!(await pathExists(source))) return
  const walk = async (directory: string, relativePath: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = relativePath === '' ? entry.name : `${relativePath}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(join(directory, entry.name), child)
        continue
      }
      if (entry.isFile()) target.set(`references/${child}`, `${prefix}/${child}`)
    }
  }
  await walk(source, '')
}

/**
 * Import one domain's skills and resources.
 * @param domain - the domain to import.
 * @param references - domain and shared `references/...` targets in the workspace.
 * @returns the imported skill names.
 */
async function importDomain(
  domain: Domain,
  references: ReadonlyMap<string, string>,
): Promise<string[]> {
  const skills = await readDomainSkills(domain)
  const skillNames = skills.map(skill => skill.dir)
  const target = join(TARGET_ROOT, domain.short)
  await rm(target, { recursive: true, force: true })

  const imported: string[] = []
  for (const skill of skills) {
    if (skill.dir !== skill.fields.get('name')) {
      throw new Error(`${domain.dir}/${skill.dir}: frontmatter name does not match the directory`)
    }
    const description = skill.fields.get('description')
    if (description === undefined || description === '') {
      throw new Error(`${domain.dir}/${skill.dir}: missing description`)
    }
    const name = namespaced(domain, skill.dir)
    const rewrite = (text: string): string => rewriteDomainText(text, domain, skillNames, references)
    const skillTarget = join(target, name)
    await mkdir(skillTarget, { recursive: true })
    await writeFile(
      join(skillTarget, 'SKILL.md'),
      renderSkill(
        name,
        rewrite(description),
        skill.fields.get('user-invocable') !== 'false',
        rewrite(skill.body),
      ),
      'utf8',
    )

    const sourceDir = join(SOURCE_ROOT, domain.dir, 'skills', skill.dir)
    for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
      if (entry.name === 'SKILL.md') continue
      const from = join(sourceDir, entry.name)
      const to = join(skillTarget, entry.name)
      if (entry.isDirectory()) {
        await copyTree(from, to, rewrite)
        continue
      }
      if (!entry.isFile()) continue
      if (TEXT_EXTENSIONS.has(extname(entry.name))) {
        await writeFile(to, stripTrailing(rewrite(await readFile(from, 'utf8'))), 'utf8')
        continue
      }
      await copyFile(from, to)
    }
    imported.push(name)
  }

  const setupReferences = join(TARGET_ROOT, 'mode', 'legal-setup', 'references')
  const profileSource = join(SOURCE_ROOT, domain.dir, 'CLAUDE.md')
  const profileTarget = join(setupReferences, 'practice', `${domain.dir}.md`)
  await mkdir(dirname(profileTarget), { recursive: true })
  await writeFile(
    profileTarget,
    rewriteProfile(await readFile(profileSource, 'utf8'), domain, skillNames, references),
    'utf8',
  )

  const referenceSource = join(SOURCE_ROOT, domain.dir, 'references')
  const referenceTarget = join(setupReferences, 'law', domain.dir)
  if (await pathExists(referenceSource)) {
    await mkdir(dirname(referenceTarget), { recursive: true })
    await copyTree(referenceSource, referenceTarget, (text: string) =>
      rewriteDomainText(text, domain, skillNames, references))
  }

  return imported
}

/**
 * Hash the exact source files the importer reads.
 * @returns a sorted SHA-256 over relative paths and file bytes.
 */
async function sourceTreeHash(): Promise<string> {
  const paths: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) paths.push(path)
    }
  }
  for (const domain of DOMAINS) {
    await walk(join(SOURCE_ROOT, domain.dir, 'skills'))
    if (await pathExists(join(SOURCE_ROOT, domain.dir, 'references'))) {
      await walk(join(SOURCE_ROOT, domain.dir, 'references'))
    }
    paths.push(join(SOURCE_ROOT, domain.dir, 'CLAUDE.md'))
  }
  await walk(join(SOURCE_ROOT, 'references'))
  paths.push(join(SOURCE_ROOT, 'LICENSE'))
  paths.push(join(SOURCE_ROOT, 'README.md'))
  const hash = createHash('sha256')
  for (const path of paths.sort()) {
    hash.update(relative(SOURCE_ROOT, path))
    hash.update('\0')
    hash.update(await readFile(path))
  }
  return hash.digest('hex')
}

/**
 * Read the source repository version from its README badge.
 * @returns the version, or `unknown` when the badge is absent.
 */
async function sourceVersion(): Promise<string> {
  try {
    const readme = await readFile(join(SOURCE_ROOT, 'README.md'), 'utf8')
    return /version-v([0-9]+\.[0-9]+\.[0-9]+)/u.exec(readme)?.[1] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Resolve the source commit from `LEGAL_ZH_COMMIT` or the checkout.
 * @returns the commit, or a description of why it is unavailable.
 */
function sourceCommit(): string {
  const declared = process.env.LEGAL_ZH_COMMIT
  if (declared !== undefined && declared.trim() !== '') return declared.trim()
  try {
    return execFileSync('git', ['-C', SOURCE_ROOT, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown (source checkout has no git metadata)'
  }
}

/**
 * Write the license, attribution, and regeneration notes that accompany the
 * imported corpus.
 * @param version - source README version.
 * @param commit - source commit or an explanation of its absence.
 * @param counts - imported skill count per source domain.
 */
async function writeSourceNotes(
  version: string,
  commit: string,
  treeHash: string,
  counts: Readonly<Record<string, readonly string[]>>,
): Promise<void> {
  const licenseSource = join(SOURCE_ROOT, 'LICENSE')
  if (await pathExists(licenseSource)) {
    await copyFile(licenseSource, join(TARGET_ROOT, 'LICENSE'))
  }
  const total = Object.values(counts).reduce((sum, skills) => sum + skills.length, 0)
  await writeFile(join(TARGET_ROOT, 'NOTICE'), `claude-for-legal-ZH
Copyright (c) 陈石律师 / CSlawyer1985
Licensed under the Apache License, Version 2.0.
Source: ${SOURCE_URL}
Source version: ${version}
Source commit: ${commit}
Source tree hash: ${treeHash}

Modifications for DeepSeek Harness:
- Skills are namespaced as legal-<domain>-<skill>.
- Claude Code configuration paths and slash commands are rewritten to the
  workspace-relative ./.legal and ./matters layout.
- Per-domain matter-workspace and review-proposals skills are removed; one
  legal-matter skill owns the active-matter pointer.
- Legal MCP references are rewritten to ego lite official-source retrieval;
  the mode also uses optional Yuandian MCP tools when the host installs them.
`, 'utf8')
  await writeFile(join(TARGET_ROOT, 'SOURCES.md'), `# Imported legal sources

- Upstream: ${SOURCE_URL}
- Version: ${version}
- Commit: ${commit}
- Tree hash (SHA-256): ${treeHash}
- License: Apache License 2.0 (\`LICENSE\`, \`NOTICE\`)
- Imported skills: ${total}
- Regeneration: \`LEGAL_ZH_ROOT=/path/to/claude-for-legal-ZH pnpm tsx scripts/import-legal-content.ts\`

The generated tree is committed; regenerate after changing the source or the
transforms in \`scripts/import-legal-content.ts\`.
`, 'utf8')
}

/**
 * Run the import and report what was written.
 * @returns nothing; throws on a malformed source.
 */
async function main(): Promise<void> {
  const summary: Record<string, string[]> = {}

  await mkdir(TARGET_ROOT, { recursive: true })
  const setupReferences = join(TARGET_ROOT, 'mode', 'legal-setup', 'references')
  // Regeneration is a replace, not a merge: a reference deleted upstream must
  // disappear from the bundle.
  await rm(join(setupReferences, 'practice'), { recursive: true, force: true })
  await rm(join(setupReferences, 'law'), { recursive: true, force: true })
  const sharedReferences = new Map<string, string>()
  await collectReferenceTargets(
    sharedReferences,
    join(SOURCE_ROOT, 'references'),
    './.legal/references',
  )
  sharedReferences.set('references/company-profile-template.md', './.legal/company-profile.md')
  for (const domain of DOMAINS) {
    const references = new Map(sharedReferences)
    await collectReferenceTargets(
      references,
      join(SOURCE_ROOT, domain.dir, 'references'),
      `./.legal/references/${domain.dir}`,
    )
    summary[domain.dir] = await importDomain(domain, references)
  }

  const sharedSource = join(SOURCE_ROOT, 'references')
  const sharedTarget = join(TARGET_ROOT, 'mode', 'legal-setup', 'references', 'shared')
  await rm(sharedTarget, { recursive: true, force: true })
  await copyTree(sharedSource, sharedTarget, (text: string) => {
    let rewritten = rewriteCommonText(stripTrailing(text))
    for (const [from, to] of sharedReferences) rewritten = rewritten.replaceAll(from, to)
    return rewritten
  })
  // The company profile template seeds `company-profile.md` directly; keeping a
  // second copy under shared references would give two templates to edit.
  await rm(join(sharedTarget, 'company-profile-template.md'), { force: true })

  const companySource = join(SOURCE_ROOT, 'references', 'company-profile-template.md')
  const companyTarget = join(
    TARGET_ROOT, 'mode', 'legal-setup', 'references', 'company-profile-template.md',
  )
  await mkdir(dirname(companyTarget), { recursive: true })
  let companyProfile = rewriteCommonText(stripTrailing(await readFile(companySource, 'utf8')))
  for (const [from, to] of sharedReferences) companyProfile = companyProfile.replaceAll(from, to)
  await writeFile(companyTarget, companyProfile, 'utf8')
  await writeSourceNotes(await sourceVersion(), sourceCommit(), await sourceTreeHash(), summary)

  for (const [domain, skills] of Object.entries(summary)) {
    process.stdout.write(`${domain}: ${skills.length} skills\n`)
  }
  process.stdout.write(`target: ${TARGET_ROOT}\n`)
}

await main()
