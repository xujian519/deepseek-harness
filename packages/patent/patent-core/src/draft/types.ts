/**
 * src/draft — 受控草案模型（patent 域共享）。
 *
 * 模型不再产出 HTML（标题、表格标记、innerHTML），而是提交结构化草案（本模块的类型）；
 * 标题与表格由转换器按结构生成（by construction），渲染层不再接受模型可控标签。
 * claims-spec 申请文件使用 {@link SpecDraft}，其余模板使用 {@link TemplateDraft}；
 * 两通道（claims-spec HTML/PDF 与 build_patent_filing docx）共用同一份草案。
 */

/** 草案正文块：段落、列表、命名表格三选一。 */
export type DraftBlock =
  | {
    kind: 'paragraph'
    /** 段落文本；非空。 */
    text: string
  }
  | {
    kind: 'list'
    /** 列表项；每项非空，≥1 项。 */
    items: string[]
    /** 有序列表标记；缺省为无序列表。 */
    ordered?: boolean
  }
  | {
    kind: 'table'
    /** 表格名称（不含「表 N」前缀，前缀由渲染器自动编号生成）；不得以「表+数字」开头。 */
    name: string
    /** 表头列；≥1 列，每列非空。 */
    header: string[]
    /** 数据行；≥1 行，行宽与表头一致，单元格非空。 */
    rows: string[][]
  }

/** claims-spec 五部分章节 id 到中文标题的固定映射（转换器按此生成 h3）。 */
export const SPEC_PART_HEADINGS = {
  technicalField: '技术领域',
  background: '背景技术',
  summary: '发明内容',
  drawingDescriptions: '附图说明',
  embodiment: '具体实施方式',
} as const

/** claims-spec 五部分章节 id。 */
export type SpecPartId = keyof typeof SPEC_PART_HEADINGS

/** claims-spec 著录项：五项必填非空。 */
export interface SpecDraftMeta {
  /** 发明名称。 */
  title: string
  /** 申请人。 */
  applicant: string
  /** 发明人。 */
  inventor: string
  /** 代理人 / 代理机构。 */
  agent: string
  /** 撰写日期。 */
  date: string
}

/** claims-spec 申请文件受控草案。 */
export interface SpecDraft {
  /** 著录项（请求书头部与落款共用）。 */
  meta: SpecDraftMeta
  /** 权利要求项；≥1 项，每项非空，不含项号（项号由渲染器自动编号）。 */
  claims: string[]
  /** 摘要段落；≥1 段，每段非空。 */
  abstract: string[]
  /** 摘要附图号；缺省渲染为「1」。 */
  abstractFigure?: string
  /** 附图文件路径（docx 通道使用；HTML 通道忽略）；≥1 项，每项非空。 */
  figureFiles: string[]
  /** 附图说明；每项对应一幅附图（与 figureFiles 项数一致由 filing 侧校验），每项非空。 */
  drawingDescriptions: string[]
  /** 说明书五部分；每部分 ≥1 个非空块，表格块仅允许出现在 embodiment。 */
  sections: Record<SpecPartId, DraftBlock[]>
}

/** 模板草案的一个章节槽位：骨架元素 id + 块序列。 */
export interface TemplateDraftSection {
  /** 模板骨架中的槽位 id。 */
  id: string
  /** 槽位内容块；≥1 个非空块。 */
  blocks: DraftBlock[]
}

/** 其余文书模板受控草案。 */
export interface TemplateDraft {
  /** 文本槽位值（文本槽与选项槽共用此映射）；键为槽位 id，值非空。 */
  fields?: Record<string, string>
  /** 章节槽位；槽位 id 不得重复。 */
  sections: TemplateDraftSection[]
}

/** 模板草案的槽位 schema（由 patent-document 的注册表提供）。 */
export interface TemplateDraftSchema {
  /** 文本/选项槽位；值标记是否必填。 */
  fields?: Readonly<Record<string, { required?: boolean }>>
  /** 章节槽位；值标记是否必填。 */
  sections?: Readonly<Record<string, { required?: boolean }>>
}
