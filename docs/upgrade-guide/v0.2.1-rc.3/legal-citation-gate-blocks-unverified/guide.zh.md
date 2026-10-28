---
kind: upgrade-guide
description: "法律模式现在拦截无法核验的引用，随包索引转录了十七部核心法律而不再是零部。"
---

# 法律引用必须先可核验才能交付

[English](guide.md) | 中文

## 变更

当条文尚未转录时，`legal_law_verify` 把已索引条文判为 `unverified`；当索引不收录某部法律或某条时判为 `not-indexed`。这两种判定现在默认 `block` 而非 `warn`，`legal` preset 也显式声明该策略。`document_deliver` 的交付门禁还要求核验结果至少携带一条 finding，因此对空文本跑一次不再满足前置条件。

随包索引转录了十七部核心法律：民法典、刑法、公司法、劳动法、劳动合同法、民事诉讼法、刑事诉讼法、行政诉讼法、专利法、商标法、著作权法、反不正当竞争法、个人信息保护法、行政处罚法、行政许可法、行政复议法与仲裁法。每个条目记录来源文件与转录日期。该日期记录的是从来源的机械抄录，不代表有资质的人读过回稿。其余自动生成的文件仍是 `text: null`，判定为 `unverified`。

记录了两个字源缺口：语料缺刑事诉讼法第 128 条；以 `第 N 条之一` 写成的修正案条文被并入基础条，而非单独索引。

## 迁移

1. 引用十七部核心法之外的法律、或语料缺失条文的交付件，现在会在 `document_deliver` 被拒绝。可以改引已转录条文，把 `baselineDir` 指向转录了所需条文的部署索引，或在语料确实更窄时刻意放宽 `Config` 中的 `onUnverified` / `onNotIndexed`。部署索引现在必须带有 `manifest.json`，加载器靠它得知每个文件对应哪部法律；缺少清单的目录会在插件加载时被 `assertLegalLawIndexReadable` 拒绝。
2. 对空文本跑 `legal_law_verify` 不再满足交付门禁：结果必须至少携带一条 finding。
3. 通过转录路径重新生成索引：`tsx scripts/legal-knowledge-import/generate-law-yaml.ts <source-dir> packages/legal/legal-law/assets/legal-law --transcribe --verified-on <YYYY-MM-DD> --only <names>`。不带 `--transcribe` 时条目回到 `text: null`。该命令会在写完 YAML 后重写 `manifest.json`；若手工改过 YAML 文件，需要再跑 `tsx scripts/legal-knowledge-import/generate-law-manifest.ts <dir>`，而 `law` 或 `document` 与清单行不一致的文件会在该法下次被引用时失败。
4. 审阅者应把 `unverified` 读作"本索引无法判定该引用"，而不是"该引用错误"；已转录条目若不承载该命题，报 `mismatch`。
