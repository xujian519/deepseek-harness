# Agent Note: 角色→Worker 契约映射（软映射）

Status: implemented

[English](2026-08-23-role-worker-contract-mapping.md) | 中文

## 问题

团队成员的角色（`TeamMember.role`）只是自由字符串，只有两个消费点：成员 persona 中一句 `with the role: X`，以及 `patent_teams_status` 里一行。preset 技能给每个角色写明立场与职责，但由 captain 以手写「角色简报」消息传达，没有任何约束或校验。另一边，`patent-workflow` 提供声明式 `WorkerContract` 目录（`defaultPatentWorkers`，含 `allowedTools` / `outputs.requiredFields` / `triggersHITL` / `canInvoke`），但其唯一消费者是独立的 `patent_worker_validate` 工具——这套契约从未约束团队成员、任务分派或任务验收。于是：团队角色「有描述、无契约」，既有契约「无团队侧消费者」。

## 决策

建立软性角色→契约映射（契约引导 + 任务验收），不改工具白名单、不改调度分派：

- **契约数据放 `patent-workflow`**（它已是契约的家）。新增 `src/role-contracts.ts`：`RoleStance`、`RoleContract`（role / name / stance / description / workers / forbiddenActions / triggersHITL）、`defaultRoleContracts()`（覆盖 preset 全部 12 角色）、`roleContract()`、`roleWorkers()`、`workerDeliverables()`（persona/status 用的平铺必含交付字段串）、`workerContract()`。`roleWorkers` 在角色引用未知 worker 时 fail loud。在 `defaultPatentWorkers()` 新增 7 个面向角色的 worker（case-manager、applicant-counsel、formal-examiner、invalidity-petitioner、patentee-defender、defendant-counsel、adjudicator、tech-investigator）；4 个既有 worker 由角色复用（`patent-search-commander`、`patent-technical-analyzer`、`patent-oa-writer`，及新颖/创造性分析器）。`role-contracts.ts` 经包出口 re-export。
- **`patent-teams` 消费契约**。新增 `@deepseek-ai/dsh-patent-workflow` 的 peer+dev 依赖与 `tsconfig` project reference。`addMember(role)` 解析 `roleContract` 并折入成员 persona 的「Role contract」章节（立场、平铺的必含交付字段、越界禁止、是否触发 HITL）；未知或空角色保持现有 persona。`createTask` 增可选 `worker` 并对未知 worker 名 fail loud。`updateTask` 收口（completed + worker + output）时跑 `validateWorkerOutput`，把结果写入任务（`contractValidation`）并追加 `patent-teams/task-validated` 事件——纯软性，绝不阻断 `completed`。`patent_teams_status` 附每个成员的角色契约摘要与每个任务的 worker/验收行。
- **文档**：preset 技能角色总表加「职责契约」列；创建序列第 4 步去掉全文角色简报，改为只发案卷上下文（契约已进入 persona）。

## 备选方案

**白名单收缩（按角色设 `toolFilter.allow`）。** 留作独立事项：它会显著改变成员能力边界，需为每角色组合「所需工具 ∪ 团队成员必须保留的流程工具」，且 `tools.restrict()` 过滤继承面、不剥自身层，白名单必须把成员答题所需的一切都点名。软映射现在交付角色边界引导，规避这一爆炸半径。

**Worker 作为可执行单元（任务携带 worker 契约；成员跑 输入→处理→输出→审批）。** 留作独立立项：它重写团队任务模型，并把 `patent-workflow` 的 manifest/handler 流水线串进成员执行，是三者中改动最大的一项。

## 后果

- `patent-teams` 现依赖 `patent-workflow`（peer+dev），依赖单向；`tsconfig` reference 是 source-plane 链接。
- 携带已知角色的成员获得显式、非静默的角色契约，替代单个形容词；`patent_teams_add_member` 记录角色 id。未知角色仍以通用 persona 生成（向后兼容）。
- `TeamTask` 增可选 `worker` / `contractValidation`；`patent-teams/task-validated` 是新事件类型，payload 沿用既有 `patent-teams/*` 约定。`patent_teams_status` 向 captain 呈现角色交付项与验收结论。
- 软边界是已知局限：成员仍继承全套专利工具（仅屏蔽 captain 管理工具），角色越界仍靠模型自觉——本映射把边界从「隐式」提升到「明示 + 可校验」，但不强制。
- `workerDeliverables(role)` 是 persona/status 交付项列的唯一定制渲染（`members.roleSection` 与 service 的 `contractSummary` 共用），替换了原先重复的平铺 `flatMap` 及其非空断言；未知角色返回空串。
- 若 `patent_worker_validate` 的描述或 `availableWorkers` 变化，需重跑 `gen-tool-catalog`（目录经 `defaultPatentWorkers()` 自动覆盖扩展后的 worker）。

## 非归因失败（待对方窗口收尾）

全仓级门禁在本工作树红，但非本改动归因：失败项均指向并发 `self-evolve` 窗口的 package（`docs/sati-as-dsh-plugins-plan.md` §13.2 已把那些记录为对方窗口的未提交共享文件改动）。本改动未触及任何一项；专利 preset 不在任一失败清单。待 `self-evolve` 窗口落地后需重新验证，勿当作本映射的回归：

- `verify-cordis-config` —— 仅 `packages/bundle/web-app/cordis.patch.yml` 的 `@deepseek-ai/dsh-host-synapse` / `@deepseek-ai/dsh-client-synapse` 经 `tsconfig.base.json` paths 解析失败。
- `verify-config-catalog` —— 过期 `docs/config-catalog.md`（`dsh-host-synapse` / `dsh-client-synapse` / `dsh-self-evolve-eval` 新行）。
- `verify-doc-graphs` —— 过期 `docs/event-producer-consumer.md`（`synapse` / `self-evolve` / `self-evolve-basic` 行）。
- `verify-package-readme-model-experience` —— `packages/client/synapse`、`packages/test-support/self-evolve-eval`、`packages/web/synapse` 缺完整 model-context 条目。

本改动全部可归因检查通过（`tsc -b packages/patent/patent-workflow packages/patent/patent-teams`、两包测试、patent-workflow 覆盖率、翻译配对、`verify-export-jsdoc`、`verify-tool-catalog` 与 agent-note 门禁）。
