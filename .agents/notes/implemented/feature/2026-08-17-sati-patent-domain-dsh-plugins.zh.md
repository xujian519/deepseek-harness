# Agent Note: Sati 专利域移植为 dsh 插件

Status: implemented

[English](2026-08-17-sati-patent-domain-dsh-plugins.md) | 中文

## 问题

Sati 已把完整专利域（检索、判例/wiki/知识图谱查询、权利要求对照表、撰写、说明书校验、证据判定、规则门禁、附图分析、PDF 下载、工作流/计划状态机）作为单一进程交付，自带模型管道与工具注册表。harness 此前无专利能力；以 MCP 桥接 Sati 进程会重复状态与模型路由。移植必须把所有模型可见面（工具 schema、结果、会话事件）以 dsh 原生形态落地，同时保持 Sati 行为，使 spec 搬运测试能证明等价。

## 决策

**按 Route A（原生移植，零 Sati 进程，无 MCP 桥接）把 Sati 专利域移植为工作区包**，执行 docs/sati-as-dsh-plugins-plan.md P0–P4。packages/patent/ 下落地 9 个包（patent-data、patent-knowledge、patent-core、patent-workflow、patent-tools、patent-rule、patent-document、tool-literature、methodology；patent-core 为纯库）加 vendor/nuo-patent（Sati 专利检索引擎预构建版，MIT）与 apps/cli/config/agent-presets/patent/ 的 agent preset。引擎逐字移植，仅在 dsh 严格性/接缝处适配；约 3.5 GB 的 knowledge.db 永不入库——patent-knowledge:install 裁剪本地源副本。系统知识读 dsh-patent-knowledge，99-知识库/ 保持项目级沉淀（计划 P4.4 覆盖 patent-mode-design.md §9）。

## 备选方案

**保留 Sati 进程的 MCP 桥接。** 被计划 §1.1 决策修订否决：第二进程重复审批、模型路由与会话日志，且专利工具必须运行在 dsh 自身的工具守卫与 post-execute 接缝内（EVI-011、输出门禁）。

**重写引擎而非移植。** 被否决：Sati 引擎（graph、atoms、checkers、规则包、证据规则）带有已测试行为；计划等价性测试要求相同 fixture 下输出一致，因此引擎逐字移植并标注显式适配点（strict 修正、ctx.subprocess、defineTool render 拆分、md-wrap 描述归一）。

## 后果

- 855 个单元测试 / 111 文件（10 个 Sati spec 搬运 + 服务/组合/HMR 安全测试）；9 个专利包 tsc -b 全绿；本工作可归因门禁全绿（verify-md-links、verify-md-wrap、verify-package-paths、verify-translation-pairing tool-catalog 对、verify-type-equiv 385、verify-dsh-package-licenses、verify-package-invariants、patent 会话事件进入生成词汇表后的 verify-persistence-catalog）。
- 审查修复（2026-08-18）：`registerBuiltinAtoms()` 在 patent-tools 的 apply 与 patent-workflow 服务构造中执行，atom-bearing manifest 不再 fail-fast；6 个内置 manifest 的审批阶段声明 `atom: "approval-gate"`（HITL 真实生效），工作流工具用真实 LLM 链式执行器驱动无 atom 阶段（不再回显输入）；审批放行标记只写本次 handler 的状态副本，不会泄漏给后续未授权审批门；LLM 路由在 Config 未配 provider/model 时回退部署默认（`agentDefaultModel`）；`runPlantask` 在审批抛错时清理 pending；图节点对超时施加硬上界并把取消信号与逐调用 temperature/schema 透传到模型端口；消息级输出门禁、`setup_required` 错误码与 EVI-011 域外证据译本范围与接线对齐。
- 已知偏差：tool-catalog 生成器在 packages/self-evolve 未登记前无法运行（外部并发工作）——专利行/章节按生成器 render 格式手工补齐，patent-document 清单条目挂载 LocalSubprocessRuntime（不挂载则收割 0 工具，assertToolsHarvested 必抛）；RuleOutputGate/RuleOutputGateResult 落在 patent-core/src/rule/types.ts（单归属，patent-workflow re-export）；§7 实机带 key 运行与 patent keyless 快照在本环境未执行（无 DEEPSEEK_API_KEY）——以单元覆盖 + Sati spec 搬运替代，已在计划记录中说明。
- 其余仓库级红项全部来自外部 self-evolve 未完成（缺 README、self-evolve-loop/* 事件 JSDoc 违规、cordis.patch.yml 引用、tsconfig.host.json 引用损坏），由另一窗口负责。
