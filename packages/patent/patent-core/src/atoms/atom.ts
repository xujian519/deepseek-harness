/**
 * Atom 抽象层（移植自 Mady agentcore/atom.go 设计）。
 *
 * Atom 是 Pipeline 原子操作的**声明式契约**：只描述元数据（名称/描述/分类/
 * 输入输出键），不包含任何执行逻辑。执行由对应的 StageHandler 承担（handler.ts），
 * 二者经注册表解耦 —— 同一 Atom 可对应多个 Handler 实现（测试/替换友好）。
 *
 * 设计原则：
 * - 输入输出键列表用于校验、文档化与插件引用（与 Mady InputSchema/OutputSchema 对齐）
 * - 同名注册覆盖先前定义（可测试、可扩展）
 * - 全局注册表 + 可注入局部注册表（workflow 执行时可选注入，隔离测试）
 */

export type AtomCategory = 'search' | 'extract' | 'compare' | 'reason' | 'gate'

/** Atom 声明式契约：描述原子操作的元数据（名称/描述/分类/输入输出键）。 */
export type Atom = {
  /** 全局唯一标识（与 StageHandler.name 一致） */
  name: string
  /** 人类可读说明 */
  description: string
  /** 分类（search/extract/compare/reason/gate） */
  category: AtomCategory
  /** 期望从 PipelineState 读取的输入键列表 */
  inputSchema: string[]
  /** 声明写入 PipelineState 的输出键列表（第一个为主输出键） */
  outputSchema: string[]
}

/** Atom 注册表：按 name 登记、查询原子，并支持按分类列出。 */
export class AtomRegistry {
  private readonly atoms = new Map<string, Atom>()

  /**
   * 同名注册覆盖先前定义（对齐 Mady 覆盖语义，便于测试与扩展）。
   * @param atom - 待注册的 Atom。
   */
  register(atom: Atom): void {
    if (!atom.name.trim()) throw new AtomRegistryError('Atom 缺少 name')
    if (!atom.description.trim()) throw new AtomRegistryError(`Atom "${atom.name}" 缺少 description`)
    this.atoms.set(atom.name, atom)
  }

  /**
   * 按 name 查询已注册的 Atom。
   * @param name - Atom 名称。
   * @returns 匹配的 Atom，未注册时返回 undefined。
   */
  lookup(name: string): Atom | undefined {
    return this.atoms.get(name)
  }

  /**
   * 列出全部已注册的 Atom。
   * @returns 已注册 Atom 数组。
   */
  list(): Atom[] {
    return [...this.atoms.values()]
  }

  /**
   * 列出指定分类下的 Atom。
   * @param category - Atom 分类。
   * @returns 该分类下的 Atom 数组。
   */
  listByCategory(category: AtomCategory): Atom[] {
    return this.list().filter(a => a.category === category)
  }
}

/** Atom 注册表错误：用于注册校验失败（如缺少 name/description）。 */
export class AtomRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AtomRegistryError'
  }
}

/** 全局注册表（内置原子经 registerBuiltinAtoms 注册于此）。 */
export const globalAtomRegistry = new AtomRegistry()

/**
 * 向全局注册表登记一个 Atom（同名覆盖）。
 * @param atom - 待注册的 Atom。
 */
export function RegisterAtom(atom: Atom): void {
  globalAtomRegistry.register(atom)
}

/**
 * 按 name 查询全局注册表中的 Atom。
 * @param name - Atom 名称。
 * @returns 匹配的 Atom，未注册时返回 undefined。
 */
export function LookupAtom(name: string): Atom | undefined {
  return globalAtomRegistry.lookup(name)
}

/**
 * 列出全局注册表中的全部 Atom。
 * @returns 已注册 Atom 数组。
 */
export function ListAtoms(): Atom[] {
  return globalAtomRegistry.list()
}

/**
 * 列出全局注册表中指定分类的 Atom。
 * @param category - Atom 分类。
 * @returns 该分类下的 Atom 数组。
 */
export function ListAtomsByCategory(category: AtomCategory): Atom[] {
  return globalAtomRegistry.listByCategory(category)
}
