---
kind: upgrade-guide
description: "专利证据判定对未知证明标准与无法解析的来源改为失败关闭，证据哈希改为带前缀的 SHA-256，旧 FNV 仅保留校验。"
---

# 专利证据判定改为失败关闭并使用 SHA-256

[English](guide.md) | 中文

## 变更

- `EvidenceEngine.assessProofStandard` 新增必填的 `status: 'evaluated' | 'unknown-standard'`。无法识别或空白标准返回 `status: 'unknown-standard'`、`met: false` 与 `无法识别的证明标准` gap；原先仅凭置信度的放行已删除。`preponderance`/`优势证据` 与 `clear_and_convincing`/`高度盖然性` 的阈值不变。
- `evaluatePublicIntent` 返回 `'public' | 'restricted' | 'unknown'`。来源 URI 缺失或无法解析时为 `unknown` 而不是 `public`，引擎对互联网公开证据生成 `major` 复核项，不再把该来源当作对公众开放。
- `contentHash` 改为输出 `sha256:<64 位小写十六进制>`，输入按 UTF-8 编码。`buildWorkflowEvidenceLedger` 的收据哈希与账本 `digest` 采用同一形式。
- `evidence-check` 对 `sha256:` 哈希与摘录重算校验，不一致即阻断。旧版 1–8 位十六进制哈希只按 FNV-1a 校验：一致时通过并产生 `EVID-FORM-INTEGRITY-LEGACY` 待核项（`legacy-hash`）与建议的 SHA-256 值；不一致的短十六进制、任意短十六进制串、无前缀摘要或其他外部格式改为完整性待核项，不再自动当作内建哈希或直接阻断。

## 迁移

1. 更新消费 `ProofStandardResult` 的代码以处理 `status`。无法识别的标准不再可能返回 `met: true`；把部署特定的标准名映射为 `preponderance`/`优势证据` 或 `clear_and_convincing`/`高度盖然性`，或让它继续失败关闭。
2. 把 `publicIntent: 'unknown'` 当作需复核。依赖互联网来源作为公开证据前，提供可解析的 `sourceUri`（调用方需带 `web:` 前缀）。
3. 用 `contentHash` 或等价的 `sha256sum`/`openssl dgst -sha256` 重算证据哈希并加 `sha256:` 前缀。已存账本无需改写：加载时不重算哈希，旧 FNV 值仍可读取；但把旧值传入 `evidence-check` 会产生 legacy 待核项，而不是静默通过。
4. 确认：未知标准返回 `met: false` 且 `status: 'unknown-standard'`；来源无法解析时 `publicIntent: 'unknown'`；被篡改的 `sha256:` 哈希阻断；匹配的旧哈希通过并产生 `EVID-FORM-INTEGRITY-LEGACY`。
