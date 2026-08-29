# Agent Note: 聚合配置只引 face 配置，绝不引包根 solution

Status: implemented

[English](2026-08-29-aggregate-configs-seed-face-configs.md) | 中文

## 问题

better-sidebar 采纳为一方插件时，其包根 `tsconfig.json`——一个同时引用两个 face 配置的 solution——被加进了根 `tsconfig.host.json`。`tsc -b` 按引用的传递闭包构建，于是 host 面编译了插件的 client 面，并经由其引用连带编译了 api 的 client 面。在干净树上，api client 代码导入自身的 `./remote` 子路径，解析到由更晚的 host 打包阶段产出的 typert 生成物 `lib/typert.remote-client.d.ts`，因此所有 `ClientResult` 塌缩为 `unknown`，CI 的 typecheck 步骤失败。本地增量状态（既有 `lib/` 树）把失败完全掩盖：只有冷构建能复现。

## 决策

**仓库聚合配置（`tsconfig.host.json`、`tsconfig.client.json`）只引用 face 专属叶子配置。** 引用多个 face 的包根 solution 配置是编辑器与工具的便利物，绝不能进入构建图。每个聚合只编译一个 face；由于 host pass 恒先于 client 聚合运行，client 面解析所依赖的生成物（`lib/typert.remote-client.d.ts`、`lib/invariant.js`）届时必然已存在。

在生成目录中注册新的 client 服务时，同样的 face 纪律贯穿始终：服务需要子系统页面、doc-graph 角色分类、目录类型链接分类与完整的导出 JSDoc，任何生成器才会接受它；其 node 半区 lib 包必须在 Client pass 中构建，与共享 preset 的 face 契约完全一致。

## 后果

聚合每次调用只编译一个 face，冷 `typecheck` 由此变成两个 pass 而非先前看似的一个闭包；作为交换，每个 pass 都处于其可依赖的产物顺序之内。新的双面包若以包根配置进入聚合，会立即复现这一 CI 失败类别，而不是把半个 client 图静默编进 host 程序。

## 备选方案

**让构建容忍顺序缺口**（`/remote` 惰性解析，或先行构建 typert 产物）。否决：这会把 host 程序扩大到整个 client 图，使 host 构建受制于 client 面的良构性，client 的任何回归都会以看似无关的报错卡死 host pass。

**把包根 solution 配置限制为只引单一 face。** 否决：双 face solution 对编辑器工具确实有用；失败的原因是聚合引错了节点，而不是 solution 本身不该存在。


## 验证

删除全部 `lib/` 树后，带 face 引用修复的 `pnpm run typecheck` 通过，去掉修复则失败，且与 CI 报错签名（api client 面的 `TS2307`/`TS18046` 集群）完全一致。目录、图谱、配对、JSDoc 与 hygiene 门在分支上全部通过。
