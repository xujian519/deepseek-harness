// The `search-report` asset of the removed `patent-report` corpus, kept as the
// one fixture that declares a `style` and `vars`. The shipped templates declare
// neither, so the engine cases that need a styled, variable-declaring template
// (style disclaimer, variable validation, unsupported format, HTML stylesheet,
// residual reporting) compose this root beside the packaged one.

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The front matter and body of the styled, variable-declaring fixture template. */
export const STYLED_TEMPLATE_TEXT = `---
name: search-report
title: 专利检索报告
category: patent-report
description: 专利/非专利文献检索报告，记录检索策略、命中文献与相关度评估
domain: patent
version: "1.0.0"
language: zh-CN
style: patent-standard
formats:
  - markdown
  - html
vars:
  - name: firm_name
    type: string
    required: true
    description: 机构名称
  - name: doc_no
    type: string
    required: false
    description: 报告编号
  - name: case_no
    type: string
    required: false
    description: 案号
  - name: invention_title
    type: string
    required: true
    description: 检索主题
  - name: search_type
    type: string
    required: true
    description: 检索类型（新颖性/创造性/自由实施/FTO）
  - name: search_strategy
    type: multiline
    required: true
    description: 检索策略与表达式
  - name: databases_covered
    type: multiline
    required: true
    description: 检索数据库
  - name: key_hits
    type: multiline
    required: true
    description: 关键命中文献列表（含公开号/日期/相关度）
  - name: analysis
    type: multiline
    required: true
    description: 命中文献分析
  - name: conclusion
    type: multiline
    required: true
    description: 检索结论
  - name: disclaimer
    type: string
    required: false
    default: "本报告由 AI 辅助生成，不构成正式法律意见。检索结果可能存在遗漏，仅供人工复核。"
    description: 免责声明
---

# 专利检索报告

<div class="doc-meta">
**机构：** {{firm_name}}　**报告编号：** {{doc_no}}　**案号：** {{case_no}}
</div>

| 检索主题 | 检索类型 |
| --- | --- |
| {{invention_title}} | {{search_type}} |

## 结论摘要

| 指标 | 结果 | 置信度 |
| --- | --- | --- |
| 命中相关文献 | <span class="verdict-success">已获得</span> | 高 |
| 揭示冲突文献 | <span class="verdict-warning">需关注</span> | 中 |

<div class="callout">
> 检索策略与命中结果详见下文，相关重要性结论供人工复核确认。
</div>

## 一、检索策略与表达式

{{search_strategy}}

## 二、检索数据库

{{databases_covered}}

## 三、关键命中文献

{{key_hits}}

## 四、命中文献分析

{{analysis}}

## 五、检索结论

{{conclusion}}

## 假设与局限

- 检索式基于申请人提供的信息构建，可能遗漏未公开或未索引的在先技术。
- 相关度评估为启发式，最终以人工确认及实审/无效程序认定为准。

---

> ⚠️ {{disclaimer}}
`

/** Values satisfying the fixture's required set; `doc_no` and `case_no` stay residual. */
export const STYLED_TEMPLATE_VARIABLES: Readonly<Record<string, string>> = {
  firm_name: '某所',
  invention_title: '图像处理',
  search_type: '新颖性',
  search_strategy: 'S1=(图像处理) AND S2=(神经网络)',
  databases_covered: 'CNKI、DWPI',
  key_hits: 'CN123456A',
  analysis: '命中文献未揭示全部技术特征。',
  conclusion: '具备新颖性。',
}

/** Root written once per test process; `undefined` before the first call. */
let rootPromise: Promise<string> | undefined

/**
 * Write the styled fixture into one memoized temporary directory.
 * @returns the absolute asset root holding `search-report.md`.
 */
export function styledTemplateRoot(): Promise<string> {
  rootPromise ??= writeRoot()
  return rootPromise
}

/** Create the fixture root and write the template asset into it. */
async function writeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doc-template-styled-'))
  await writeFile(join(root, 'search-report.md'), STYLED_TEMPLATE_TEXT)
  return root
}
