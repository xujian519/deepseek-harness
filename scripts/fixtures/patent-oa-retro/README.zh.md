# OA 回溯评测子集

[English](README.md) | 中文

`subset.jsonl` 是 `scripts/adversary-eval.ts` 所用 OA 回溯评测集的五案脱敏切片。它让任意检出都能回归数据集解析、匿名化扫描与（法条, 权项）覆盖形态，而无需分发完整语料。

全量集为 30 案 / 53 争点，从所有者本地归档构建，保存在被忽略的 `.dsh-work/patent-oa-retro/` 目录下，不入库：材料来自真实审查文件，只发布经复核的这一切片。

所选案件覆盖全量集涉及的四个法条，以及权项 1、2、3、5：

| 案件 | 法条 | 权项 |
|---|---|---|
| `oa-001` | A22.3 | 1, 2, 3 |
| `oa-006` | A22.2, A22.3 | 1 |
| `oa-018` | A33 | 1, 2, 3 |
| `oa-021` | A26.4 | 1, 5 |
| `oa-029` | A22.3, A33 | 1, 2 |

校验命令：

```sh
pnpm exec tsx scripts/patent-oa-retro.ts scripts/fixtures/patent-oa-retro/subset.jsonl --min-cases 5
```

`scripts/adversary-eval.spec.ts` 对同一文件做检查：解析、匿名化扫描、四法条 / 三权项位置下限，以及所存争点的结构。
