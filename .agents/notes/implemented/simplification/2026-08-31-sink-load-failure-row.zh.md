# Agent Note: 将 Settings 加载失败行下沉到 dsh-client-ui-primitives

Status: implemented

[English](2026-08-31-sink-load-failure-row.md) | 中文

## Problem

两个 Settings 页签渲染着同一份加载失败行。`PluginMarketTab` 与 `PluginInventorySettingsTab` 各自保留了一段完全相同的五行 JSX——一段携带错误文本的 alert 段落加一个普通重试按钮——并且每个包的 CSS 模块中都有一份完全相同的 `.failure` 规则（flex 行、错误色、共享字号行高、按钮外观）。两个页签分属不同包，没有任何东西把这两份拷贝关联起来；零克隆的 `jscpd` 门禁把这对 JSX 标记为仓库中唯一的克隆，阻塞了 CI。

## Decision

由 `@deepseek-ai/dsh-client-ui-primitives` 持有唯一的 `LoadFailure` 组件：一个 `message`、一个 `retryLabel` 和一个 `onRetry` 回调。文案经 props 传入，因为该包不依赖 cordis，且客户端文案归语言字典所有；两个页签继续传递各自的字典键（`t('error')`、`t('retry')`）。共享的 `.failure` CSS 原样移入组件的 CSS 模块，两个页签删除各自的本地拷贝。组件测试钉住 alert 角色、本地化的重试标签与重试点击。

## Alternatives considered

**微调其中一个页签的标记，让检测器不再命中。** 拒绝：这只是用外观差异掩盖真实重复，还会让未来的页签继续照抄先出现的那个变体。

**提高重复阈值或豁免这一对文件。** 拒绝：零克隆预算是客户端表面"禁止拷贝"规则的机械化形式；长期豁免会让下一个贡献者习惯性无视该门禁。

**把整个 loading/error/ready 相位状态机并入原语。** 拒绝：今天只有失败行是共享的。两个页签在 loading 与 ready 形态上并不一致（一个是来源选择器加目录，一个是可过滤的条目列表），相位组件对每个分支都只有一个真实消费者，属于投机性表面。

## Consequences

`LoadFailure` 成为 `dsh-client-ui-primitives` 的新公开导出；其约定（三个 props、文案经 props 传入）与 `ConnectionBanner` 一致。失败行的外观此后只由一个 CSS 模块定义，令牌或布局的调整无需逐包修改即可到达每个消费者。页签行为不变：两个组件测试仍经由相同的角色与语言键通过"失败后重试"流程。
