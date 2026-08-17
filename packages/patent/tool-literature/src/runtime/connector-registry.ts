/**
 * 学术文献 Connector 注册表。
 *
 * 单个共享实例由装配函数 `createLiteratureRegistry` 提供；工具层
 * （`paper_search` / `paper_list_sources`）只通过 `get`/`catalog` 路由，
 * 不感知具体数据库（设计引入自 OpenScience ConnectorRegistry）。
 */
import type { CatalogEntry, Connector } from '../protocol/types.ts'

/** 学术文献 Connector 注册表（单个共享实例按 id 路由到具体数据库）。 */
export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>()

  /**
   * 注册一个连接器；重复 id 抛错。
   * @param connector - 要注册的连接器。
   */
  register(connector: Connector): void {
    if (this.connectors.has(connector.id)) {
      throw new Error(`Connector "${connector.id}" is already registered`)
    }
    this.connectors.set(connector.id, connector)
  }

  /**
   * 按 id 取连接器；未注册返回 undefined。
   * @param id - 连接器 id。
   * @returns 匹配的连接器，未注册为 undefined。
   */
  get(id: string): Connector | undefined {
    return this.connectors.get(id)
  }

  /**
   * 全部已注册连接器（注册顺序）。
   * @returns 已注册连接器列表。
   */
  all(): Connector[] {
    return [...this.connectors.values()]
  }

  /**
   * 可序列化目录（无函数），供工具 / UI 展示。
   * @returns 可序列化目录条目列表。
   */
  catalog(): CatalogEntry[] {
    return this.all().map(({ id, name, domain, description, homepage }) => ({
      id,
      name,
      domain,
      description,
      homepage,
    }))
  }
}
