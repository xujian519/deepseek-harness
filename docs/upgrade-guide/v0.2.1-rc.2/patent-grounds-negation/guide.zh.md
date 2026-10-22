---
kind: upgrade-guide
description: "专利理由识别结果新增 `negated`，被否认的理由不再被读作已主张。"
---

# 专利理由识别区分被否认的理由

[English](guide.md) | 中文

## 变更

`identifyInvalidationGrounds`、`identifyReexaminationGrounds`、`identifyDesignGrounds` 的每条结果新增 `negated: boolean`。命中词位于同一分句的前置否定（`未主张`、`不主张`、`并非`、`没有证据表明` 等）作用范围内时，仍然保留在结果中供人工核对，但标记为 `negated: true`。同一理由先被否认、后又被主张时取后一处正面命中；全部命中都被否定时返回首处否定命中。

下游行为：

- `detectPatentSubject` 不再依据被否定的客体缺陷理由推断 `utility-model`。
- `grounds` 原子在 `grounds_summary` 中为该条追加 `，文中为否定表述`；JSON 输出保留完整列表。
- `buildReexaminationPreparation` 在生成各准备段与 `grounds` 之前排除被否定的结果。

该启发式只检查命中词之前的文字，范围限于同一分句（，；。与换行会截断作用范围），且只看最后一个转折词（但/然而/……）之后的部分。后置否定（……的理由不成立）与双重否定不在判定范围内。

## 迁移

1. TypeScript 消费方须接受这个新的必填字段。构造 `GroundFinding` 字面量时，已主张的理由补 `negated: false`。
2. 把结果当作已主张理由使用前，按 `!finding.negated` 过滤。被否定的条目仍以 `negated: true` 留在结果中，便于报告说明文书否认了什么。
3. 读取持久化 `grounds` 输出的 JSON 消费方会自动收到该字段；除非校验拒绝未知键，否则无需改动解析。
4. 确认：把 `请求人未主张权利要求1不具备新颖性，但主张不具备创造性` 交给无效理由表，观察到新颖性 `negated: true`、创造性 `negated: false`。
