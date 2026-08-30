# Agent Note：下掉未接线的 browser-use PDF 下载通道

Status: implemented

[English](2026-08-30-patent-domain-breakpoint-cleanup.md) | 中文

## 问题

`patent-tools` 在包入口 re-export 了 `tool/patent-pdf-download-browser-use.ts` 的 `createBrowserUseDownloadRunner`，但没有任何生产代码消费它。它的全部引用只有公开 re-export、孤儿源文件，以及该文件自带的一个单测。下载接缝处的设计注释早已写明：统一 ego 运行模式后，下载路径只认 ego runner，browser-use 只参与探测矩阵而不参与下载。由于 ego runner 已实现同样的"提取 CDN 链接 → fetch 下载"回退，browser-use runner 的行为完全冗余——一个没有归属、没有当下需要的公开导出。

另，`analyze-patent-figure.ts` 里的 `resolveGateRoute` 文档写了"调用方活动模型优先，否则 Config 附图模型回退"的优先级，但唯一调用点把第一个参数传成了 `undefined`，调用方分支从未执行；门禁判定与发送路径恒从 Config 附图模型路由得出。签名、文档与接线三者不一致。

同一轮审计还发现三处较小的声明失配：注册 JSDoc 写 24 个工具而实际是 26；注册测试的期望集合是 23 个且用的是宽松的包含断言；两处文档把已发布专利预设指向了一个仓库中不存在的路径。

## 决策

- 整体下掉 browser-use 下载通道：删除包入口的 `createBrowserUseDownloadRunner` 导出，删除孤儿源文件 `tool/patent-pdf-download-browser-use.ts`，并删除其孤儿单测。`patent_pdf_download` 的 ego 路径不动。
- 重写 `resolveGateRoute` 的 JSDoc 以描述实际交付的状态（仅当 provider 与 model 都设置时调用方路由才生效；否则使用给定回退；空活动路由不算权威路由），并在唯一调用点注明：该工具只接入 Config 附图模型路由，因此门禁判定与发送路径恒共享该来源。签名及其单测不变——函数的两个分支是正确的，只有描述失实。
- 对齐三处机械失配：注册 JSDoc 计数（24 → 26）与工具清单一致；注册测试的期望集合补全为真实 26 项并收紧为精确（无视顺序）匹配，使缺失、多出或改名工具直接失败；两处把预设指向不存在路径的文档改为 `packages/preset/agent-presets/presets/patent/`。

## 已考虑的替代方案

**给 browser-use 通道接线。** 拒绝：接缝处的设计注释已承诺统一 ego 栈。接线会在 ego runner 已提供的"提取 CDN 链接 → fetch 下载"回退之外另开一条下载路径，并给一个没有消费者的导出新增消费者。下掉才是更小、且与设计一致的改动。

**保留该导出并把它标为公开。** 理由同上拒绝：一个没有归属或消费者的公开导出违反包规范"Require a current owner and need"；文档化它等于在没有需求的情况下授权它。

**保留 `resolveGateRoute` 的 JSDoc 让未来调用方来证明这个分支。** 拒绝：描述承诺的行为与当前接线相矛盾。把描述对齐到实际交付无需改代码，且移除了一个虚假契约；无行为或测试变化。

## 后果

移除 `createBrowserUseDownloadRunner` 从 `patent-tools` 移除一个公开符号；任何树外消费者需改用 ego 下载路径。`patent_pdf_download` 行为不变。注册测试现在会在任何工具集合漂移时失败（此前审计一直在放过这类漂移）；两处修正后的文档引用落到了真实目录，而非一个不存在的路径。
