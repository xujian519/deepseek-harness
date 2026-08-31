# 采纳上游 deepseek-ai/deepseek-harness 更新（0.1.1-rc.2 → 0.1.2-alpha.1）

## 结论：建议采纳，走 fork 既有惯例——`sync/upstream-v0.1.2-alpha.1` merge PR

本仓库（xujian519 fork）上次同步停在 `b150a551b8`（0.1.1-rc.2，8月21日），上游 master 已到 `cd5ef81481`（0.1.2-alpha.1，8月27日）：**一周 1,079 个提交、5,000+ 文件、21 个贡献者**。建议现在合并而非等待，理由：

1. **fork 政策已记录"上游不收 PR"**（`docs/fork-policy-upstream-no-prs` 合并记录），fork 的 patent 纵向只能靠定期 merge 跟进；历史上每个上游 tag 后都有 sync PR（#20 跟 rc.1、#29 跟 rc.2），本次是同一惯例的延续。
2. 增量含**安全修复**（PTC Mode SDK 可绕过 `run_code` 限制）和 fork 正在使用的启动模式收敛（Python SDK/ACP 统一走 `dsh profile`）；漂移越久合并成本越高。

## 上游更新了什么（来自 0.1.2-alpha.1 release notes + 上游提交）

- **Web UI/客户端大改版**：首屏与会话加载性能、slash/`@` 菜单与引用卡片打磨、问题卡草稿跨会话持久、turn 过程自动折叠、逐 turn token 用量、turn 导航、流式期间保留语法高亮、CJK/Latin 间距、内容宽度可调、字号设置、本地化补全、第三方 UI 语言注册。
- **多模态**：图片发送即时回显、图片 token 计入 compaction、Trajectory 视图图片附件、超长图片压缩修复。
- **持久终端修复**：macOS/Linux PowerShell 启动误检、Linux 管道读被误判为输入等待、Bash 大量子进程导致 host 卡死、Web UI 持久 Bash 卡片无法展开。
- **Agent presets**：boot 丢失 profile 配置的 preset roots（修复）、不可解析 preset 提前报错并说明拒绝原因、`/goal` 移出 Minimal preset。
- **基建**：**ApiProxy 传输删除**，Remote gateway 接管；网络访问改 one-time-token 认证；Windows x64 Python runtime；pi-ai 升 0.84.2；DeepSeek adapter 默认上报插件名/版本（可关）；opt-in 增量 session-log 上传（默认关）；headless 运行进度走 stderr、stdout 只留最终答案。
- **文档词汇**：code-mode → PTC 的改名扫尾（提交 `3ca9c7d489` 等）。

**vendor 面**：上游 vendor/README.md 与 fork 基线完全一致（cordis 仍 pin `4.0.0-rc.7`/`56b3d4f`，18 条本地修改），**本次 merge 无 vendor 冲突**；`nuo-patent` 是 fork 独有 vendor，保留。此前分析的 cordiverse/cordis rc.8 六个 core 修复**上游也未采纳**，作为独立后续项，不进本 PR。

## 冲突热点（fork 侧 200 commits/1,587 files ∩ 上游热区）

| 区域 | fork 侧动了什么 | 上游侧动了什么 | 决议方向 |
|---|---|---|---|
| `packages/host/apiproxy` | src/api/*、src/fetch/*、tests | **整包删除** | delete/modify 冲突：接受删除；消费面（`bundle/web-app`、`todo/tool-todo`、`test-support/client-runtime`、`client/connection`）多数上游已迁到 Remote gateway，取上游侧；fork-only 消费者初查为零（patent/memory/self-evolve 无依赖，执行时复核） |
| `packages/client/connection`、`packages/api/remotes` | fixture.ts、两个 host 测试、remote-events.ts | transport 契约重构（connection 自持 RPC transport） | 以上游架构为准，手工移植 fork 增量 |
| `packages/terminal/terminal-bash` | session.ts + tests | 持久终端三处修复（大概率同文件） | 逐 hunk 融合，上游修复为准 + fork 增量保留 |
| `packages/core/system-prompt` | index.ts、prompt-cache | 系统提示词段落顺序调整（shell 指导前置） | fork 的 patent 段落在上游新顺序里重排 |
| `packages/client` UI + `apps/web` | patent-teams 聊天卡片、synapse 修复（93+58 files） | UI 大改版 | **最大冲突区**；以上游新 UI 为宿主重新挂载 patent 卡片 |
| `.agents/notes`(228)、`docs/subsystems`、README | fork 文档 | ptc 词汇扫尾 | 机械跟随上游词汇（"Code mode"→"PTC mode"） |
| `python/sdk-runtime`、`session-persistence` | package.json、coordinator-contract.ts | Windows x64 runtime、持久化改进 | 小面积逐个解 |

fork 独有区（`packages/patent` 524 files、`vendor/nuo-patent`、onboarding rebrand）上游无对应改动，干净合入。

## 实施步骤

1. **准备**：`git fetch upstream`；从 `upstream/master` 取 `cd5ef81481` 完整 SHA；从 master 拉 `sync/upstream-v0.1.2-alpha.1` 分支。
2. **冲突预盘点**：`git merge-tree`（或试合并）产出精确冲突清单，对照 fork 侧 `git diff --name-only b150a551b8..master` 逐文件标注"取上游/取 fork/手工融合"；若 client/web UI 冲突面积超预期，回来重议拆批策略（先基建后 UI）再继续。
3. **逐区解决**：按上表顺序——vendor（预期零冲突）→ patent 独有区 → apiproxy 删除迁移 → connection/api → terminal-bash → system-prompt → client/web UI → notes/docs 的 ptc 词汇。
4. **构建**：解 pnpm-lock 冲突后 `pnpm install`，`pnpm run build && pnpm run typecheck`。
5. **测试**：`pnpm run test`（重点：client、connection、terminal-bash、system-prompt、boot/app-boot、patent 全套）→ `pnpm run test:snapshot`（keyless 回放）→ `pnpm run doc-sync && pnpm run hygiene && pnpm run duplication`。
6. **收尾**：PR 描述记录 apiproxy→Remote gateway 的 fork 侧迁移决议；fork 独有行为受上游重构影响的（如 patent 事件卡片在新 UI 的挂载点）补 Agent Note。

## 验证与交付

- 单个 merge PR 合入 fork master，不 push upstream。推送前按 dsh-pre-push-checks 选最小检查面。
- snapshot 若有 legit 漂移（上游 UI/输出变化所致），`test:snapshot:record` 需 DEEPSEEK_API_KEY，届时向你索取。
- 回退：全程在独立分支，master 不受影响，任何阶段可弃。

计划模式限制说明：沙箱拦截了 `git fetch`/`gh api`，上游精确冲突清单在执行阶段第 2 步产出；本计划中的热点判断已基于 fork 侧本地 diff + 上游 release notes + 关键文件抓取交叉验证。