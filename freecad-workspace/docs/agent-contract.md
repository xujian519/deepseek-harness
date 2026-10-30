# 阶段 4 代理契约与护栏

本工作区供 AI 代理（MCP 或脚本闭环）执行参数化建模与出图任务。契约分三部分：允许操作、强制执行顺序、硬性护栏。

## 1. 允许的操作

代理只能做三件事，其余一律拒绝：

| 操作 | 范围 |
|---|---|
| 读仓库 | 整个 `freecad-workspace/` 只读查看 |
| 写文件 | 仅限 `params/`、`scripts/`（含 `parts/`、`scripts/common/`）、`docs/`；不得改 `templates/` 与客户原始图 |
| 执行命令 | `FreeCADCmd` / `freecadcmd`、`xvfb-run -a freecad`、`python3 scripts/import2d.py`；不得执行其他二进制 |

## 2. 强制执行顺序

```
读需求 → 改参数或脚本 → 运行 build.py → 读 stderr/退出码
      → 运行 verify.py → 失败则修正 → 通过后交人工评审 diff
```

- 改参数后必须先跑 `build.py`，再跑 `verify.py`，最后才允许 `sheet.py`。
- `verify.py` 不通过时不得进入 `sheet.py`。
- 任何一步退出码非 0，必须先修再继续，不得跳步。

## 3. 硬性护栏

### 3.1 文件系统

- 源文件目录（`templates/`、`incoming/`、`parts/` 以外的既有代码）只读。
- 产物只能写入 `out/<run-id>/`，`run-id` 用 UTC 时间戳或 UUID。
- 每次执行必须在变体目录下生成/更新 `manifest.json`。

### 3.2 执行

- 单次 `FreeCADCmd` 调用超时 300 s，超时即杀进程并记诊断。
- 同一任务连续失败 3 次即停，输出已收集的 `stdout`/`stderr` 与退出码，不继续重试。
- 失败重试必须先改动输入或脚本，不得用相同参数重复同一命令。

### 3.3 网络

- 禁止访问网络。
- MCP 服务仅绑定 `127.0.0.1`，不得暴露到其他接口。

### 3.4 几何与数值

- 所有改动必须通过 `verify.py` 的体积（0.1% 相对）与包围盒（0.1 mm）断言。
- 体积为 0 或 `isValid()` 为假的几何不得进入出图阶段。
- 退出码含义见 `README.md`：0 成功、2 参数、3 几何、4 导出、5 环境缺失。

## 4. 自修复策略

代理遇到失败时按以下顺序处置，不得直接产出坏文件：

1. 读 `stderr` 与退出码，定位是参数、几何、导出还是环境问题。
2. 参数错误（码 2）：回查 `docs/field-dictionary.md` 的约束，修正 `params/*.json`。
3. 几何错误（码 3）：查 `docs/failure_playbook.md` 第 2 节，调整建模顺序或留余量。
4. 导出错误（码 4）：检查上游产物是否存在，必要时重跑 `build.py`。
5. 环境缺失（码 5）：停止，报告缺少的依赖，不得伪造结果。

自修复成功的判据：`verify.py` 退出码为 0，且 `manifest.json` 的 `checks.volume_pass` 与 `checks.bbox_pass` 均为真。

## 5. 人工评审门禁

- 任何对 `scripts/`、`parts/` 的修改必须提交 `git diff` 供人工评审。
- 出图产物（DXF/PDF）必须由人工核对 `dimensions.json` 与 `manual_review.md` 后才能交付。
- `manual_review.md` 非空时不得标记任务完成。

## 6. 上下文资产（事实库）

代理执行前必须加载以下文件作为上下文：

- `docs/api_snippets.md`：已验证的 FreeCAD API 片段。
- `docs/field-dictionary.md`：模板字段与零件族参数表。
- `docs/failure_playbook.md`：常见错误与修法。
- `docs/naming.md`：命名约定。
- `params/*.json`：输出格式少样本。
