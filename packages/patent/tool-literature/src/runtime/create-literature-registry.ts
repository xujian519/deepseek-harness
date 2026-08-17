/**
 * 默认文献 Connector 装配。
 *
 * 首批 4 个免费、无 API key 的学术源：arXiv、OpenAlex、Semantic Scholar、
 * Crossref。每个源可通过开关独立启用/禁用。
 *
 * 测试注入（fetchImpl / 限速 / 重试覆盖）在连接器工厂层（createArxivConnector
 * 等）进行，装配层只保留业务配置，不承载测试专用字段。
 */
import { ConnectorRegistry } from './connector-registry.ts'
import { createArxivConnector } from './connectors/arxiv.ts'
import { createOpenAlexConnector } from './connectors/openalex.ts'
import { createSemanticScholarConnector } from './connectors/semantic-scholar.ts'
import { createCrossrefConnector } from './connectors/crossref.ts'

/** 默认文献注册表装配选项（各源开关与可选凭据）。 */
export type CreateLiteratureRegistryOptions = {
  /** arXiv 开关（默认 true）。 */
  arxiv?: boolean
  /** OpenAlex 开关（默认 true）。 */
  openalex?: boolean
  /** Semantic Scholar 开关（默认 true）。 */
  semanticScholar?: boolean
  /** Crossref 开关（默认 true）。 */
  crossref?: boolean
  /** OpenAlex polite pool 标识邮箱（可选）。 */
  openalexMailto?: string
  /** Semantic Scholar 提额 key（可选）。 */
  semanticScholarApiKey?: string
  /** 覆盖 fetch（测试注入）。 */
  fetchImpl?: typeof fetch
}

/**
 * 装配默认文献 Connector 注册表（arXiv / OpenAlex / Semantic Scholar / Crossref）。
 * @param options - 各源开关与可选凭据。
 * @returns 已装配的注册表。
 */
export function createLiteratureRegistry(options: CreateLiteratureRegistryOptions = {}): ConnectorRegistry {
  const registry = new ConnectorRegistry()
  if (options.arxiv !== false) {
    registry.register(createArxivConnector({ fetchImpl: options.fetchImpl }))
  }
  if (options.openalex !== false) {
    registry.register(createOpenAlexConnector({ mailto: options.openalexMailto, fetchImpl: options.fetchImpl }))
  }
  if (options.semanticScholar !== false) {
    registry.register(
      createSemanticScholarConnector({
        apiKey: options.semanticScholarApiKey,
        fetchImpl: options.fetchImpl,
      }),
    )
  }
  if (options.crossref !== false) {
    registry.register(createCrossrefConnector({ fetchImpl: options.fetchImpl }))
  }
  return registry
}
