# Agent Note: 按引用到的法律从随包清单加载法条基线

Status: implemented

[English](2026-10-28-legal-law-manifest-lazy-index.md) | 中文

## 问题

`legal_law_verify` 在读参数之前就解析了随包法条索引的全部 7,910 个文件：一次只引用《民法典》的首次调用耗时 13.2 s、RSS 增长 199 MB。空输入也要先付出同样的代价才返回输入错误（`no_input`），而且取消无法打断加载。

把加载改成按需之后，同一条路径上又暴露出第二笔开销。法条正则把已知的全部法律名与文件标题——7,910 个法律名加 485 个标题——写成一个 8,395 条分支的候选集。V8 在第二次执行时会把这么宽的正则编译成机器码，这 125 KB 模式的编译耗时 7.8 s，于是首次引用解析在全量加载消失之后仍然阻塞数秒。

## 决定

索引随包分发 `assets/legal-law/manifest.json`：每部法律一行 `[law, document, file]`，按法律名排序，由 `scripts/legal-knowledge-import/generate-law-manifest.ts` 从 YAML 文件生成。`generate-law-yaml.ts` 在写完 YAML 后重写清单，`assertLegalLawIndexReadable` 在插件加载时拒绝没有清单的目录，因此 `baselineDir` 覆盖不会先注册成功、到第一次引用才失败。

`createLegalLawIndex(baselineDir?)` 取代插件里的全量加载器：

- `loadNames(signal)` 读取一次清单（读取失败时下一次调用可重试），并把清单里的每个法律名与文件标题注册进引用解析器。
- `load(laws, signal)` 只解析被点名的法律，按索引实例缓存每部法的基线，同一部法的并发读取共用一次，并在文件的 `law` 或 `document` 与清单行不一致时拒绝该文件。

工具的顺序是：`citationInputProblem` → `loadNames` → 提取引用 → 加载引用点名的法律 → 核验。输入错误与 `unparsable_reference` 都在读取任何法律文件之前失败。`citationVerifyExecute` 把工具执行器的 `AbortSignal` 转发给领域的 `run`。清单与每部法的读取归索引所有，而非某个调用方，因此取消只结束该调用方的等待，与其他调用方共享的读取继续完成；`loadLegalLawBaselinesAsync` 的读取由本次调用独占，它把信号传给 `readFile`，读取会被打断。

解析器每 500 个法律名候选保留一个正则。`extractLegalLawReferences` 依次执行每个分片，再按起始位置走一遍匹配、跳过落在已消费跨度内的匹配，从而复现原来单个候选集从左到右的扫描。分片按名字长度降序排列，因此同一位置上的首个匹配就是该处最长的名字。

## 备选方案

**生成名字索引，而不是随包清单。** 读取 7,910 个文件的前两行正是本次要消除的开销，而生成的名字索引又会成为与文件并存的第二个产物。

**保留全量加载，只调整校验顺序。** 空输入会变好，但一次合法的一法引用仍要解析 7,910 个文件并保留 199 MB。

**在模块级 Map 里缓存已解析的基线。** `packages/AGENTS.md` 要求共享状态有归属者；索引实例就是归属者。一部法解析约 70 ms，按实例缓存已经能消掉一次核验会话实际重复支付的代价。

**保留单个法条正则并预热。** 预热只是把 7.8 s 的编译挪进 `loadNames`，而它仍在首次调用上。

**只匹配条号，再向前回查法律名。** 这样能彻底去掉候选集，运行时开销最小，但它要重新实现语法定义的法律名与条号边界。分片方案保留了原有语法及其测试；开发期两套实现对随包清单里的每个名字形式给出了完全相同的引用，`reference.spec.ts` 固定了跨分片的嵌套名字用例。

## 后果

用构建产物、20 个全新工具实例测量一次只引用一部法的首次 `legal_law_verify`：p50 93–95 ms，p95 100–102 ms，首次调用 91–93 ms，`heapUsed` 增长约 6 MB。issue 的 RSS 目标 20 MB **未达成**：首次调用让进程 RSS 增长 26–41 MB，因为单独解析 502 KB 的该法文件就让全新进程在 `yaml` 解析器内部增长 47 MB，而保留的堆只有 1.5 MB。要满足这个数字需要换条文格式或改用流式解析器，而不是改变“加载哪些法律”；全量加载的基线是 13.2 s、+199 MB。

空输入现在 0.3 ms 返回输入错误，且不读取清单；[tool.spec.ts](../../../../packages/legal/legal-law/tests/tool.spec.ts) 固定了不调用任何索引方法这一点。

代价：

- 没有 `manifest.json` 的 `baselineDir` 会在插件加载时失败。
- `LegalLawVerifyToolOptions.baselines` 接受已加载的 `Map` 或 `LegalLawIndex`；函数加载器形式已移除。
- 每次提取对文本按分片各扫描一遍——随包语料是 17 个分片。

## 测试

- `baseline.spec.ts` 覆盖清单解析及其拒绝分支、只学名字而不解析法律的清单索引、按法解析、缓存复用、未登记的法律、缺少清单、文件与清单行不一致、并发加载共用一次读取、读取之前与读取过程中的取消，以及一个调用方取消不影响另一个调用方的加载。
- `tool.spec.ts` 覆盖不可用输入与无法解析的引用不触碰索引、只加载被引用的法律，以及调用方信号到达索引。
- `plugin.spec.ts` 与 `verify.spec.ts` 通过真实插件组合跑清单索引。
