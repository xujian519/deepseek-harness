# Agent Note: patent-deadline 作为根域服务

Status: implemented

[English](2026-10-03-patent-deadline-service.md) | 中文

## Problem

挂在 profile 根域的插件——持有案件期限看板的专利工作台——需要为它保存的案件计算中国专利期限。这套规则只有一处实现，即 `@deepseek-ai/dsh-patent-deadline`：纯函数（`evaluateDeadlines`、`periodEnd`、`resolveDeliveryDate`、`WorkCalendar`）加面向模型的 `patent_deadlines` 工具。

消费者所在的位置够不到这个包。专利预设把它挂在 agent preset 的隔离域里，而隔离域的工具注册表是域内可见的，根域的同级插件找不到那个工具。该包未发布到 npm，工作台无法声明对它的依赖；而一个重新实现期间的消费者会变成期限的第二权威——正是整套集成要避免的事。因此求值器必须以**根域 Cordis 服务**的形式跨过插件边界。

相关：[工作台案件桥接](2026-09-03-workbench-case-bridge.zh.md) 记录同一集成的另一个方向（专利侧工具写工作台任务）。

## Decision

- `@deepseek-ai/dsh-patent-deadline` 新增两个可选 `Config` 字段：`provideService`（默认 `false`）与 `exposeTool`（默认 `true`）。`provideService` 打开时 `apply` 发布 `patentDeadline` 服务；`exposeTool` 关闭时跳过工具注册。默认值让预设那一行的行为与原先完全一致：只有工具，没有服务。
- 需要该服务的部署把**同一个包**在 profile 根域再注册一次，配置 `{ provideService: true, exposeTool: false }`。两行 loader 共用一个插件名但持不同 entry id，而只有重复的 entry id 才是致命错误——根域那行不新增面向模型的工具，预设那行把工具留在自己的隔离域内。
- `service.ts` 是对纯函数的直通：`evaluate(query, options?)`、`periodEnd`、`resolveDeliveryDate`、`describePatentKind`、`calendarCoverage()`。它不复述任何期间、送达或顺延规则；`evaluate` 要求调用方传入 `today`，因此报告可复现，且从不依赖宿主时钟。
- 日期以 `CalendarDate`（`{ year, month, day }`）跨边界——JSON 形状，消费者不必再解析一次日历。
- `calendarCoverage()` 返回所载节假日安排覆盖的年份。消费者据此说明某个届满日的年份未经核实，而不是呈现一个从未核验过的顺延。当前随包资产覆盖 2025–2026。
- 消费者用 `ctx.get('patentDeadline')` **软探测**，绝不写进 `inject`。服务缺失时明确降级为"期限引擎不可用——请手工录入期限"，绝不退回到第二份期限计算。

## Alternatives considered

- **新建一个只提供服务的包（`@deepseek-ai/dsh-patent-deadline-service`）。** 插件名唯一是最干净的语义，但[添加包](../../../../docs/cookbook/adding-a-package.zh.md)检查单（TypeScript aggregate reference、README 的 Model Experience 与 limitations 小节、locale 对及其翻译记录、逐文件 100% 覆盖率、工具目录重生成）的成本远超它带来的这条缝，而这个包装的 `apply` 只是转发到库、自身没有任何逻辑。否决。
- **把 `patent-deadline` 原样挂到 profile 根域。** 这会把 `patent_deadlines` 发布给所有会话，而不是只有专利模式的会话。`exposeTool` 开关的存在就是为了让工具保住既有作用域，同时让服务可达。
- **让消费者依赖这个包。** 它不在 npm 上，而在消费者旁边装一份会让期限规则出现两份实现、互相漂移。否决。
- **在工作台里重复期间，或在两套词表之间加翻译层。** 否决：工作台只把自身记录映射成引擎的入参形状，仅此而已；枚举（`PatentKind`、`NoticeKind`、`DeliveryMode`、案件六态）在边界两侧逐字相同。

## Consequences

- 只用工具的部署不受影响：不新增服务、行为不变，预设行的配置与原先一样。
- 需要该服务的部署为同一个包增加第二行 loader。两行读同一份随包日历资产，因此覆盖年份一致。
- 服务面是没有共享类型包的跨仓库契约。消费者在结构上镜像 `PatentDeadlineService` / `DeadlineQuery` / `DeadlineReport`，必须在引擎改变该形状时同步更新；以该包 README 为参照。
- `evaluate` 从不读宿主时钟：想要"今天"来算状态与剩余天数的调用方必须显式给定，这正是让落库报告的「计算基准日」有意义的原因。
- 消费者只落有日期的结果；引擎报为 `pending` 的期限（例如缺授权公告日）没有届满日，因此留在响应里，而不是用占位值占据一个真日期列。
