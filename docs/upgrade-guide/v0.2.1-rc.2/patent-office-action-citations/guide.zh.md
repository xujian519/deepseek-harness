---
kind: upgrade-guide
description: "审查意见解析不再把全角括号内的本申请号列为引用文献，并读取并列枚举的权项号。"
---

# 审查意见引用覆盖括号自指与并列枚举

[English](guide.md) | 中文

## 变更

`parseOfficeAction` / `extractCitations` / `extractAffectedClaims` 读取通知书正文的口径有变：

- `本申请（申请号CN117000000A）` 这类写法识别为本申请自身，不再出现在引用文献清单中。此前只排除不带括号的 `本申请公开号CN…` 与后置的 `CN…（本申请）`。
- 并列枚举的权项号（`权利要求1、2和3`、`权利要求1，2或4`、`权利要求1、2以及3`）完整读取。`affectedClaims` 与每篇引用文献的同句 `claimsAffected` 现在包含全部枚举权项，而不是只取首个。

## 迁移

1. 对使用括号内本申请号或以 `、／，／和／或` 枚举权项的通知书重新解析。变更前保存的解析结果可能把本申请号列为引用文献，或在通知书点名多个权项时只报一个。
2. 用新的解析结果重建下游答复方案与引用表；这两个字段分别供 `buildResponsePlan` 与摘要渲染使用。
3. 确认：`pnpm exec vitest run packages/patent/patent-core` 通过，且含 `本申请（申请号CN…）` 的通知书在 `citations` 中只报对比文件。
