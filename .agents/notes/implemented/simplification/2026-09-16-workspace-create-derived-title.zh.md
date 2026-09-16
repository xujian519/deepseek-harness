# Agent Note: 创建工作区时标题由目录派生

Status: implemented

[English](2026-09-16-workspace-create-derived-title.md) | 中文

## 问题

`WorkspaceRegistry.create(path, title?)` 接受一个显示标题并写入新记录。网关的按名称创建分支被删除后（[「添加工作区只有一条路」决策](../../archived/simplification/2026-07-31-one-route-to-add-a-workspace.md)移除了那条路径），它最后的正式调用方就消失了，只剩下本包自己的测试还会传入标题——而它们传标题是为了观察幂等复用规则，并非因为标题属于「由目录创建项目」这件事本身。

该参数是通往同一字段的第二条、只能写一次的路径，而该字段已由 `Workspace.setTitle` 拥有，于是项目叫什么取决于恰好是哪个调用方创建了它。把历史会话分组的引导路径从不使用它，而是从目录派生每条记录的标题；代码中有一处 TODO 提议删除该参数。

## 决策

`create(path)` 只接受目录。`createCanonical` 写入 `defaultWorkspaceTitle(canonical)`：新记录的标题是路径的最后一段，该段为空时取根路径拼写。`Workspace.setTitle` 仍是唯一的重命名路径。

所有消费方随签名一起更新：本包测试、其 README 对、`docs/subsystems/workspace` 对，以及由源码生成的 Cordis 目录。

## 考虑过的替代方案

**把该参数保留为有文档的测试钩子。** 否决：只有测试使用的参数，是每个消费方都要继续承担的接口面；而用到它的那些测试，改为用目录命名即可得到同样的断言——幂等复用仍返回既有实体，末段相同的两条路径仍共享同一显示标题。

**在提供路径的网关侧派生标题。** 否决：网关除了路径之外没有可据以派生的标题，且派生应当发生在写记录的地方——也就是引导路径本就派生它的那个位置。

**让标题不可变，连同 `Workspace.setTitle` 一并删除。** 否决：重命名是已交付的能力，有自己持久化的写入与自己的测试；只有创建时的那条通道是冗余的。

**保留 `title?`，仅在路径没有末段时生效。** 否决：没有调用方想要这种优先级，保留它等于把本次要消除的歧义留着。

## 结果

项目在创建时的标题只有一个来源——目录，因此两个调用方创建同一个目录时，不再可能对它的名字产生分歧。

确实想要命名的调用方要写两次：`create(path)` 再 `setTitle(name)`。这是一条标题通道的代价，而第二次写在重命名已有项目时本来就需要。

该接缝仍不校验小写化与根路径拼写：`defaultWorkspaceTitle` 直接取规范路径末段的内容，需要特定拼写的调用方必须重命名。

## 测试

`packages/workspace/workspace/tests/workspace.spec.ts` 钉住派生标题、幂等复用时标题不变、两条规范路径共享同一显示标题，以及同路径并发创建收敛为一个实体。`pnpm run verify-cordis-catalog` 从源码重新推导生成的签名块，因此文档中的 `create(path)` 无法与已交付的签名漂移。

## 相关

- [添加工作区只有一条路](../../archived/simplification/2026-07-31-one-route-to-add-a-workspace.md)——正是那次移除让 `title` 失去了正式调用方。
- [工作区注册项删除](../feature/2026-07-27-workspace-registration-deletion.zh.md)——继续拥有目录及其会话的移除路径。
