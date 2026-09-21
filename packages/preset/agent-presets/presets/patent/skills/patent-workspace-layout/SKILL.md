---
name: patent-workspace-layout
description: 专利作业工作目录与文档组织约定：一个案子一个子目录，落盘规则与命名规范。开始新案子或需要组织专利作业产物时使用。
---

# 工作目录与文档组织

为专利作业建立独立工作目录 `patent-workspace/`（会话 cwd 指向它），一个案子一个子目录。所有中间产物与证据落盘，保证可追溯、可审计。

## 目录约定

- `00-交底书/`：输入，技术交底书（docx/pdf/md）。
- `01-检索/`：检索式、检索报告（.md）、下载的对比文件原文。
- `02-对比文件/`：精选对比文件 D1/D2/…，命名规范 `D1_<公开号>.pdf`。
- `03-分析/`：交底书理解、新颖性/创造性/侵权/无效分析报告。
- `04-撰写/`：权利要求书、说明书、摘要（.md 起草 → render_patent_document 出 html/pdf）。
- `05-答复/`：审查意见通知书、答复意见。
- `99-知识库/`：项目级沉淀：判例摘录、法条速查、检索技巧（随作业积累）。
- `_case-registry.md`：案子清单：案号、状态、阶段产物索引。
- `_matter-log.md`：案件事件日志（只追加；见 patent-matter 技能）。
- `.patent-teams/`：patent-teams 团队状态目录（dsh-patent-teams 插件写入，业务产物禁止入内）。

## 落盘规则

- 检索记录落盘即模式自带的"记忆"：后续作业先查 `99-知识库/` 与 `01-检索/` 再上网（用 fs-search / grep 召回）。
- 每份交付物（分析报告、权利要求书、答复意见）附证据附录：法条来源、对比文件路径、检索式与日期、数字计算依据。
- 分析报告按案号命名 `03-分析/XX_<类型>.md`，检索报告按日期命名 `01-检索/YYYY-MM-DD_<主题>.md`。
- 正式交付文档（场景模板渲染 html/pdf 或 docx）与对应 md 定稿同目录存放：检索报告 → `01-检索/`，撰写申请文件 → `04-撰写/`，分析/比对意见 → `03-分析/`，答复/补正/复审文书 → `05-答复/`；命名 `<案号>_<场景>_v<版本>.html|pdf|docx`。渲染产物登记 `_matter-log.md`（动作=交付，见 patent-matter 审计链）。

## 开工前检查（外部依赖）

建案前先确认作业要用到的外部依赖，缺哪项就在该案里避开或明确降级（不要等到工具报错才发现）：

| 依赖 | 用途 | 检查方式 |
|---|---|---|
| cnlaw 服务（`:8100` 检索 / `:8001` 图谱与案件链 + Neo4j 7687） | 法条/审查指南/判例核验、创造性四步证据包、案件决策链 | MCP 工具 `mcp__cnlaw__*` 能调用即就绪；不可用时退回 `patent_case_search` / `patent_kg_query` 并说明 |
| ego-browser（ego lite，PATH 上） | CNIPR/CNIPA/Google Patents 检索与登录态复用 | `pnpm` 之外的 CLI 探测；缺失时 `patent_pdf_download` 自动改走页面解析 + HTTP 下载 |
| FreeCAD 1.1+（本机 `/Applications/FreeCAD.app`，工具按绝对路径探测，无需进 PATH） | 三维模型结构线稿 `generate_structure_figure` | 仅三维模型的案子需要；无三维模型时可忽略 |
| RDKit 与化学识别引擎 | 化学结构/名称 → SMILES | **本构建未接入该引擎**（RDKit 只是缺失件之一），化学结构的案子一律人工复核，不要依赖 `recognize_chemical_structure` 出 SMILES |
| knowledge.db | `patent_case_search` / `patent_wiki_search` / `patent_kg_query` | 缺库时知识工具执行期 fail-loud，按 `packages/patent/patent-knowledge/README.md` 安装 |

## 质量门禁

证据附录缺失即视为未完成，交付前由 patent-quality-gate 拦截。
