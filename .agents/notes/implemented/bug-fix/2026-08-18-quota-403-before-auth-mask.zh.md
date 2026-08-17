# Agent Note：配额 403 在 AUTH 掩码之前归类为 QUOTA

状态：implemented

[English](2026-08-18-quota-403-before-auth-mask.md) | 中文

## 问题

带配额措辞的 provider 403——Kimi 的 "You've reached your usage limit for this billing cycle" 是暴露此问题的案例——被归类为 `AUTH`，而客户端把所有 `AUTH` 失败投影成 "API key is invalid"，以免 provider 的鉴权文案（可能回显凭据片段）进入 GUI。用户看到 "API key is invalid"，而真实情况是账户配额耗尽，可操作的原因埋在会话日志里。两个叠加的缺口导致此问题：`httpErrorCode`/`classifyPiAiError` 在检查配额措辞之前就把 401/403 映射成 `AUTH`；`isQuotaExceededError` 只匹配名词在前的措辞（"usage limit exceeded"），漏掉了动词在前的措辞（"reached your usage limit"）。

## 决策

两个分类器（`llm-deepseek` 的 `httpErrorCode` 与 `llm-pi-ai` 的 `classifyPiAiError`）都在 401/403 → `AUTH` 映射之前先检查配额措辞：code/type/message 命中 `isQuotaExceededError` 的 403 归类为 `QUOTA`，客户端因此投影 provider 的真实消息而非通用鉴权文案。`isQuotaExceededError` 同时新增对动词在前措辞（"reached/exceeded/exhausted your usage limit or quota"）的识别。非配额 401/403 保持 `AUTH` 并保留显示掩码：provider 鉴权错误可能回显凭据，且没有具体失败案例值得为权限类错误拓宽错误码面。

## 备选方案

- **为所有 403 引入独立的 `PERMISSION` 错误码**——错误码面更宽（重试策略成员、显示、工具链），且除配额外没有失败案例；为保持修复面窄而否决。
- **只在显示侧改（所有 `AUTH` 都显示真实消息）**——会让可能回显凭据的 provider 鉴权文案重新暴露；掩码的存在正是为此。

## 结果

配额耗尽的 403 现在在轮次错误中显示 provider 的真实原因（"You've reached your usage limit…"），而不是 "API key is invalid"；真正的 401 保持掩码文案。`QUOTA` 本来就不在任何默认重试集合里，重试行为不变。三个接缝（配额措辞、两个分类器、客户端投影）都有单测覆盖，既有 e2e 鉴权快照是 401 用例，保持绿色。
