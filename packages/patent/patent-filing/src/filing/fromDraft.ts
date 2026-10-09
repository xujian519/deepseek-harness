/**
 * src/filing/fromDraft — SpecDraft → FilingContent 的确定性映射。
 *
 * docx 通道与 HTML 通道（dsh-patent-document 的 draftConverter）消费同一份受控草案：
 * 权项项号（「1. 」前缀）、附图说明的「图N为……；/。」、表题「表 N · 名称」与摘要附图号
 * 都按草案决定，两通道成文不可能分叉。内容模型没有列表节点，列表块落成逐项正文段。
 * 入参必须是已通过 validateSpecDraft 的草案（tool JSON 边界在校验处收窄）。
 * @module @deepseek-ai/dsh-patent-filing/filing/fromDraft
 */

import {
  SPEC_PART_HEADINGS,
  SPEC_PART_ORDER,
  numberedFigureDescriptions,
  type DraftBlock,
  type SpecDraft,
} from '@deepseek-ai/dsh-patent-core'
import type { FilingContent, SpecificationNode } from '../types.ts'

/** 表题计数器；一次转换共用一个实例，与 HTML 通道一样全文档连续编号。 */
interface CaptionCounter {
  /** 已产出的表格数；表题序号从 1 起。 */
  count: number
}

/** 渲染一个表格块：「表 N · 名称」表题段 + 首行表头的 table 节点。 */
function tableNodes(block: Extract<DraftBlock, { kind: 'table' }>, counter: CaptionCounter): SpecificationNode[] {
  counter.count += 1
  return [
    { kind: 'p', text: `表 ${counter.count} · ${block.name}` },
    { kind: 'table', rows: [block.header, ...block.rows] },
  ]
}

/** 渲染普通部分的块序列；列表块每项一个正文段。 */
function blockNodes(blocks: readonly DraftBlock[], counter: CaptionCounter): SpecificationNode[] {
  const nodes: SpecificationNode[] = []
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      nodes.push({ kind: 'p', text: block.text })
    } else if (block.kind === 'list') {
      for (const item of block.items) {
        nodes.push({ kind: 'p', text: item })
      }
    } else {
      nodes.push(...tableNodes(block, counter))
    }
  }
  return nodes
}

/** 渲染附图说明部分：列表项按契约层编号生成「图N为……；」，末项句号。 */
function drawingNodes(blocks: readonly DraftBlock[], counter: CaptionCounter): SpecificationNode[] {
  const figures = numberedFigureDescriptions(blocks)
  const nodes: SpecificationNode[] = []
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      nodes.push({ kind: 'p', text: block.text })
    } else if (block.kind === 'table') {
      nodes.push(...tableNodes(block, counter))
    } else {
      for (const figure of figures.splice(0, block.items.length)) {
        nodes.push({ kind: 'p', text: `图${figure.index}为${figure.text}${figure.last ? '。' : '；'}` })
      }
    }
  }
  return nodes
}

/**
 * 把 claims-spec 受控草案转换为内容模型。
 * @param draft - 已通过 validateSpecDraft 的草案。
 * @returns 可直接交给 buildFiling 的内容模型（再经 validateContent 交叉校验）。
 */
export function contentFromDraft(draft: SpecDraft): FilingContent {
  const counter: CaptionCounter = { count: 0 }
  const specification: SpecificationNode[] = []
  for (const partId of SPEC_PART_ORDER) {
    specification.push({ kind: 'h3', text: SPEC_PART_HEADINGS[partId] })
    const blocks = draft.sections[partId]
    specification.push(
      ...(partId === 'drawingDescriptions' ? drawingNodes(blocks, counter) : blockNodes(blocks, counter)),
    )
  }
  return {
    abstract: [...draft.abstract],
    claims: draft.claims.map((claim, index) => `${index + 1}. ${claim}`),
    specification,
    figures: [...draft.figureFiles],
    // 摘要附图号在草案里是 1 起的图号，内容模型用 0 起下标；缺省（草案未给）即第 1 张。
    ...(draft.abstractFigure !== undefined ? { abstractFigureIndex: Number(draft.abstractFigure) - 1 } : {}),
  }
}
