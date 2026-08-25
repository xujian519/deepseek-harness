# Agent Note：doc-sync 门禁误报修复

Status: implemented

[English](2026-08-25-doc-sync-gate-false-positive-repairs.md) | 中文

## 问题

pnpm run doc-sync 曾有五道门禁变红，原因并非文档本身的缺陷：markdown links（四份 self-evolve 追踪文档多写了一级父路径）、translation pairing（一处 bug-fix note 缺少 .i18n.yaml 记录；本地 desktop 构建产物被当作文档扫描）、markdown wrap（评估 RUNBOOK 硬换行）、package paths（把包的内容子目录如 self-evolve/evaluation 误当成 package leaf，从而把其预期产物路径报为漂移）。

## 决策

在各自主表面修复。把四份 self-evolve 文档的链接目标改为向上两级；为 patent-preset bug-fix note 补上缺失的 .i18n.yaml；把评估 RUNBOOK 重排为每物理行一个段落；让 verify-package-paths 仅当目录带有 package.json 时才视其为 package leaf；让仓库文件发现排除被 gitignore 的路径；并把 desktop 的 dist/release/resources 树加入翻译范围排除表。文档修复留在文档里，门禁修复留在门禁里。

## 备选方案

- 把产物路径从文档中改写。否决：这些路径是 runbook 所记录的 CLI 契约。
- 伪造评估产物以满足 package paths。否决：脚手架在数据缺失时必须如实失败，绝不造假。

## 后果

doc-sync 已全绿（28/28）。门禁现在扫描已授权树（尊重 gitignore），并只在真正的 package leaf 上锚定漂移；本地构建产物不再引发翻译配对失败。
