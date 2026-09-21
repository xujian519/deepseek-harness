/**
 * 附图说明句式（纯函数）：把图号、图型与发明名称合成说明书「附图说明」章节
 * 的句子，供 \`generate_patent_figure\`、\`generate_structure_figure\` 与
 * \`analyze_patent_figure\` 共用，避免三个工具各自拼句造成同一申请内句式不一致。
 *
 * 句式取《专利审查指南》第二部分第二章 2.2.5 示例的「图N是……的……」结构
 * （「图1是燃煤锅炉节能装置的主视图；图2是图1所示节能装置的侧视图」）；
 * 发明名称缺省时省略「……的」限定语，只保留图型。
 * @module @deepseek-ai/dsh-patent-tools/figure/figure-description
 */

/**
 * 生成单幅附图的说明句。
 * @param figureNumber - 图号（1 起）。
 * @param figureTypeName - 图型中文名（如「流程图」「结构示意图」）。
 * @param inventionName - 发明名称；缺省或空白时省略限定语。
 * @param suffix - 面板后缀（如 'A'，写入图号后：图1A）。
 * @returns 附图说明句（不含句末标点）。
 */
export function figureSentence(
  figureNumber: number,
  figureTypeName: string,
  inventionName?: string,
  suffix = '',
): string {
  const title = inventionName === undefined || inventionName.trim() === '' ? '' : `${inventionName.trim()}的`
  return `图${figureNumber}${suffix}是本发明实施例提供的${title}${figureTypeName}`
}

/**
 * 生成完整的附图说明文字（句子 + 参考标号清单）。
 * @param params - 图号、图型名、发明名称、面板后缀与标号清单。
 * @returns 可直接落入说明书「附图说明」的文字：无标号时为「…。」，有标号时为「…；图中：100-壳体。」。
 */
export function figureDescription(params: {
  figureNumber: number
  figureTypeName: string
  inventionName?: string | undefined
  suffix?: string
  numerals?: readonly { numeral: string; label: string }[]
}): string {
  const sentence = figureSentence(params.figureNumber, params.figureTypeName, params.inventionName, params.suffix ?? '')
  const numerals = params.numerals ?? []
  if (numerals.length === 0) return `${sentence}。`
  return `${sentence}；图中：${numerals.map(entry => `${entry.numeral}-${entry.label}`).join('，')}。`
}
