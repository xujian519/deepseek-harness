# Agent Note: 专利文书只从受控草稿成文

Status: implemented

[English](2026-10-10-patent-documents-single-channel.md) | 中文

## Problem

2026-10-10 的扫描发现同一批名字出现在两套模板体系里：`@deepseek-ai/dsh-doc-template` 以变量替换资产随包分发 `claims-spec`、`invalidation-opinion`、`patentability-opinion`、`search-report` 与 `oa-response-sati`，而 `@deepseek-ai/dsh-patent-document` 从受控草稿渲染同一批文书。受控草稿改造（PR #380 系列，含 `the controlled draft is the only content channel`）只搬到了一侧，所以「唯一内容通道」这句话在仓库里并不成立：调用方可以用 `render_doc_template` 渲染 `claims-spec`，既没有草稿，也没有槽位校验与合规扫描。

三个已核实的事实定了方向。patent preset 挂载 `@deepseek-ai/dsh-patent-document`，从不挂载 `doc-template`，所以 `render_doc_template` 在 patent 模式下不可达，那五个资产除自身测试、doc-template README 与债务台账外也没有消费方。两套引擎并不等价：`patent-document` 填 HTML 正文槽位、注入 `tokens.css` 品牌、写入确定性的段号、经 headless Chrome 导出 PDF、审计渲染后的 HTML，并逐字节核对交付件，这些 `doc-template` 都没有。而且部署到达不了的文书仍然是目录在教模型用的文书：`list_doc_templates` 会把那五个名字返回给每个文档模式会话。

## Decision

专利交付文书只有一个成文通道：`@deepseek-ai/dsh-patent-document` 从受控草稿成文，`@deepseek-ai/dsh-patent-filing` 从同一份草稿写出交件 DOCX。重复的五个资产已从 `dsh-doc-template` 删除，其随包语料现在是四个类别（`specification`、`claims`、`oa-response`、`disclosure`）共十二个模板；`TEMPLATE_CATEGORY_ORDER` 不再带 `patent-report`，随包模板也不声明样式，因此没有随包模板会渲染免责声明。`@deepseek-ai/dsh-doc-style` 保留 `patent-report` 免责声明键，供部署自备该类别模板时使用。

这条决定由机检而非散文边界维持：`packages/bundle/web-app/tests/patent-preset.spec.ts` 把 doc-template 资产的声明名与 patent-document 的模板 id 相比，任一名字两侧同时出现即失败。

## Alternatives considered

**保留两套体系、把边界写下来。** 否决：边界只活在散文里，而模型可见目录仍在提供一个不做草稿校验的通路，两套体系也仍要把每次样式、字段与体例修正各做一遍。

**把 `patent-document` 移植到 `doc-template` 引擎上。** 否决：专利交付件依赖变量替换引擎没有的能力——带自动生成标题、权项号与表题的 HTML 正文槽位、`tokens.css` 品牌注入、可幂等重写的确定性段号、headless Chrome PDF、渲染后 HTML 审计，以及 `verify_deliverable`。在 `doc-template` 侧重做这些，会拿专利工作本要保护的交付体例去换一个用户看不见的收益。

**让专利文书改走 `doc-template` 并退役 `patent-document`。** 否决：这会把「草稿是唯一受校验通道」的决定倒过来，而 preset 的交付门禁（`rule_check` 加 `law_verify`，分析类模板另加 `patent_workflow_run`）正挂在 `render_patent_document` 上。

## Consequences

专利交付件不再可能绕过草稿模式与合规扫描；patent 模式的模型可见目录不变，因为它本来就不含 `render_doc_template`。

曾用 `render_doc_template` 渲染这五个名字的部署必须迁移，步骤见升级指南 `docs/upgrade-guide/v0.2.1-alpha.2/doc-template-patent-report-assets-removed/guide.zh.md`。

原先以随包资产作为唯一「带样式 + 声明变量」样例的引擎覆盖，现在落在测试装置 `packages/document/doc-template/tests/styled-template.ts` 上；`tests/assets.spec.ts` 断言随包语料不声明样式，使「随包」与「装置」的分界保持可见。

`dsh-doc-style` 保留了一个没有随包模板声明的 `patent-report` 免责声明键。删掉它会破坏在自备模板里使用该类别的部署，因此作为映射条目保留。
