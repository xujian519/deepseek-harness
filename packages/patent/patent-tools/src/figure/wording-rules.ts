/**
 * 图面用语检查（纯函数，无 IO）：检查即将出现在附图中的词语与参考标号，
 * 返回面向模型/用户的警告文本。
 *
 * 依据（现行条文）：
 * - 《专利法实施细则》第二十一条：「附图中除必需的词语外，不应当含有其他注释。」
 * - 《专利审查指南》第一部分第一章 4.3：「附图中除必需的词语外，不得含有其他
 *   注释。附图中的词语应当使用中文，必要时，可以在其后的括号里注明原文。」
 *   「附图标记应当使用阿拉伯数字编号。」「该编号应当标注在相应附图的正下方。」
 *   （第二部分第二章关于说明书附图的段落与第一部分第二章实用新型初步审查
 *   第（7）项同义。）
 * - 域外写法：PCT 实施细则 11.13(d)（比例须以图示表示）、11.13(e) 与
 *   37 CFR 1.84(p)(1)（数字、字母与标记不得与括号、引号连用，不得加圈）、
 *   11.13(k) 与 1.84(u)（图号标注与 "FIG." 写法）、1.84(k)（不得标注实际尺寸
 *   或比例）。
 *
 * 只产生警告、不改写输入：词语是否「必需」由申请人判断，工具在命中图号、注释
 * 特征、比例标注、非中文词语、括号包数字或非阿拉伯数字标号时提示，供提交前
 * 自查（补正通知书的常见缺陷）。
 *
 * @module @deepseek-ai/dsh-patent-tools/figure/wording-rules
 */

/** 非必需注释的特征与命中说明。 */
const ANNOTATION_PATTERNS: readonly { pattern: RegExp; hint: string }[] = [
  { pattern: /^(?:注|注意|说明|备注|提示)\s*[:：]/, hint: '注释前缀' },
  { pattern: /(?:如图|见图|参见图|见附图)|see\s+fig/i, hint: '正文引用' },
  { pattern: /\d+(?:\.\d+)?\s*(?:mm|cm|dm|km|nm|μm|µm|um|英寸|毫米|厘米|分米|微米|纳米)/i, hint: '尺寸标注' },
  { pattern: /(?:比例|缩放比|放大|缩小)\s*[:：]?\s*\d+\s*[:：/]\s*\d+|actual\s+size|\bscale\s*\d/i, hint: '比例标注' },
  { pattern: /[。；;]$/, hint: '句末标点' },
]

/** 图号写法（图1、Fig. 1、FIG. 1）：图号应标注在附图正下方，不属图内词语。 */
const FIGURE_NUMBER_PATTERN = /^(?:图\s*\d+[a-z]?|fig(?:ure)?\.?\s*\d+[a-z]?)$/i

/** 与数字连用的括号、引号（PCT 实施细则 11.13(e)、37 CFR 1.84(p)(1) 禁止）。 */
const BRACKETED_NUMERAL_PATTERN = /[（(【\[「『"'“”‘’]\s*\d{1,4}\s*[）)】\]」』"“”‘’]/

/** 中文（含全角标点）字符判定。 */
const CJK_PATTERN = /[\u3000-\u9fff\uff00-\uffef]/

/** 允许的非中文形式：全大写缩写（CPU、EPROM、GB、I2C、A/D）。 */
const ACRONYM_PATTERN = /^[A-Z0-9][A-Z0-9._+\-/()]*$/

/**
 * 词语是否属于指南允许的非中文形式：不含拉丁字母（数字、符号、计量单位写法）
 * 或全大写缩写；其余（如 Input Sensor、controller）应当使用中文。
 * @param word - 单个图面词语。
 * @returns 允许保留原文时 true。
 */
function isAllowedNonChinese(word: string): boolean {
  return !/[A-Za-z]/.test(word) || ACRONYM_PATTERN.test(word)
}

/** 注释类警告文案。 */
function annotationWarning(word: string, hint: string): string {
  return `图面词语 "${word}" 疑似非必需注释（${hint}）：《专利法实施细则》第二十一条规定附图中除必需的词语外不应当含有其他注释，请移入说明书文字部分`
}

/** 非中文词语警告文案。 */
function languageWarning(word: string): string {
  return `图面词语 "${word}" 应当使用中文：《专利审查指南》第一部分第一章 4.3 规定附图中的词语应当使用中文，必要时可以在其后的括号里注明原文`
}

/** 非阿拉伯数字标号警告文案。 */
function numeralWarning(numeral: string): string {
  return `参考标号 "${numeral}" 应当使用阿拉伯数字：《专利审查指南》第一部分第一章 4.3 规定附图标记应当使用阿拉伯数字编号`
}

/** 图号入图警告文案。 */
function figureNumberWarning(word: string): string {
  return `图面词语 "${word}" 是图号：《专利审查指南》第一部分第一章 4.3 规定附图编号应当标注在相应附图的正下方；PCT 实施细则 11.13(k)、37 CFR 1.84(u) 同义，请把图号移出图面`
}

/** 数字带括号/引号警告文案。 */
function bracketedNumeralWarning(word: string): string {
  return `图面词语 "${word}" 中的数字与括号或引号连用：PCT 实施细则 11.13(e) 与 37 CFR 1.84(p)(1) 要求数字、字母与附图标记不得与括号、引号连用，也不得加圈，请改为纯数字标记`
}

/**
 * 检查图面词语与参考标号。
 *
 * 词语按换行拆成逐条（DOT 的 `\n` 换行写法），去重后依次判定图号、注释特征与
 * 中文要求；标号要求为阿拉伯数字。返回顺序为首次出现的顺序。
 * @param labels - 图面上的节点名与边标签（可含换行）。
 * @param numerals - 参考标号（数字或字符串形式）。
 * @returns 警告文本列表；无违规时为空数组。
 */
export function figureWordingWarnings(labels: readonly string[], numerals: readonly (string | number)[]): string[] {
  const warnings: string[] = []
  for (const label of labels) {
    for (const line of label.split('\n')) {
      const word = line.trim()
      if (word === '') continue
      if (FIGURE_NUMBER_PATTERN.test(word)) {
        warnings.push(figureNumberWarning(word))
        continue
      }
      const annotation = ANNOTATION_PATTERNS.find(entry => entry.pattern.test(word))
      if (annotation !== undefined) {
        warnings.push(annotationWarning(word, annotation.hint))
      } else if (!CJK_PATTERN.test(word) && !isAllowedNonChinese(word)) {
        warnings.push(languageWarning(word))
      }
    }
  }
  for (const label of labels) {
    if (BRACKETED_NUMERAL_PATTERN.test(label)) warnings.push(bracketedNumeralWarning(label))
  }
  for (const numeral of numerals) {
    const text = String(numeral).trim()
    if (text !== '' && !/^\d+$/.test(text)) warnings.push(numeralWarning(text))
  }
  return [...new Set(warnings)]
}
