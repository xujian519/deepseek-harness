---
kind: upgrade-guide
description: "verify_deliverable 现在要求每个路径都是不超过 64 MiB 的普通文件；目录、设备、管道与超限文件按违规项报告，不再读取。"
---

# 交付件路径必须是哈希上限内的普通文件

[English](guide.md) | 中文

## 变更

`verify_deliverable` 过去用 `readFileSync` 直接哈希模型给的每个路径，不检查文件类型与大小。字符设备（如 `/dev/zero`）没有文件尾，FIFO 在没有写端时会阻塞，二者都可能挂死或耗尽内存；过大的文件也会被整体读入再哈希。现在先 stat，要求普通文件且不超过 64 MiB。路径缺失或不可读沿用原提示；目录、设备或 FIFO 报「不是普通文件」，超限文件报 64 MiB 上限。违规规则名不变（`artifact_missing`、`figure_missing`、`rendered_missing`、`requirement_evidence_missing`），按规则名处理的调用方无需改动。

## 迁移

1. 传入文档、附图或证据文件本身；过去传目录的地方先复制或渲染成文件。
2. 超过 64 MiB 的交付件先拆分或压缩，再验收。
3. 确认：`canonical_path` 指向目录时报「不是普通文件」；64 MiB + 1 字节的文件报大小上限；两种情况都不会把该路径写进 `manifest`。
