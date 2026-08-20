# Agent Note: terminal-bash 应答 PSReadLine 光标位置查询，使 pwsh 达到就绪

Status: implemented

[English](2026-08-20-terminal-bash-answers-pwsh-cpr.md) | 中文

## Problem

在真实的 pwsh shell 中，terminal-bash 下的 pwsh 会话始终无法达到就绪。每次渲染提示符前，PSReadLine 都会用转义序列 `ESC[6n` 向终端查询光标位置，并阻塞等待 `ESC[<row>;<col>R` 报告。terminal-bash 从不应答该查询，pwsh 因而卡在提示符渲染中途：已提交的命令排队却不执行，受控 `dsh> ` 提示符永远渲染不出来，每次 send 都以 `inferred_idle` 静默回退结束，而不是 `stdin_read`。bash 与 GNU readline 从不发出该查询，因此冻结对 bash 方言不可见。

上游 CI 从未暴露此失败：它在没有 pwsh 的自托管 runner 上运行同一批测试，pwsh 测试一直由 `hasPwsh` 门控而跳过。fork CI 运行在预装了 PowerShell 的标准 `ubuntu-latest` 镜像上，那些此前被跳过的测试真正执行了，从而暴露了冻结（`expected 'inferred_idle' to be 'stdin_read'`）。

第二个启动缺陷放大了冻结。pwsh 启动循环只要在保留文本中*任意位置*包含提示符字符串就 break；setup 命令回显中的 prompt 函数体内部就含有 `dsh> `，因此循环可能在 pwsh 仍冻结于光标位置查询时就 break。同一失效模式也使 `tool-pwsh-persistent` 的 loader-composition 测试失败——该测试的命令经由同一条启动路径发送。

## Decision

1. `LocalPtySession` 应答光标位置请求。一个滚动 32 位窗口扫描每个入站数据块，匹配 `ESC[6n`（`0x1b5b366e`）后写入标准报告 `ESC[1;1R`。窗口扫描对分块边界安全（跨回调拆分的查询仍能匹配），且对 bash 无效。失败的应答被吞掉：shell 只会像以前一样继续等待，传输失败路径负责最终清理。
2. pwsh 启动循环只有当受控提示符出现在保留文本**末尾**（`endsWith`）时才 break，而不是任意位置（`includes`）。只有位于文本末尾的提示符才是真正渲染出来的提示符；回显的子串不是。

## Alternatives considered

- **按定时器或静默上限应答。** 会与拆分块的查询竞争，并可能应答过期的查询。窗口扫描在观测到查询的当刻应答。
- **用猜测的行/列应答。** PSReadLine 只需要一个格式正确的报告即可继续；最小报告 `ESC[1;1R` 惰性且足以用于提示符布局。
- **在 fork CI 上跳过 pwsh 测试。** 会掩盖真实的产品缺陷，也与「优先正确地基而非兼容垫片」的预发布立场相悖。否决；这是产品级修复。

## Consequences

- pwsh 会话达到 `stdin_read` 就绪、执行命令、渲染受控 `dsh> ` 提示符。三个 fork-CI pwsh 失败——`terminal-bash/tests/local.spec.ts` 的两个与 `tool-pwsh-persistent` 的 loader-composition 测试——现在全部通过。
- loader-composition fixture 现在用 `realpath` 断言 cwd，使其能在 macOS 上回放——macOS 上临时目录经 `/var` → `/private/var` 符号链接访问。Linux 不受影响（那里 `realpath` 是恒等操作）。
- 用户在 pwsh 提示符下输入字面字节 `ESC[6n` 时会收到一次多余的报告，这无害。窗口使用固定常量，因为协议常量保持固定。
