---
kind: upgrade-guide
description: "Claim-chart 源文件读取被限制在配置的允许根、文本文件与大小上限内，模型给出的路径不再能触达任意文件。"
---

# Claim-chart 源文件读取受目录限制

[English](guide.md) | 中文

## 变更

- `claim-chart` 将每个目标的 `sourcePath` 按工作目录解析，调用 `realpath`，并要求真实路径落在允许根内。默认根是工作目录；`chart_source_roots` stage param 替换默认值，空数组拒绝所有读取。经 `..` 或指向根外的符号链接逃逸的路径，会在引用它的行上失败。
- 只有普通文本文件可读。目录、非普通文件、扩展名不在文本白名单内（`.pdf`、`.docx` 等）或超过 `chart_source_max_bytes` 的文件，会使引用它的行失败。无扩展名的路径被接受。白名单覆盖 `.txt`、`.text`、`.md`、`.markdown`、`.json`、`.jsonl`、`.csv`、`.tsv`、`.xml`、`.html`、`.htm`、`.yaml`、`.yml`、`.log`、`.rst` 与 `.tex`。
- 允许根不可解析或不是目录，或 `chart_source_roots` / `chart_source_max_bytes` 畸形时，阶段在调用模型前降级。`chart_source_max_bytes` 默认 1 MiB，接受 1 字节至 16 MiB 的整数。
- 源文仍只用于校验 pin-cite 与引文，不进入提示词。

## 迁移

1. 把源文件放在工作目录下，或把 `chart_source_roots` 设为它们所在目录。不需要源文校验的目标省略其 `sourcePath`；`chart_source_roots: []` 是拒绝所有读取，而不是跳过校验。
2. 把 PDF 或 DOCX 证据转换为文本，或引用已抽取出的 `.txt`/`.md` 文件。
3. 合法源文超过 1 MiB 时，调高 `chart_source_max_bytes`（最高 16 MiB）。
4. 确认：允许根之外或超过上限的源产生点名文件与原因的行级错误，允许根之内的源仍如常通过 pin-cite 与引文校验。
