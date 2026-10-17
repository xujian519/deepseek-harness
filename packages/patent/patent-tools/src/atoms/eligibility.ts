/**
 * 撰写域原子：eligibility（可专利客体筛查）。
 *
 * 本原子只做确定性表面筛查：
 * - A5：复用 patent-rule 的 EX-SEL-004（违反法律与公序良俗关键词规则）；
 * - A2/A25：按权利要求或技术交底书的主题名称识别 A25.1 排除类别，并以技术特征
 *   标记区分「纯智力活动规则」与「含技术特征的权利要求」。
 *
 * 指南第二部分第一章4.2：权利要求除主题名称外全部为智力活动的规则和方法时才排除；
 * 含技术特征的，不依据专利法第二十五条排除。故纯规则类命中为阻断，含技术特征的
 * 命中降为提示。疾病的诊断和治疗方法、动植物品种、原子核变换方法不因含技术特征
 * 而回到可授权客体。
 *
 * 本原子不判断技术问题与技术效果，也不替代审查意见；报告固定写出限制说明。
 */

import {
  degraded,
  splitClaimSegments,
  type Atom,
  type ConstitutionalRule,
  type PipelineState,
  type RuleViolation,
  type StageExecuteInput,
  type StageHandler,
} from '@deepseek-ai/dsh-patent-core'
import { evaluateText, loadPatentFullRuleSet } from '@deepseek-ai/dsh-patent-rule'
import { readFirstStateText } from './state-text.ts'

/** A5 规则编号：违反法律与公序良俗的关键词规则。 */
export const ELIGIBILITY_A5_RULE_ID = 'EX-SEL-004'

/** 权利要求文本的默认读取键（按优先级）。 */
export const DEFAULT_ELIGIBILITY_CLAIMS_KEYS: readonly string[] = [
  'claims',
  'claims_draft',
  'claim_text',
  'claim',
]

/** 技术方案/交底书文本的默认读取键（按优先级）。 */
export const DEFAULT_ELIGIBILITY_TEXT_KEYS: readonly string[] = [
  'source_text',
  'specification',
  'text',
  'input',
]

/** 客体类别。 */
export type EligibilityCategory =
  | 'technical-solution'
  | 'mental-activity'
  | 'mental-activity-review'
  | 'medical-use'
  | 'medical-method'
  | 'variety-method'
  | 'variety'
  | 'nuclear'
  | 'discovery'
  | 'printed-matter'
  | 'business-method'
  | 'public-order'

/** 检查结论。 */
export type EligibilityVerdict = 'eligible' | 'needs-review' | 'excluded'

/** 违规/提示严重度。 */
export type EligibilitySeverity = 'block' | 'warn'

/** 客体检查发现。 */
export type EligibilityViolation = {
  /** 稳定的问题代码。 */
  code: string
  /** 阻断或提示。 */
  severity: EligibilitySeverity
  /** 所属权项号；整体筛查时缺省。 */
  claimNo?: number
  /** 识别到的客体类别。 */
  category: EligibilityCategory
  /** 问题名称。 */
  label: string
  /** 面向模型/用户的说明。 */
  message: string
  /** 命中片段。 */
  evidence?: string[]
  /** 法律/指南依据。 */
  legalBasis?: string
}

/** 未能执行的检查项。 */
export type EligibilityPending = {
  /** 稳定的问题代码。 */
  code: string
  /** 检查项名称。 */
  label: string
  /** 未执行原因。 */
  message: string
}

/** 单个权项或整体文本的筛查结论。 */
export type EligibilityUnit = {
  /** 权项号；整体筛查时缺省。 */
  claimNo?: number
  /** 主题名称（首句截断）。 */
  subject: string
  /** 识别到的客体类别。 */
  category: EligibilityCategory
  /** 是否识别到技术特征/技术手段标记。 */
  technicalFeatures: boolean
  /** 单项结论。 */
  verdict: EligibilityVerdict
}

/** eligibility 原子：A2/A5/A25 可专利客体筛查。 */
export const eligibilityAtom: Atom = {
  name: 'eligibility',
  description:
    '可专利客体筛查（A2/A5/A25）：识别纯智力活动规则、疾病诊断治疗方法、动植物品种、原子核变换与违反法律/公序良俗的客体；含技术特征的权利要求不按 A25 排除',
  category: 'gate',
  inputSchema: [...DEFAULT_ELIGIBILITY_CLAIMS_KEYS, ...DEFAULT_ELIGIBILITY_TEXT_KEYS],
  outputSchema: [
    'eligibility_report',
    'eligibility_passed',
    'eligibility_verdict',
    'eligibility_violations',
    'eligibility_units',
    'eligibility_pending',
  ],
}

/** 规则加载结果。 */
export type EligibilityRuleLoad = {
  /** 选中的 A5 规则；资产缺失时缺省。 */
  rule?: ConstitutionalRule
  /** 缺失的规则编号。 */
  missingIds: string[]
  /** 规则资产加载警告。 */
  warnings: string[]
}

/**
 * 加载内置专利全量规则集并选出 A5 客体规则。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 选中规则、缺失编号与警告。
 */
export function loadEligibilityRules(rulesDir?: string): EligibilityRuleLoad {
  const loaded = loadPatentFullRuleSet(rulesDir)
  const rule = loaded.ruleSet.rules.find(item => item.id === ELIGIBILITY_A5_RULE_ID)
  return {
    ...(rule !== undefined ? { rule } : {}),
    missingIds: rule === undefined ? [ELIGIBILITY_A5_RULE_ID] : [],
    warnings: loaded.warnings,
  }
}

let cachedRules: EligibilityRuleLoad | undefined

/** 读取进程内缓存的规则集（资产固定，无需失效）。 */
function defaultRules(): EligibilityRuleLoad {
  cachedRules ??= loadEligibilityRules()
  return cachedRules
}

/** 规则加载器，供测试注入最小规则集。 */
export type EligibilityCheckLoader = () => EligibilityRuleLoad

/** 权利要求书标记：出现这些词或行首编号“一种”时按权项切分。 */
const CLAIM_MARKER_RE = /权利要求|其特征在于|保护范围/
const CLAIM_NUMBERED_START_RE = /^\s*\d+[.、．]\s*一种/m

/**
 * 判断文本是否按权利要求书处理。
 * @param text - 候选文本。
 * @returns 出现权利要求标记时为 true。
 */
function looksLikeClaims(text: string): boolean {
  return CLAIM_MARKER_RE.test(text) || CLAIM_NUMBERED_START_RE.test(text)
}

/** 文本读取结果。 */
type SourceRead =
  | { kind: 'claims'; text: string }
  | { kind: 'material'; text: string }
  | { kind: 'missing'; reason: string }
  | { kind: 'error'; reason: string }

/**
 * 读取权利要求或技术方案文本。
 * @param state - 阶段执行态。
 * @param claimsKeys - 权利要求候选键。
 * @param textKeys - 技术方案候选键。
 * @returns 文本与作用域、缺失原因或类型错误。
 */
function readSource(
  state: PipelineState,
  claimsKeys: readonly string[],
  textKeys: readonly string[],
): SourceRead {
  const claims = readFirstStateText(state, claimsKeys, '权利要求')
  if (claims.kind === 'error') return claims
  if (claims.kind === 'text') {
    const explicit = claims.key === 'claims' || claims.key === 'claims_draft'
    return { kind: explicit || looksLikeClaims(claims.text) ? 'claims' : 'material', text: claims.text }
  }
  const material = readFirstStateText(state, textKeys, '技术方案')
  if (material.kind === 'error') return material
  if (material.kind === 'text') {
    return { kind: looksLikeClaims(material.text) ? 'claims' : 'material', text: material.text }
  }
  return {
    kind: 'missing',
    reason: `未提供权利要求或技术方案文本（${[...claimsKeys, ...textKeys].join(' / ')}）`,
  }
}

/** 待筛查单元。 */
type UnitInput = {
  /** 权项号；整体筛查时缺省。 */
  claimNo?: number
  /** 单元文本。 */
  text: string
}

/**
 * 按作用域切分筛查单元。
 * @param text - 待筛查文本。
 * @param scope - 权利要求或技术方案。
 * @returns 权项单元；整体筛查时只有一个无编号单元。
 */
function splitUnits(text: string, scope: 'claims' | 'material'): UnitInput[] {
  if (scope === 'material') return [{ text }]
  const segments = splitClaimSegments(text)
  if (segments.size === 0) return [{ text }]
  return [...segments.entries()]
    .sort(([left], [right]) => left - right)
    .map(([claimNo, body]) => ({ claimNo, text: body }))
}

/**
 * 抽取主题名称：去行首编号，取首句前 120 字。
 * @param text - 权项或整体文本。
 * @returns 主题名称。
 */
function extractSubject(text: string): string {
  const trimmed = text.trim().replace(/^\s*\d+[.、．]\s*/, '')
  const first = trimmed.split(/[，,。；;\n]/)[0]?.trim() ?? ''
  return first.slice(0, 120)
}

/** 技术特征强标记：设备/参数/工艺/材料/结构/控制。 */
const STRONG_TECHNICAL_RES: readonly RegExp[] = [
  /装置|设备|机器|系统|电路|模块|器件|部件|组件|传感器|处理器|存储器|控制器|服务器|终端|计算机|芯片|集成电路/,
  /天线|滤波器|放大器|电机|发动机|泵|阀|管道|反应器|锅炉|换热器|电极|电池|激光器|透镜|光纤|摄像头|显示器|键盘|打印机/,
  /机器人|车辆|飞行器|机床|模具|刀具|夹具|传送带|风机|压缩机|内燃机|涡轮|轴承|齿轮|弹簧|液压|气动|执行器|变频器/,
  /温度|压力|浓度|湿度|电压|电流|功率|频率|波长|转速|流量|液位|pH|酸碱度|厚度|直径|长度|宽度|高度|重量/,
  /质量分数|体积分数|速度|加速度|扭矩|载荷|应力|应变|粘度|密度|纯度|粒度|孔隙率/,
  /加热|冷却|制冷|保温|混合|搅拌|溶解|过滤|蒸馏|萃取|结晶|干燥|焙烧|烧结|熔炼|铸造|锻造|轧制|挤压|拉伸|冲压|切削|磨削/,
  /焊接|粘接|涂覆|镀覆|沉积|刻蚀|光刻|注入|掺杂|退火|淬火|回火|粉碎|筛分|输送|泵送|压缩|膨胀|燃烧|催化|聚合|水解|氧化|还原/,
  /中和|沉淀|离心|消毒|灭菌|封装|组装|拆卸/,
  /检测|测量|采集|采样|校准|定位|导航|驱动|制动|发射|接收|调制|解调|编码|解码|存储|传输|通信|控制|加密|解密|鉴权|认证/,
  /组合物|材料|合金|陶瓷|玻璃|纤维|涂料|粘合剂|塑料|橡胶|树脂|药品|药物|食品|饲料|肥料|农药/,
  /微生物|菌株|细菌|真菌|病毒|噬菌体|酵母|霉菌|反应堆|线圈|真空室|靶室/,
  /结构|连接|安装|固定|支撑|密封|导向|传动|锁定|调节|伸缩|旋转|滑动|铰接|卡接|螺纹/,
  /显示|界面|交互|输入|输出|触摸|按键|屏幕|用户操作/,
  /图像|影像|语音|信号/,
  /数据处理|数据管理|数据存储|数据传输|数据采集|数据分析|数据清洗|数据压缩|数据检索/,
]

/** 技术特征弱标记：单独出现不足以认定为技术特征。 */
const WEAK_TECHNICAL_RES: readonly RegExp[] = [
  /数据|信息|模型|算法|软件|程序|数据库|网络|互联网|区块链|人工智能|机器学习|神经网络/,
]

/** 技术特征信号。 */
type TechnicalSignal = {
  /** 命中强标记。 */
  strong: boolean
  /** 命中弱标记。 */
  weak: boolean
}

/**
 * 识别技术特征信号。
 * @param text - 权项或整体文本。
 * @returns 强弱标记命中情况。
 */
function detectTechnicalSignal(text: string): TechnicalSignal {
  return {
    strong: STRONG_TECHNICAL_RES.some(pattern => pattern.test(text)),
    weak: WEAK_TECHNICAL_RES.some(pattern => pattern.test(text)),
  }
}

/** 药物/试剂等产品权利要求。 */
const MEDICAL_PRODUCT_RE =
  /药物组合物|药物制剂|制剂|试剂盒|试剂|抗体|疫苗|化合物|载体|芯片|装置|设备|系统|仪器|培养基|标志物/

/** 制备/生产药物的方法（属于可授权的制造方法，不是治疗方法）。 */
const MEDICAL_PREPARATION_RE =
  /(?:药物|药剂|制剂|组合物)[^，。；]{0,12}(?:制备|生产|制造|合成|配制)|(?:制备|生产|制造|合成|配制)[^，。；]{0,12}(?:药物|药剂|制剂|组合物)/

/** “在制备…药物中的应用”用途权利要求。 */
const PREPARATION_USE_RE = /(?:在|用于)制备[^，。；]{0,24}(?:药物|药剂|制剂)/

/** 诊断/治疗动作 + 方法。 */
const MEDICAL_ACTION_RE = /(诊断|治疗|手术|给药|用药|施药|理疗|化疗|放疗)([^，。；]{0,12})(?:的)?方法/

/** 动作与方法之间出现这些词时，主题是设备控制/数据处理而不是诊疗方法。 */
const MEDICAL_TOOL_GAP_RE =
  /机器人|装置|设备|系统|仪器|导航|控制|规划|成像|影像|图像|数据处理|模型|算法|参数|流程/

/** 生物学术语（与“品种”同时出现时按动植物品种处理）。 */
const BIOLOGICAL_TERM_RE =
  /动物|植物|作物|家畜|家禽|畜禽|农作物|花卉|林木|果树|蔬菜|草|食用菌|水稻|小麦|玉米|大豆|棉花|油菜|马铃薯|番茄|黄瓜|苹果|柑橘|茶树|烟草|菌|藻|微生物|细胞|胚胎/

/** 动物/植物品种本身。 */
const VARIETY_RE = /品种|新品种/

/** 生产动植物品种的方法（A25.2：非生物学方法可授权）。 */
const VARIETY_METHOD_RE =
  /(?:培育|繁育|育种|选育|繁殖|生产|制备)[^，。；]{0,16}(?:品种|植株|动物|植物)/

/** 微生物、菌株与病毒不属于动植物品种。 */
const MICROORGANISM_RE = /微生物|菌株|细菌|真菌|病毒|噬菌体|酵母|霉菌|食用菌|蘑菇/

/** 原子核变换方法。 */
const NUCLEAR_METHOD_RE = /(?:原子核变换|核裂变|核聚变|核素嬗变|核变换)[^，。；]{0,12}(?:方法|工艺|过程)/

/** 由核变换获得的物质。 */
const NUCLEAR_PRODUCT_RE =
  /(?:由|通过)[^，。；]{0,24}(?:原子核变换|核裂变|核聚变|核反应)[^，。；]{0,24}(?:制得|得到|获得|产生)/

/** 科学发现/自然规律本身。 */
const DISCOVERY_RE = /科学发现|自然现象|自然规律|科学理论|数学理论/

/** 印刷品的图案/色彩设计。 */
const PRINTED_RE =
  /(?:印刷|印制|打印)[^，。；]{0,10}(?:图案|花纹|色彩|文字|符号)|(?:图案|花纹|色彩)[^，。；]{0,10}(?:设计|排列|印刷)/

/** 商业规则主题。 */
const BUSINESS_RE =
  /商业|经营|营销|销售|交易|金融|保险|投资|拍卖|广告|租赁|物流|电商|支付|结算|定价|促销|客户|订单|库存|供应链/

/** 指南第二部分第一章4.2 明确列举的智力活动规则类型。 */
const MENTAL_STRONG_RES: readonly RegExp[] = [
  /(?:游戏|比赛|竞赛|体育|娱乐|棋|牌)[^，。；]{0,10}(?:规则|方法|玩法|计分)/,
  /(?:教学|授课|训练|驯兽|培训|考试|测验|心理测验|智力测验)[^，。；]{0,10}(?:方法|规则|方案)/,
  /(?:管理|经营|商业|营销|销售|财务|会计|记账|统计|审计|保险|金融|投资|拍卖|广告|物流|调度|排班|资源配置)[^，。；]{0,14}(?:方法|规则|制度|模式|方案)/,
  /(?:数学|算术|演算|计算|换算|推导|证明)[^，。；]{0,10}(?:方法|理论|规则)/,
  /(?:日历|字典|图书分类|汉字编码|语法|乐谱|食谱|棋谱|情报检索|专利分类|疾病普查|人口统计)/,
  /(?:锻炼|健身|养生|减肥|美容)[^，。；]{0,10}方法/,
  /计算机程序本身/,
]

/** 可能属于智力活动、但也常见于技术方案的边界主题。 */
const MENTAL_BORDERLINE_RES: readonly RegExp[] = [
  /(?:分类|检索|查询|决策|预测|评价|评估|优化|推荐|调度|规划)[^，。；]{0,10}(?:方法|模型|规则|方案)/,
]

/**
 * 判定主题类别。
 * @param subject - 主题名称。
 * @param signal - 技术特征信号。
 * @returns 客体类别。
 */
function classifySubject(subject: string, signal: TechnicalSignal): EligibilityCategory {
  if (PREPARATION_USE_RE.test(subject)) return 'medical-use'
  if (MEDICAL_PREPARATION_RE.test(subject)) return 'technical-solution'
  if (MEDICAL_PRODUCT_RE.test(subject) && !subject.includes('方法')) return 'medical-use'
  const medical = MEDICAL_ACTION_RE.exec(subject)
  if (medical !== null && !MEDICAL_TOOL_GAP_RE.test(medical[2] ?? '')) return 'medical-method'
  if (!MICROORGANISM_RE.test(subject)) {
    if (VARIETY_METHOD_RE.test(subject)) return 'variety-method'
    if (BIOLOGICAL_TERM_RE.test(subject) && VARIETY_RE.test(subject)) return 'variety'
  }
  if (NUCLEAR_METHOD_RE.test(subject) || NUCLEAR_PRODUCT_RE.test(subject)) return 'nuclear'
  if (DISCOVERY_RE.test(subject)) return 'discovery'
  if (PRINTED_RE.test(subject)) return 'printed-matter'
  if (MENTAL_STRONG_RES.some(pattern => pattern.test(subject))) {
    if (subject.includes('计算机程序本身')) return 'mental-activity'
    if (BUSINESS_RE.test(subject) && (signal.strong || signal.weak)) return 'business-method'
    return signal.strong || signal.weak ? 'mental-activity-review' : 'mental-activity'
  }
  if (MENTAL_BORDERLINE_RES.some(pattern => pattern.test(subject))) {
    return signal.strong ? 'technical-solution' : 'mental-activity-review'
  }
  return 'technical-solution'
}

/** 单项评估结果。 */
type UnitEvaluation = {
  /** 单元结论。 */
  unit: EligibilityUnit
  /** 单元发现；无发现时缺省。 */
  violation?: EligibilityViolation
}

/** 发现构造参数。 */
type FindingInput = {
  code: string
  severity: EligibilitySeverity
  category: EligibilityCategory
  label: string
  message: string
  claimNo?: number
  legalBasis?: string
}

/**
 * 构造发现，按 exactOptionalPropertyTypes 条件展开可选字段。
 * @param input - 发现内容。
 * @returns 发现对象。
 */
function finding(input: FindingInput): EligibilityViolation {
  return {
    code: input.code,
    severity: input.severity,
    category: input.category,
    label: input.label,
    message: input.message,
    ...(input.claimNo !== undefined ? { claimNo: input.claimNo } : {}),
    ...(input.legalBasis !== undefined ? { legalBasis: input.legalBasis } : {}),
  }
}

/**
 * 评估单个单元。
 * @param input - 待筛查单元。
 * @returns 单元结论与发现。
 */
function evaluateUnit(input: UnitInput): UnitEvaluation {
  const subject = extractSubject(input.text)
  const signal = detectTechnicalSignal(input.text)
  const category = classifySubject(subject, signal)
  const claimNo = input.claimNo
  const common = claimNo !== undefined ? { claimNo } : {}
  let violation: EligibilityViolation | undefined
  let verdict: EligibilityVerdict = 'eligible'

  switch (category) {
    case 'mental-activity':
      violation = finding({
        ...common,
        code: 'ELIG-A25-MENTAL',
        severity: 'block',
        category,
        label: '智力活动的规则和方法',
        message: '主题仅涉及智力活动的规则和方法，未识别到技术特征；除主题名称外全部为智力活动内容时属于 A25.1(2) 排除情形',
        legalBasis: '专利法第25条第1款第(二)项；审查指南第二部分第一章4.2',
      })
      verdict = 'excluded'
      break
    case 'medical-method':
      violation = finding({
        ...common,
        code: 'ELIG-A25-MEDICAL',
        severity: 'block',
        category,
        label: '疾病的诊断和治疗方法',
        message: '以有生命的人体或动物体为直接实施对象的诊断/治疗方法属于 A25.1(3) 排除情形；对应的装置、药物或制造方法不受此限',
        legalBasis: '专利法第25条第1款第(三)项；审查指南第二部分第一章4.3',
      })
      verdict = 'excluded'
      break
    case 'variety':
      violation = finding({
        ...common,
        code: 'ELIG-A25-VARIETY',
        severity: 'block',
        category,
        label: '动物和植物品种',
        message: '动物或植物品种本身属于 A25.1(4) 排除情形；非生物学生产方法与微生物发明可另行评估',
        legalBasis: '专利法第25条第1款第(四)项、第2款；审查指南第二部分第一章4.4',
      })
      verdict = 'excluded'
      break
    case 'nuclear':
      violation = finding({
        ...common,
        code: 'ELIG-A25-NUCLEAR',
        severity: 'block',
        category,
        label: '原子核变换方法及所得物质',
        message: '原子核变换方法以及用该方法获得的物质属于 A25.1(5) 排除情形；核反应堆等装置不受此限',
        legalBasis: '专利法第25条第1款第(五)项',
      })
      verdict = 'excluded'
      break
    case 'business-method':
      violation = finding({
        ...common,
        code: 'ELIG-A2-BUSINESS',
        severity: 'warn',
        category,
        label: '商业规则与方法',
        message: '主题包含商业规则，同时识别到技术特征，不按 A25 排除；若所解决的问题是商业问题而非技术问题，仍可能不构成 A2.2 技术方案',
        legalBasis: '专利法第2条第2款；审查指南第二部分第一章4.2、第二部分第九章2',
      })
      verdict = 'needs-review'
      break
    case 'mental-activity-review':
      violation = finding({
        ...common,
        code: 'ELIG-A25-MENTAL',
        severity: 'warn',
        category,
        label: '疑似智力活动的规则和方法',
        message: signal.strong || signal.weak
          ? '主题可能涉及智力活动规则，且识别到技术特征；不按 A25 排除，但是否构成 A2.2 技术方案需结合技术问题与技术效果判断'
          : '主题可能涉及智力活动规则，未识别到技术特征；需核实是否仅涉及抽象规则或方法',
        legalBasis: '专利法第2条第2款、第25条第1款第(二)项；审查指南第二部分第一章4.2',
      })
      verdict = 'needs-review'
      break
    case 'variety-method':
      violation = finding({
        ...common,
        code: 'ELIG-A25-VARIETY-METHOD',
        severity: 'warn',
        category,
        label: '动植物品种生产方法',
        message: '生产动植物品种的方法（A25.2）在人的技术介入起主要控制作用时不属于“主要是生物学的方法”，可予授权；需核实人的技术介入程度',
        legalBasis: '专利法第25条第2款；审查指南第二部分第一章4.4',
      })
      verdict = 'needs-review'
      break
    case 'discovery':
      violation = finding({
        ...common,
        code: 'ELIG-A25-DISCOVERY',
        severity: 'warn',
        category,
        label: '科学发现',
        message: '科学发现本身属于 A25.1(1) 排除情形；发现的具体应用可能构成可授权客体，需核实权利要求是否限定技术应用',
        legalBasis: '专利法第25条第1款第(一)项',
      })
      verdict = 'needs-review'
      break
    case 'printed-matter':
      violation = finding({
        ...common,
        code: 'ELIG-A25-PRINTED',
        severity: 'warn',
        category,
        label: '印刷品图案设计',
        message: '以图案、色彩或文字排列本身为保护对象的印刷品设计属于 A25.1(6) 排除情形；与产品结构结合时需整体判断',
        legalBasis: '专利法第25条第1款第(六)项',
      })
      verdict = 'needs-review'
      break
    case 'medical-use':
    case 'technical-solution':
      if (!signal.strong && !signal.weak) {
        violation = finding({
          ...common,
          code: 'ELIG-A2-TECHNICAL-SIGNAL',
          severity: 'warn',
          category,
          label: '未识别到技术特征',
          message: '未识别到技术手段或技术特征标记；需核实主题是否构成利用自然规律解决技术问题的 A2.2 技术方案',
          legalBasis: '专利法第2条第2款',
        })
        verdict = 'needs-review'
      }
      break
    /* v8 ignore next -- closed-union backstop; the compiler rejects a new category here. */
    default:
      break
  }

  const unit: EligibilityUnit = {
    ...(claimNo !== undefined ? { claimNo } : {}),
    subject,
    category,
    technicalFeatures: signal.strong || signal.weak,
    verdict,
  }
  return { unit, ...(violation !== undefined ? { violation } : {}) }
}

/**
 * 执行 A5 规则并追加发现。
 * @param text - 待评估文本。
 * @param loaded - 规则加载结果。
 * @param pending - 待核项收集器。
 * @param violations - 发现收集器。
 * @returns 无返回值；结果写入两个收集器。
 */
function evaluateA5(
  text: string,
  loaded: EligibilityRuleLoad,
  pending: EligibilityPending[],
  violations: EligibilityViolation[],
): void {
  if (loaded.rule === undefined) {
    pending.push({
      code: 'ELIG-A5-UNCHECKED',
      label: '违反法律与公序良俗',
      message: `规则资产缺失：${loaded.missingIds.join('、') || ELIGIBILITY_A5_RULE_ID}`,
    })
    return
  }
  if (loaded.warnings.length > 0) {
    const shown = loaded.warnings.slice(0, 3).join('；')
    const suffix = loaded.warnings.length > 3 ? ` 等 ${loaded.warnings.length} 条` : ''
    pending.push({
      code: 'ELIG-A5-ASSET-WARNING',
      label: 'A5 规则资产警告',
      message: `${shown}${suffix}`,
    })
  }
  const result = evaluateText(text, { rules: [loaded.rule] })
  for (const violation of result.violations) {
    violations.push(a5Finding(loaded.rule, violation))
  }
}

/**
 * 把规则违规转换为客体发现。
 * @param rule - A5 规则。
 * @param violation - 规则违规。
 * @returns 客体发现。
 */
function a5Finding(rule: ConstitutionalRule, violation: RuleViolation): EligibilityViolation {
  const evidence = violation.evidence.map(item => item.trim()).filter(item => item.length > 0)
  return {
    code: 'ELIG-A5-PUBLIC-ORDER',
    severity: 'warn',
    category: 'public-order',
    label: rule.name,
    message: `规则 ${violation.ruleId} 命中：${violation.message}`,
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(violation.legalBasis !== undefined ? { legalBasis: violation.legalBasis } : {}),
  }
}

/** 报告渲染参数。 */
type ReportInput = {
  /** 是否无阻断项。 */
  passed: boolean
  /** 总体结论。 */
  verdict: EligibilityVerdict
  /** 作用域。 */
  scope: 'claims' | 'material'
  /** 单元结论。 */
  units: readonly EligibilityUnit[]
  /** 发现。 */
  violations: readonly EligibilityViolation[]
  /** 待核项。 */
  pending: readonly EligibilityPending[]
}

/**
 * 渲染筛查报告。
 * @param input - 检查结果。
 * @returns 面向模型/用户的 Markdown 文本。
 */
function renderReport(input: ReportInput): string {
  const { passed, verdict, scope, units, violations, pending } = input
  const blocks = violations.filter(item => item.severity === 'block').length
  const warns = violations.filter(item => item.severity === 'warn').length
  let header = '通过（未发现 A25 排除事由）'
  if (!passed) header = `未通过（${blocks} 条阻断）`
  else if (warns > 0 || pending.length > 0) {
    const pendingNote = pending.length > 0 ? `，${pending.length} 项待核` : ''
    header = `需人工复核（${warns} 条提示${pendingNote}）`
  }
  const lines = [`可专利客体审查（A2/A5/A25）：${header}`]
  lines.push(
    scope === 'claims'
      ? `- 审查对象：权利要求（共 ${units.length} 项）`
      : '- 审查对象：技术交底书/技术方案（未提供权利要求，按整体文本筛查）',
  )
  for (const violation of violations) {
    const where = violation.claimNo === undefined ? '' : `权利要求 ${violation.claimNo}：`
    const basis = violation.legalBasis === undefined ? '' : `（依据：${violation.legalBasis}）`
    const evidence = violation.evidence === undefined || violation.evidence.length === 0
      ? ''
      : `；命中「${violation.evidence.slice(0, 3).join('」「')}」`
    lines.push(`- [${violation.severity}] ${violation.code} ${where}${violation.message}${evidence}${basis}`)
  }
  for (const item of pending) {
    lines.push(`- 待核：${item.code} ${item.label}——${item.message}`)
  }
  lines.push(
    `限制说明：本原子只做主题名称与文本表面的确定性筛查，结论为 ${verdict}；不进行技术问题/技术效果认定，也不替代审查意见。含技术特征的权利要求按整体判断，最终客体结论需人工复核。`,
  )
  return lines.join('\n')
}

/**
 * 解析字符串参数；未声明时返回默认键列表，声明但非法时返回 undefined。
 * @param state - 阶段执行态。
 * @param paramKey - 阶段参数键。
 * @param defaults - 默认键列表。
 * @returns 候选键列表；参数非法时为 undefined。
 */
function resolveKeys(
  state: PipelineState,
  paramKey: string,
  defaults: readonly string[],
): readonly string[] | undefined {
  const value = state[paramKey]
  if (value === undefined) return defaults
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const key = value.trim()
  return [...new Set([key, ...defaults])]
}

/**
 * 是否存在提示项或待核项。
 * @param violations - 发现列表。
 * @param pending - 待核项列表。
 * @returns 存在时为 true。
 */
function warningsOrPending(
  violations: readonly EligibilityViolation[],
  pending: readonly EligibilityPending[],
): boolean {
  return violations.length > 0 || pending.length > 0
}

/** eligibility 执行器：A2/A5/A25 确定性筛查。 */
export class EligibilityHandler implements StageHandler {
  readonly name = 'eligibility'
  readonly category = 'gate' as const

  private readonly loadRuleSet: EligibilityCheckLoader

  /**
   * @param loadRuleSet - 规则加载器；缺省读取内置专利全量规则集。
   */
  constructor(loadRuleSet: EligibilityCheckLoader = defaultRules) {
    this.loadRuleSet = loadRuleSet
  }

  /**
   * 执行客体筛查阶段。
   * @param input - 阶段执行输入（state 中已合入阶段参数）。
   * @returns 下一步状态：报告、通过标记、总体结论、发现、单元结论与待核项。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const { state } = input
    const claimsKeys = resolveKeys(state, 'claims_key', DEFAULT_ELIGIBILITY_CLAIMS_KEYS)
    if (claimsKeys === undefined) {
      return degraded('eligibility', 'params.claims_key 必须是非空字符串')
    }
    const textKeys = resolveKeys(state, 'text_key', DEFAULT_ELIGIBILITY_TEXT_KEYS)
    if (textKeys === undefined) {
      return degraded('eligibility', 'params.text_key 必须是非空字符串')
    }

    const source = readSource(state, claimsKeys, textKeys)
    if (source.kind === 'missing') return degraded('eligibility', source.reason)
    if (source.kind === 'error') return degraded('eligibility', source.reason)

    const unitsInput = splitUnits(source.text, source.kind)
    const units: EligibilityUnit[] = []
    const violations: EligibilityViolation[] = []
    for (const unitInput of unitsInput) {
      const evaluation = evaluateUnit(unitInput)
      units.push(evaluation.unit)
      if (evaluation.violation !== undefined) violations.push(evaluation.violation)
    }

    const pending: EligibilityPending[] = []
    let loaded: EligibilityRuleLoad | undefined
    try {
      loaded = this.loadRuleSet()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pending.push({
        code: 'ELIG-A5-UNCHECKED',
        label: '违反法律与公序良俗',
        message: `规则资产加载失败：${message}`,
      })
    }
    if (loaded !== undefined) evaluateA5(source.text, loaded, pending, violations)

    const passed = !violations.some(item => item.severity === 'block')
    const verdict: EligibilityVerdict = !passed
      ? 'excluded'
      : warningsOrPending(violations, pending) ? 'needs-review' : 'eligible'
    return {
      eligibility_report: renderReport({ passed, verdict, scope: source.kind, units, violations, pending }),
      eligibility_passed: passed,
      eligibility_verdict: verdict,
      eligibility_violations: violations,
      eligibility_units: units,
      eligibility_pending: pending,
    }
  }
}
