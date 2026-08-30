# Agent Note: 审计后续批次——基准 id 品牌化与如实的覆盖率豁免

Status: implemented

[English](2026-08-30-audit-followup-branded-benchmark-ids.md) | 中文

## Problem

2026-08-30 全量扫描报告中有四项排序在前的发现在首批清理中未落地。`dsh-self-evolve-benchmark` 的 `BenchmarkId` 与 `CaseId` 文档声称是不透明标识符，却声明为裸 `string` 别名，同时 store、scoreboard、engine 函数对同样的值接受无类型字符串。vitest 覆盖率排除清单中的 `packages/host/webserver/src/*` 挂在 TODO(gui) 浏览器级 harness 债务伞下，而 webserver 是 host 侧 Node 代码且自有测试套件通过——这是全清单唯一理由不自洽的条目。`sandbox-windows-acl` runner 规格中环境可写逃逸回归测试在 `C:\Users\Public` 探针目录无法创建时静默自跳过，而覆盖它的 job 本身不阻塞，CI runner 镜像一变，安全回归测试就可能无声消失。app-boot user-patches HMR 测试在本机满载时失败，断言消息里没有任何支撑负载假设的证据。

## Decision

- `BenchmarkId` 与 `CaseId` 现已品牌化（`src/brand.ts`，沿用 `dsh-llm` brand 模块模式），store、scoreboard、engine 与 provider 签名全部携带品牌类型。store 在目录项变为 id 的位置铸造 `CaseId`。这些 id 是磁盘持久状态与所有 seam 请求的键，品牌从第一个消费方出现之前就随之流动。
- webserver 排除条目保留在清单中，但移出 TODO(gui) 集群，换上自己的 TODO(cov) 理由。对覆盖门禁做的逐包探针实测：index.ts 88%、injections.ts 93%、invariant.ts 94%——没有文件够格摘除，因此条目现在写明真正未覆盖的内容（请求失败与 WebSocket 升级错误分支）。
- 逃逸回归的 skip 现在大声告警：CI 上输出 `::warning::` 行，GitHub 将其渲染为 run 注解；本地是普通的 stderr 警告。无需改动 workflow。
- user-patches 的 `eventually` 助手在超时错误中报告已等待毫秒数与负载均值，负载吃满的 runner 与真实回归在失败信息本身即可区分。在该诊断产出证据之前，偶发不登记为负载敏感。

## Consequences

在包内把基准 id 传给期望 case id 的位置现在是编译错误；从目录名铸造的 id 以品牌形态流经 scoreboard 路径与 seam 请求。运行时行为不变（品牌是擦除的强制转换）。覆盖率排除清单不再为 host 侧 Node 代码引用 GUI harness 理由，webserver 条目记录其真实缺口。CI runner 上的安全测试静默跳过现在会以注解形式浮现在 run 上。HMR 超时失败自带负载证据，两次偶发报告中的猜测到此为止。

## Alternatives considered

**只改 JSDoc 措辞、不做品牌化。** 否决：JSDoc 才是诚实的部分——这些 id 跨越持久文件系统边界与 execute/evaluate/propose/apply seam 请求；缺陷是裸 `string` 声明，不是"不透明"这个说法。

**现在补齐 webserver 缺失的分支测试。** 推迟：它本身就是一次聚焦的覆盖率 PR；在此之前条目保留，但归属于真实缺口，而非不适用的债务伞。

**在 workflow 里 grep 日志来发现被跳过的安全测试。** 否决：`::warning::` 行无需解析日志即成为 run 注解，且信号就放在知晓跳过原因的代码旁边。
