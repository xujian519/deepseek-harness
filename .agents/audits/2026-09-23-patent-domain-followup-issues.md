# 专利域补扫描 — Issue 清单（2026-09-23）

- 来源：本轮专利域补扫描，覆盖 4 条独立扫描线（死码与未使用面、失败处理与边界安全、测试与验证缺口、声明契约与模型可见面）+ 逐条人工复核。
- 基线：`master` 分支（2026-09-23 补扫描当日），工作树除 `docs/TECH_DEBT.md` 外干净。
- 前序：`.agents/audits/2026-09-23-repo-scan.md`（同日的全仓扫描，#207–#230）、`.agents/audits/2026-09-23-issue-triage-and-execution-plan.md`。
- 关系：本文档只收录**不在 #207–#230 内**的新发现。同批的 15 条既有 issue 已逐条复核，全部在 HEAD 仍成立，无需重开或改写。
- 编号：当前最大 issue 编号 #230（最大 PR #206）；issue 与 PR 共享序列，故下列编号为**预估**，实际以创建时分配为准。
- 门禁基线：`pnpm run verify-no-unknown-casts` 通过（专利域 169 处 `as unknown` 已在基线内，非新增违规）；`pnpm run lint`、`pnpm run typecheck` 通过。
- 证据形式：全部结论附 `file:line`，且每条都由本轮复跑命令或代码原文核实（凡未核实者列入文末「未纳入」清单，不进正文）。

## 汇总

| 预估编号 | 标题 | Issue Type | Labels | 优先级 | 严重度 |
|---|---|---|---|---|---|
| #231 | `patent_pdf_download` 的 fetch 兜底路径无超时，且默认值文档与实际公式不符 | Bug | kind/bug-fix, area/patent | P1 | 高 |
| #232 | `add_patent_figure_references` 的 `output_filename` 未净化，可越界写文件 | Bug | kind/bug-fix, area/patent | P1 | 高 |
| #233 | `workbench_link_patent_case` 的 fetch 无超时无取消，`caseNumber` 未校验可越界读 | Bug | kind/bug-fix, area/patent | P2 | 中 |
| #234 | 模型可见文本丢弃已计算的 warnings（2 处），列举上限与工具描述矛盾（3 处） | Task | kind/cleanup, area/patent | P2 | 中 |
| #235 | TRIZ 空单元说明只对对角线成立，292/331 空单元被误报为物理矛盾 | Bug | kind/bug-fix, area/patent | P2 | 中 |
| #236 | wasm 渲染是同步不可抢占调用，模型可控 DOT 可占满事件循环 | Task | kind/techdebt, area/patent | P2 | 中 |
| #237 | `raw_dot` 直通绕过标签转义，模型可让 Graphviz 读取本地文件 | Task | kind/techdebt, area/patent | P2 | 中（提请定性） |
| #238 | 真实渲染链路在 CI 无信号，且 CJK 断言写死 macOS 字体 | Task | kind/techdebt, area/patent, area/tests | P2 | 中 |
| #239 | 71 条 checker 规则中 57 条在任何测试中从未出现 | Task | kind/techdebt, area/patent, area/tests | P2 | 中 |
| #240 | 死码与失效豁免批次（4 项：`rule_check` 缓存键、IPC 门槛常量、死 barrel、不可达 default） | Task | kind/cleanup, area/patent | P3 | 低-中 |
| #241 | `patent-knowledge` 节点缓存无上限，同族缓存均有 LRU | Task | kind/techdebt, area/patent | P3 | 低-中 |
| #242 | 验证缺口批次：4 个零断言用例 + 2 处模型可见渲染文本无断言 | Task | kind/techdebt, area/patent, area/tests | P3 | 低-中 |

---

### #231: `patent_pdf_download` 的 fetch 兜底路径无超时，且默认值文档与实际公式不符

````
P1 | 类型：Bug | 来源：2026-09-23 专利域补扫描（新发现 A1）

## Problem

`patent_pdf_download` 解析出 `timeoutMs` 之后只把它喂给 ego 通道；当 ego 通道不可用、
代码改走 HTTP 兜底时，兜底路径**没有任何期限**，只剩 `exec.signal` —— 而那是调用方取消
（用户中断整个回合），不是超时。结果是一条挂起的 CDN/TLS 连接可以无限期占住这个工具调用。

这不是「忘了传参」，而是接口没有出口：兜底路径的 options 类型里根本没有 `timeoutMs` 字段。

同一处还有第二个问题：输入 schema 描述的默认值与实现算出的默认值不同。描述写「默认 180000」，
实现是 `clamp(25s × 篇数, 60s, 180s)`，因此抓 1–2 篇时实际默认上限是 60000 而非 180000。
模型若按「默认 180000」估算自己的等待时间就会错。

## Evidence

```ts
// patent-pdf-download.ts:282 —— 兜底路径的选项类型没有 timeoutMs
function ...(…, options: { signal?: AbortSignal; fetchImpl?: typeof fetch; fetchRetry?: NetworkRetryOptions })

// patent-pdf-download.ts:531-537 —— 只传 signal
const res = await networkFetch(
  pdfUrl,
  { headers: { 'User-Agent': PATENT_DOWNLOAD_USER_AGENT, Accept: 'application/pdf' } },
  {
    /* v8 ignore next -- execute always passes exec.signal through. */
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    fetchImpl: fetchFn,
    retry: options.fetchRetry ?? DEFAULT_FETCH_FALLBACK_RETRY,
  },
)

// patent-pdf-download.ts:515 —— 工具自己解析出的 timeoutMs 只给了 ego 通道
          timeoutMs: timeoutMsValue,
          signal: exec.signal,
```

对照侧（自称对称，实际有期限）：

```ts
// tool-literature/src/tool/paper-download.ts:104-105
const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
// 与 patent_pdf_download 的 fetchPdfFallback 对称：PDF 魔数/最小字节/Content-Type 判定需跨工具一致。
```

默认值不一致：

```ts
// patent-pdf-download.ts:436 —— 声明
timeoutMs: { type: 'number', description: '整体执行超时（毫秒），默认 180000，上限 300000' },

// patent-pdf-download.ts:31-33, 478-480 —— 实现
const PER_PATENT_TIMEOUT_MS = 25_000
const MIN_DEFAULT_TIMEOUT_MS = 60_000
const MAX_DEFAULT_TIMEOUT_MS = 180_000
const timeoutMsValue =
  timeoutMs ??
  Math.min(MAX_DEFAULT_TIMEOUT_MS, Math.max(MIN_DEFAULT_TIMEOUT_MS, patents.length * PER_PATENT_TIMEOUT_MS))
```

兜底路径是生产路径：预置 persona 写明「ego 通道不可用时自动改走页面解析 + HTTP 下载」。

## Suggested fix

1. 给兜底路径的 options 加 `timeoutMs`，在 `networkFetch` 调用处并入期限信号
   （`AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])`，与 `paper-download.ts:104` 同形），
   并把超时映射为 `networkErrorCode = 'network_timeout'`。
2. 默认值二选一：把 schema 描述改成公式（「默认 clamp(25s × 篇数, 60s, 180s)」），
   或在输出里回显解析后的 `timeoutMs`，让模型看到实际生效值。
3. 与 #217（`tool-literature` 网络预算无 Config 出口）同族；若 #217 决定把网络预算提升为
   `Config` 字段，本项一并接线，不要造第二套默认值。

## 验收

- 新增用例：`fetchImpl` 永不 settle 时，调用在 `timeoutMs` 内以 `network_timeout` 失败。
- 该用例同时覆盖 ego 通道与兜底路径（注入 `fetchImpl` 走兜底）。
- 工具的 schema 描述与实现算出的默认值一致。
````

---

### #232: `add_patent_figure_references` 的 `output_filename` 未净化，可越界写文件

````
P1 | 类型：Bug | 来源：2026-09-23 专利域补扫描（新发现 B1）

## Problem

`add_patent_figure_references` 的 `output_filename` 是模型可控输入，代码把它直接拼进
`resolve(dir, ...)` 后写盘，**没有任何净化**。`output_filename: '../../evil'` 会把 `.svg`
写到源 SVG 所在目录之外（进程有写权限的任何位置），覆盖同名文件。

同目录的兄弟实现 `generate_patent_figure` 走了 `sanitizeDotFilename`，因此这是同一族工具内
的不对称，不是刻意的宽松设计。

## Evidence

```ts
// add-patent-figure-references.ts:83 —— schema 把 output_filename 暴露给模型
output_filename: { type: 'string', description: '输出文件名（不含扩展名，默认 <原名>_annotated）' },

// add-patent-figure-references.ts:125-128 —— 未净化
const dir = resolve(absPath, '..')
const base = args.output_filename ?? `${baseName(absPath)}_annotated`
const outPath = resolve(dir, `${base}.svg`)
await writeFile(outPath, result.svg, 'utf8')
```

对照侧（同一包，同一用途，已净化）：

```ts
// generate-patent-figure.ts:1510
outcomePath = join(outputDir, `${sanitizeDotFilename(filename)}.svg`)

// figure/graphviz-renderer.ts:161-164 —— 只保留 \w 与 -
export function sanitizeDotFilename(filename: string): string {
  const cleaned = filename.replace(/[^\w\-]/g, '_')
  return cleaned === '' ? 'diagram' : cleaned
}
```

实证（`node -e`）：

```
resolve('/tmp/work/figs', '../../evil.svg')  →  /tmp/evil.svg          （当前行为，越界）
resolve('/tmp/work/figs', 'evil.svg')        →  /tmp/work/figs/evil.svg
```

## Suggested fix

1. 用已导出的 `sanitizeDotFilename`（`graphviz-renderer.ts:161`）净化 `output_filename`，
   或在 `add-patent-figure-references.ts` 内复用 `SAFE_NAME_PATTERN` 一类的白名单校验。
2. 顺带对齐错误语义：文件名净化后为空时按 `invalid_tool_input` 拒绝，而不是静默改名。

## 验收

- 新增用例：`output_filename: '../../evil'` 只会在源 SVG 同目录内产出文件（断言落盘路径前缀）。
- 与 `generate_patent_figure` 的落盘路径断言同形，避免两处再次分叉。
````

---

### #233: `workbench_link_patent_case` 的 fetch 无超时无取消，`caseNumber` 未校验可越界读

````
P2 | 类型：Bug | 来源：2026-09-23 专利域补扫描（新发现 B2）

## Problem

两处边界缺失，同一个工具内：

1. **网络无期限、无取消**：默认实现用裸 `fetch`，既没有超时也没有 `signal`；而且
   `execute(args)` 的签名不收 `exec`，所以连 `exec.signal` 都拿不到。工作台端点不响应时，
   这个工具调用只能等到底层 socket 自己超时，模型取消也无法中断。
2. **`caseNumber` 未校验**：只检查非空，随后直接 `join(caseRoot, caseNumber)` 用于读
   `_matter-log.md`，同一路径又被当作 `workspacePath` 上报给工作台。`caseNumber: '../../x'`
   可以越界读取 `caseRoot` 之外的 `_matter-log.md`。

同包已有可复用的校验原语：`patent-core/src/persist-utils.ts` 的 `assertSafeId`；
`renderPatentDocument` 也用 `SAFE_NAME_PATTERN` 校验 `caseId`。

## Evidence

```ts
// workbench-link-patent-case.ts:174-181 —— 裸 fetch，无 timeout / 无 signal
const defaultFetchJson =
  async (url: string, init?: { method?: string; body?: string }): Promise<{ status: number; json: unknown }> => {
    const response = await fetch(url, {
      method: init?.method ?? 'GET',
      ...(init?.body === undefined ? {} : { body: init.body, headers: { 'content-type': 'application/json' } }),
    })
    return { status: response.status, json: await response.json().catch(() => undefined) }
  }

// workbench-link-patent-case.ts:232 —— execute 不接受 exec，没有取消来源
    async execute(args) {

// workbench-link-patent-case.ts:234-236, 244, 276, 284
      if (input.caseNumber.trim() === '') {
        throw new PatentToolError('invalid_tool_input', 'caseNumber 不能为空')
      }
      ...
      const caseDir = join(caseRoot, input.caseNumber)
      ...
            workspacePath: caseDir,
      ...
      const logContent = await readMatterLog(caseDir)
```

## Suggested fix

1. `execute(args, exec)` 接收 `exec`，把 `exec.signal` 透传进 `fetch`；
   用 `AbortSignal.timeout`（或 `networkFetch`）给每次请求一个期限，超时归入工具的
   `tool_timeout`/`network_timeout` 码。
2. 用现有 id 校验原语（`assertSafeId` 或 `SAFE_NAME_PATTERN`）校验 `caseNumber`，
   拒绝路径分隔符与 `..`，与 `patent-pdf-download.ts:181-203` 拒绝非法专利号的写法一致。

## 验收

- 新增用例：`caseNumber: '../../x'` 被拒（`invalid_tool_input`），不产生任何读盘。
- 新增用例：`fetchJson` 永不 settle 时，调用在期限内失败而不是挂起。
````

---

### #234: 模型可见文本丢弃已计算的 warnings（2 处），列举上限与工具描述矛盾（3 处）

````
P2 | 类型：Task | 来源：2026-09-23 专利域补扫描（新发现 A3/A4/A5/A6）

## Problem

模型只收到工具 `render` 产出的内容块；结构化 `value` 不进模型上下文。因此「计算了 warnings
但不渲染」等于模型看不到，而工具描述又承诺能看到。同批的还有 3 处「列举上限」与描述矛盾。

**warnings 计算了但不渲染（2 处）**

1. `patent_metadata`：工具描述与输出 schema 都承诺 `parseWarnings` 会 surfaced，渲染函数完全不输出它。
   页面结构变化导致的解析降级对模型不可见。
2. `patent_search`：`warnings` 在 schema 里是 required，渲染只输出 hits。family 去重提示
   （「N 篇公开/授权变体合并为 1 篇」）与 nuo 解析降级提示都到不了模型，模型无法判断
   自己看到的是合并后的结果。

**列举上限与描述矛盾（3 处，同一 schema 内自相矛盾）**

3. `search_patent_figure`：描述写「空串 = 按附图编号列出**全部**已分析附图」，同一 schema 的
   `limit` 字段写「最大 10」，实现 clamp 到 10。已被索引超过 10 张时，模型会以为自己看到了全集。
4. `patent_wiki_search`：同上（「列出**全部**卡片」vs 最大 10）。
5. `query_writing_patterns`：描述「with no argument at all the library is listed」，
   实际 catalog 模式套用 `matchLimit`（默认 5），而语料是 10 个模式文件。

## Evidence

```ts
// packages/core/agent-loop/src/tool-calls.ts:299 —— 模型收到的是渲染内容，不是结构化 value
  const message = createToolResultMessage({ callId: block.id, content: result.content, isError: result.isError })
```

```ts
// patent-metadata.ts:158 —— 承诺
  '  - Non-fatal parse warnings are surfaced in parseWarnings when the page structure changes',
// patent-metadata.ts:219 —— 且是 required
          parseWarnings: { type: 'array', required: true, items: WARNING_SCHEMA },
// patent-metadata.ts:163-180 renderMetadata —— 只输出 title/inventors/dates/legal/classifications/citations/pdf/abstract
```

```ts
// patent-search.ts:119 —— 承诺
  '  - A network failure is reported as an error; a genuine zero-result search returns empty hits with warnings',
// patent-search.ts:123-133 renderSearch —— 只渲染 value.hits 与 value.query
  return [`**patent_search** — ${value.hits.length} result(s) for "${value.query}"`, '', lines.join('\n\n---\n\n')].join('\n')
// patent-search.ts:106 —— 被丢弃的 warning 之一
    warnings.push(`family 去重：${base}* 的 ${count + 1} 篇公开/授权变体合并为 1 篇（保留 ${best?.patent}${date}）`)
```

```ts
// search-patent-figure.ts:244-245, 276
  query: { …, description: '检索关键词（技术特征/部件名/附图标记；空串 = 按附图编号列出全部已分析附图）' },
  limit: { type: 'number', description: '返回条数上限（默认 5，最大 10）' },
      const limit = Math.min(Math.max(args.limit ?? 5, 1), 10)
// patent-wiki-search.ts:114, 116, 137 —— 同形
// query-writing-patterns.ts:85 / :212 / src/index.ts:68（DEFAULT_MATCH_LIMIT = 5）/ assets/patterns 共 10 个文件
```

## Suggested fix

1. 在 `renderMetadata` 与 `renderSearch` 里追加 warnings 段（`draft-claims.ts:99` 已有
   `lines.push('', '## 警告', ...value.warnings.map(...))` 的渲染先例，照此对齐），
   或在描述里删掉「surfaced」的承诺。
2. 三处列举模式：把描述改为「按 `<limit>` 条列出」（`limit` 已声明最大值），
   或让列举模式不受 `limit` 约束并回显总数。
3. 注意：改动渲染文本即改动模型可见输出，按仓库规则须同步更新录制快照
   （`pnpm run test:snapshot -t patent`），并在 PR 说明里写清语义变化。

## 验收

- 渲染文本断言包含 warnings 行（family 去重 / parse 降级各一条）。
- `search_patent_figure` / `patent_wiki_search` 的描述与实际条数一致；
  `query_writing_patterns` 无参调用要么列出全部 10 条，要么描述不再声称「整个库」。
````

---

### #235: TRIZ 空单元说明只对对角线成立，292/331 空单元被误报为物理矛盾

````
P2 | 类型：Bug | 来源：2026-09-23 专利域补扫描（新发现 C3）

## Problem

`methodology` 的 TRIZ 工具对「查不到推荐原理」的返回文案是「A diagonal cell names a physical
contradiction (improving equals worsening)」，README 同样把空单元等同于物理矛盾。

但实测矩阵 39×39 = 1521 格中有 331 个空单元，其中只有 39 个在对角线上：

| 类别 | 数量 | 含义 |
|---|---|---|
| 对角空单元 | 39 | 改善即恶化，确为物理矛盾 |
| **非对角空单元** | **292** | 经典矩阵本就没有该组合的条目 |

因此 292/331 的空单元会被解释成错误的理由，并把模型推向「分离原理」方向，而实际情况是
该组合在经典矩阵里没有条目。这是会改变模型推理方向的错误信息。

## Evidence

实测（本轮脚本统计 `assets/triz-matrix.json`）：

```
39x39 = 1521 cells; empty=331; diagonal empty=39; off-diagonal empty=292; filled=1190
```

```ts
// methodology/src/tool/triz.ts:99 —— 把每个空查找都解释为物理矛盾
"Recommended principles: none. A diagonal cell names a physical contradiction (improving equals worsening)…"
// methodology/README.md:24, :80 —— 同一说法
```

## Suggested fix

1. 按 `improving === worsening` 分支文案：相等 → 物理矛盾（现状文案）；
   不等 → 「经典矩阵未收录该组合（非物理矛盾）」。
2. README 同步改写，明确「空单元有两类」。
3. 新增用例覆盖非对角空单元，断言返回的是「未收录」而非「物理矛盾」。

## 验收

- 非对角空单元与对角空单元的返回文案不同，且各自有断言。
- README 的两处描述与实际文案一致。
````

---

### #236: wasm 渲染是同步不可抢占调用，模型可控 DOT 可占满事件循环

````
P2 | 类型：Task | 来源：2026-09-23 专利域补扫描（新发现 B3）

## Problem

附图渲染的默认渲染器是内置 wasm（`figureRenderer` 默认 wasm），其渲染调用是**同步**的
`viz.renderString(...)`，运行在 Node 主线程上。代码只在调用前后各检查一次取消状态，
调用期间既无期限也无法被中断：`exec.signal` 对同步 WASM 无效。

对比之下，CLI 路径（系统 `dot` 子进程）有 60s 期限。因此默认路径比可选路径更脆弱：
模型提供的 DOT 若触发病态布局，可以长时间占满事件循环，期间该进程内其他工具调用、
流式输出与取消都无法推进。

## Evidence

```ts
// figure/viz-wasm-renderer.ts:76, 84, 88, 94 —— 只在前后检查取消，调用本身同步
    if (callerAborted()) return abortedOutcome()
    ...
    try {
      output = viz.renderString(spec.dot, { format: spec.format, engine: spec.engine })
    } catch (error) {
    ...
    if (callerAborted()) return abortedOutcome()
```

```ts
// figure/render-selector.ts:2, :33 —— wasm 是默认
 * 附图渲染器选择器（`figureRenderer: 'wasm' | 'cli'`，默认 wasm）。
 * @param mode - 配置的渲染器模式；undefined 视为 'wasm'（默认）。
// patent-tools/src/index.ts:265, :544 —— 配置项与选择点
  figureRenderer: z.union(['wasm', 'cli']),
  const renderDot = pickRenderer(config.figureRenderer, {
```

```ts
// figure/graphviz-renderer.ts:41, :218 —— CLI 路径有期限（对照）
const RENDER_TIMEOUT_MS = 60_000
  const deadline = startRenderDeadline(RENDER_TIMEOUT_MS, spec.signal)
```

## Suggested fix

三选一（按代价排序）：

1. 把 wasm 渲染放进 Worker，由 Worker 提供可终止边界与期限（与 `subprocess` 路径同等的语义）。
2. 模型可控/超大的 DOT 路由到 CLI 渲染器（已有期限），wasm 只服务内置模板。
3. 若维持现状，在渲染器模块文档与工具描述里登记「wasm 路径无期限、不可中断」这一事实，
   并说明为何可接受。

## 验收

- 选定方案后新增用例：一个病态/超大 DOT 在期限内返回失败（或按第 3 项在文档中登记事实）。
- 取消语义在两条渲染路径上一致（或明确记录差异及理由）。
````

---

### #237: `raw_dot` 直通绕过标签转义，模型可让 Graphviz 读取本地文件

````
P2 | 类型：Task | 来源：2026-09-23 专利域补扫描（新发现 B4，需维护者定性）

## Problem

`generate_patent_figure` 的 `figure_type: 'raw_dot'` 把模型提供的 `dot` 字符串原样交给
渲染器，只做 200 KB 字节上限。这是生成路径里**唯一**绕过 `escapeDotLabel` 的入口。

`escapeDotLabel` 的存在意义正是阻止标签内容越出为属性；而 Graphviz 自身会读取
`image=`、`shapefile=`、`fontpath` 等属性指向的本地文件，并把内容并入产物（产物会落盘到
工作区/附件）。因此模型作者可直接构造 DOT 读取宿主文件。

本条不含「已发生利用」的证据，只是边界事实：需要维护者裁定这是接受的设计（`raw_dot` 的
产品价值就是完整表达力）还是需要收紧。

## Evidence

```ts
// generate-patent-figure.ts:1089-1094 —— 只做体积上限后原样返回
    case 'raw_dot': {
      if (input.dot === undefined || input.dot.trim() === '') {
        throw new DotBuildError('empty_input', 'raw_dot 需要 dot 内容')
      }
      if (input.dot.length > RAW_DOT_MAX_BYTES) {
        throw new DotBuildError('invalid_template', `raw_dot 输入过大（>${RAW_DOT_MAX_BYTES} 字节）`)
      }
      return input.dot
    }
```

```ts
// figure/dot-builder.ts:354-359 —— 生成路径的转义（raw_dot 不经此处）。
// 第一处 replace 的字符类是控制字符 U+0000–U+0008、U+000B、U+000C、U+000E–U+001F；
// 源码把该类写作反斜杠 u 转义，此处改用 U+ 记法——GitHub 会把正文里的反斜杠 u 转义文本
// 解码成真正的控制字符并以 ^ 记法回显，正文无法保真（U+ 与反斜杠 x 记法不受影响）。
export function escapeDotLabel(text: string): string {
  return text
    .replace(/[<上述控制字符类>]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}
```

## Suggested fix

三选一：

1. **接受并登记**：在 `raw_dot` 的参数描述与包 README 里写明「调用方可表达任意 DOT 属性，
   包括文件读取类属性」，让它成为有意的能力而不是漏洞。
2. **收紧**：对 `raw_dot` 做属性白名单，剥离 `image`/`shapefile`/`fontpath` 等文件类属性，
   或限制在 `outputDir` 内的相对引用。
3. **改道**：`raw_dot` 渲染固定走 CLI 渲染器（子进程边界 + 期限），并在子进程工作目录上
   做限制。

## 验收

- 选定方案后：若收紧，新增用例断言含 `image="/etc/passwd"` 的 DOT 被拒或属性被剥离；
- 若接受，参数描述与 README 登记该能力及其边界。
````

---

### #238: 真实渲染链路在 CI 无信号，且 CJK 断言写死 macOS 字体

````
P2 | 类型：Task | 来源：2026-09-23 专利域补扫描（新发现 D1）

## Problem

两条真实渲染套件由 `describe.skipIf` 整体跳过，而 CI 上**必然**跳过：

- `.github/workflows/` 与 `.github/workflows-disabled/` 中 `graphviz` / `freecad` 安装零命中；
- `ci-fork.yml` 四个 job 的 runner 全是 `ubuntu-latest`；
- 因此「AST → SVG」与「STEP → TechDraw → 标注 SVG」这两条链路的唯一真实端到端覆盖，
  在 CI 里**没有任何信号**，跳过在日志里读起来是绿的。本机因存在
  `/opt/homebrew/bin/dot` 与 FreeCAD.app 才真的跑了。

第二处：CLI 套件把 CJK 字体写死为 `PingFang SC`，是 macOS 专属字体。即便在 CI 装上 `dot`，
这些断言仍会（正确地）失败，所以跳过同时掩盖了一个平台相关的断言。

（与 #208/#223 同族：都是「门禁看不见这条链路」。本项专指真实渲染路径。）

## Evidence

```ts
// patent-tools/tests/figure-graphviz-real-render.spec.ts:62 —— 5 个 CLI 用例整体跳过
describe.skipIf(!hasDot)('real Graphviz rendering (needs `dot` installed)', () => {
// patent-tools/tests/figure-graphviz-real-render.spec.ts:60 —— 字体写死
const CJK_FONT = 'PingFang SC'
// patent-tools/tests/figure-freecad-real-render.spec.ts:71 —— 2 个 FreeCAD 用例整体跳过
describe.skipIf(!hasFreeCad)('real FreeCAD structure rendering (needs `freecadcmd` installed)', () => {
```

```
$ rg -n "graphviz|freecad" .github/workflows/ .github/workflows-disabled/
（零命中）
$ rg -n "runs-on" .github/workflows/ci-fork.yml
19:    runs-on: ubuntu-latest   （其余三个 job 同）
```

## Suggested fix

两条路线，可分开也可并行：

1. **给链路信号**：在 CI 安装 graphviz（Linux 上廉价），让 CLI 套件真的跑；
   字体改为按平台选择，或断言渲染结构（形状/标号）而非字体族。
   FreeCAD 若不便安装，则在 spec 文件头登记「CI 无此二进制，该路径无 CI 信号」这一事实，
   并补一条「跳过数超过阈值即失败」的计数门，让静默跳过变成可见的红色。
2. **改为准快照**：把一次真实渲染的产物固化为 keyless fixture，回放断言，
   使该链路在任何平台都有信号（仓库既有录制回放机制）。

## 验收

- 选定路线后：CI 日志中该链路的跳过数下降或为 0，且断言与平台无关。
- 若选第 1 条并保留 FreeCAD 跳过，计数门在跳过数异常时确实失败。
````

---

### #239: 71 条 checker 规则中 57 条在任何测试中从未出现

````
P2 | 类型：Task | 来源：2026-09-23 专利域补扫描（新发现 D2）

## Problem

`patent-core/src/checker` 声明 71 条规则（core 47 + reasoning 24，总数由 `checker.spec.ts` 断言），
但只有 **14 条**规则 id 在专利域测试里出现过。整个规则族从未被任何用例触碰：

| 未覆盖族 | 条数 |
|---|---|
| `DESIGN-01..05` | 5 |
| `PRIORITY-01..05` | 5 |
| `PUBACC-01..05` | 5 |
| `SUBJECT-01..05` | 5 |
| `REASON-CREATIVITY-01..05` | 5 |
| `REASON-CLAIMS-02..05` | 4 |
| 其余单条（`CLAIM-CLARITY-SUPPORT`、`DISCLOSURE-SUFFICIENCY`、`INVENTIVENESS-*`、`INVALID-*`、`INFRINGEMENT-*`、`SPEC-*`、`REEXAM-*` 等） | 28 |

规则语料是本域的法律结论面：这些规则直接决定 `rule_check` 的输出与质量门判定。
当前总条数断言（71）是绿的，因此任一族的判据漂移都不会被拦住。

## Evidence

实测（本轮脚本：从 `checker/**` 提取 `id: '...'`，再与 `packages/patent/**/tests/**.ts` 的
标识符集合求交）：

```
declared rule ids: 71
mentioned in patent tests: 14
never mentioned: 57
未覆盖族统计：SUBJECT 5, REASON-CREATIVITY 5, PUBACC 5, PRIORITY 5, DESIGN 5, REASON-CLAIMS 4, …
```

总量断言（唯一保护）：

```
packages/patent/patent-core/tests/checker.spec.ts:420  → 71 = core 47 + reasoning 24
```

## Suggested fix

1. 按族补行为用例（正例 + 反例），至少覆盖 `DESIGN` / `PRIORITY` / `PUBACC` / `SUBJECT` /
   `REASON-CREATIVITY` / `REASON-CLAIMS` 六族；
2. 或改为数据驱动表：以规则 id 为键，断言每条规则的 `level` / `severity` / `message`，
   使「新增规则必须自带一条表项」成为结构性约束；
3. 若某些族确认不在 fork 的支持范围（例如外观设计路径不完整），在包 README 显式登记豁免与原因，
   不要用沉默代替判定。

## 验收

- 六族各自至少一条正例与一条反例，或数据驱动表中出现 71 个 id 的全部条目。
- 若保留豁免，README 中能指明每一条豁免的规则族与理由。
````

---

### #240: 死码与失效豁免批次（4 项：`rule_check` 缓存键、IPC 门槛常量、死 barrel、不可达 default）

````
P3 | 类型：Task | 来源：2026-09-23 专利域补扫描（新发现 C1/C2/C4/C5）

## Problem

四项各自独立、都是「代码/注释声称的行为不存在」，与已立的 #213（不可达候选 + 失效 v8 ignore）
和 #214（v8 ignore 理由与代码相反）属同一批治理对象。逐项如下。

**1. `rule_check` 的 pack 缓存键恒为 `null`，其模板分支由 `v8 ignore` 掩盖（中）**

`packCacheKey()` 调 `resolveRulePackManifestPath()` 时不传参，而该函数无参时恒返回 `null`，
所以 `manifestPath === null` 恒成立，后面的 `statSync` 分支永不可达 —— 却被 `v8 ignore` 包住，
使「有分支没覆盖」这件事在门禁里看不出来。`statSync` 全文件仅此一处使用。

**2. `MULTI_CLASSIFY_MIN_CONFIDENCE` 导出且文档承诺门槛，代码从不使用（低-中）**

常量 JSDoc 写「confidence ≥ 该值的部参与并行注入」，但 `classifyIpc` 对所有命中关键词的部
无条件产出，没有任何门槛过滤；该常量被两个 barrel 导出却零消费。

**3. `patent-workflow/src/workflow/index.ts` 是死 barrel（低）**

33 行，全仓无源码引用（`rg` 只命中 `lib/` 构建产物）。`src/workflow.ts` 已导出同样内容。

**4. `checker/engine.ts` 的 `default: return '未知'` 对闭合联合不可达，测试用 `as never` 覆盖它（低）**

`RuleLevel = 0 | 1 | 2` 三个成员都已处理，`default` 只可能被类型断言进来 ——
而一条测试正是为此构造了 `level: 5 as never`。仓库约定是闭合联合用共享 `assertNever` 收尾。

## Evidence

```ts
// 1. patent-tools/src/tool/rule-check.ts:117-126
  const packCacheKey = (): string | null => {
    const manifestPath = resolveRulePackManifestPath()
    /* v8 ignore start -- resolveRulePackManifestPath returns null without an explicit path … */
    if (manifestPath === null) return null
    try {
      return `${manifestPath}@${statSync(manifestPath).mtimeMs}`
    } catch {
      return null
    }
    /* v8 ignore stop */
  }
// patent-rule/src/runtime/rule-pack.ts:53-59 —— 无参必返 null
export function resolveRulePackManifestPath(explicitPath?: string): string | null {
  if (explicitPath) {
    const p = resolve(explicitPath)
    return existsSync(p) ? p : null
  }
  return null
}
```

```ts
// 2. patent-core/src/ipc/ipc-classifier.ts:22
/** 多重分类门槛：confidence >= 该值（与部级命中 ≥2 词等价：2 词=0.743，1 词=0.642）的部参与并行注入。 */
export const MULTI_CLASSIFY_MIN_CONFIDENCE = 0.7
// :724-746 classifyIpc —— 无门槛过滤，命中即 push
    const confidence = ipcConfidence(matched.length)
    ...
    results.push({ section: domain.section, confidence, … })
// 全仓消费点：仅 patent-core/src/index.ts:105 与 patent-knowledge/src/index.ts:87 的 barrel 重导出
```

```ts
// 3. packages/patent/patent-workflow/src/workflow/index.ts —— 33 行，无引用方
```

```ts
// 4. patent-core/src/checker/engine.ts:371-377
function levelLabel(level: RuleCheckResult['level']): string {
  switch (level) {
    case LevelMust:   return '必须'
    case LevelShould: return '应当'
    case LevelQuality:return '质量'
    default:          return '未知'
  }
}
// patent-core/src/checker/types.ts:29  →  export type RuleLevel = 0 | 1 | 2
// patent-core/tests/misc-coverage.spec.ts:391  →  level: 5 as never（专为覆盖 default）
```

## Suggested fix

1. 删除 `packCacheKey` 与 `v8 ignore` 块及 `statSync` import；`pack` 作用域的缓存键改为显式
   `null` 并就地注释理由；或给 `resolveRulePackManifestPath` 传显式路径使它真的可达。
2. `MULTI_CLASSIFY_MIN_CONFIDENCE`：要么在 `classifyIpc` 消费处真正应用门槛，
   要么删除常量与两处 barrel 导出并去掉 JSDoc 中不成立的门槛描述。
3. 删除 `patent-workflow/src/workflow/index.ts`（确认 `src/workflow.ts` 覆盖其全部导出）。
4. `levelLabel` 的 `default` 改为共享 `assertNever`，并删除 `misc-coverage.spec.ts:391` 的
   `level: 5 as never` 用例（该用例只为覆盖不可达行而存在）。

## 验收

- 四项各自删除或收敛后，`pnpm run duplication` 仍为 0，`vitest run packages/patent` 全绿。
- `pnpm run verify-no-unknown-casts` 不因删除 `as never` 而失败（基线允许只减不增）。
- `pnpm run lint` / `pnpm run typecheck` 通过。
````

---

### #241: `patent-knowledge` 节点缓存无上限，同族缓存均有 LRU

````
P3 | 类型：Task | 来源：2026-09-23 专利域补扫描（新发现 B5）

## Problem

`KgStore.nodeCache` 是无上限 `Map`，只在 `close()` 时清空。该 store 按插件生命周期单例存活
（`this.kg ??= new KgStore(...)`），因此一个长会话里查询过的不同节点 id 会一直累积。
其 JSDoc 自称「轻量节点缓存」，但实际规模只受查询过的 id 数量约束，而底层图是
217 MB / 116K 节点量级。

同一族的两处缓存都有上界，这一处没有：

| 位置 | 上界 |
|---|---|
| `patent-data/src/patent-cache.ts:25` | `maxEntries ?? 100` + TTL |
| `tool-literature/src/runtime/http.ts:145-149` | LRU 淘汰（写注释明确说明「防止无限增长」） |
| `patent-knowledge/src/shared/kg-store.ts:40` | **无** |

## Evidence

```ts
// patent-knowledge/src/shared/kg-store.ts:16 —— JSDoc 自称轻量并按需
 * 设计：**按需 SQL 查询 + 轻量节点缓存**，避免将 217MB / 116K 节点 …
// :37, :40
/** 知识图谱只读存储（双 schema 兼容，按需 SQL + 轻量节点缓存）。 */
  private readonly nodeCache = new Map<string, KgNode | undefined>()
// :97-103 —— 只写不淘汰
  getNode(id: string): KgNode | undefined {
    if (this.nodeCache.has(id)) return this.nodeCache.get(id)
    const row = this.stmtGetNode.get(id) as NodeRow | undefined
    const node = row ? toNode(row) : undefined
    this.nodeCache.set(id, node)
    return node
  }
// :283-287 —— 只在 close 清空
  close(): void {
    this.nodeCache.clear()
    this.db.close()
  }
```

对照（同族已有解，可直接复用）：

```ts
// patent-data/src/patent-cache.ts:24-25, :68
    this.maxEntries = options.maxEntries ?? 100
    while (this.map.size >= this.maxEntries) {   // LRU 淘汰
// tool-literature/src/runtime/http.ts:145
/** 缓存条目上限：超限按 LRU 淘汰最久未访问项，防止长时间运行（分页检索等）无限增长。 */
```

## Suggested fix

1. 给 `nodeCache` 加上界并沿用 LRU 语义（`patent-cache.ts` 的 `AsyncResultCache` 或
   `runtime/http.ts` 的 LRU 写法均可复用），上限做成构造参数并可经 `Config` 覆盖。
2. 若维护者认定「命中即热」且期望全量驻留，则在 JSDoc 里写明「无上限及其依据」
   （例如典型会话查询的 id 数量上界），并把结论落到包 README，而不是让注释与实现不一致。

## 验收

- 若加 LRU：新增用例断言超过上限后最久未访问项被淘汰，且 `getNode` 命中语义不变。
- 若登记为无上限：JSDoc 与 README 说明上界来源。
````

---

### #242: 验证缺口批次：4 个零断言用例 + 2 处模型可见渲染文本无断言

````
P3 | 类型：Task | 来源：2026-09-23 专利域补扫描（新发现 D3/D4）

## Problem

两类「看起来覆盖了、实际没有保护」的测试。

**1. `patent-teams/tests/scheduler.spec.ts` 有 4 个用例零 `expect`**

这四个用例的断言计数实测为 0，通常只 `await sleep(20)` 后结束。名字声称在验证
「租约等待期间团队消失/成员被移除时放弃票据」这类竞态结果，但没有任何可失败的观测。
任何一个提前 return 或静默继续都会让它们保持绿色。

**2. 两处模型可见渲染文本无断言**

模型只收到渲染文本，而以下渲染函数的输出在测试与快照中都不出现：

| 渲染函数 | 标记 | 现状 |
|---|---|---|
| `patent-analysis-report.ts:102` `renderReport` | `# 专利分析报告` / `## 质量评分` | 测试只断言 `value.*`；标记在测试中零命中，仅出现在 `snapshots/session/patent-oa-response/tool-schemas.expected.json`（那是 schema 描述，不是渲染断言） |
| `workbench-link-patent-case.ts:341` `renderLinkResult` | `workbench_link_patent_case:` | 测试只断言 `value.*`；标记在测试与快照中零命中 |

两处都属于「模型看到的那段文本可以静默变化」——章节丢失、列消失、文案改动都不会变红。

## Evidence

```
# 1. 逐 it() 块统计 expect 调用数
packages/patent/patent-teams/tests/scheduler.spec.ts
  line 266: it('gives up the ticket when the team vanishes while the dispatch lock waits', …)   → expect 0
  line 282: it('gives up the ticket when the member is removed while the dispatch lock waits', …) → expect 0
  line 438: it('resolves the workspace from the process cwd when the member has none', …)        → expect 0
  line 456: it('gives up the status write when the team vanishes while the lock waits', …)       → expect 0
```

```
# 2. 渲染标记的断言搜索
$ rg -c "专利分析报告|质量评分" packages/patent/patent-tools/tests/*.ts      → 零命中
$ rg -l "专利分析报告" snapshots/                                            → 仅 tool-schemas.expected.json（schema 描述）
$ rg -c "workbench_link_patent_case:" packages/patent/patent-tools/tests/*.ts → 零命中
```

## Suggested fix

1. 四个用例补上可失败的观测（团队/任务状态未变、未派发、cwd 回退确实以解析出的路径被调用）；
   其中 `:438` 依赖 runner 的 cwd，建议改为注入 cwd 的 seam，去掉对环境目录的依赖。
2. 为 `renderReport` 与 `renderLinkResult` 补渲染断言（章节、IPC 行、评分行含来源标注、
   失败路径文案），或把 `patent_analysis_report` / `workbench_link_patent_case` 纳入一条录制会话快照。

## 验收

- 四个用例各自在「实现被改坏」时确实失败（可临时注错验证一次）。
- 两处渲染文本有断言；若走快照路线，则 `pnpm run test:snapshot -t patent` 覆盖对应工具。
````

---

## 如何提交

编号为预估，创建时以实际分配为准。建议先建标签对应的 Issue Type（Bug / Task），再批量提交。

每条正文位于 `### #<编号>` 标题之后、包在 4 个反引号的围栏内（围栏本身不是正文）。
逐条取正文并提交：

```sh
# 取单条正文（把 231 换成目标编号）
python3 - 231 > /tmp/issue-231.md <<'PY'
import re, sys, pathlib
fence = '`' * 4
doc = pathlib.Path('.agents/audits/2026-09-23-patent-domain-followup-issues.md').read_text()
n = sys.argv[1]
m = re.search(rf'^### #{n}:.*?\n{fence}\n(.*?)\n{fence}', doc, re.M | re.S)
assert m, f'issue {n} not found'
print(m.group(1))
PY

# 提交（标题取 `### #231: ` 之后的文本）
gh issue create --title "<标题>" --body-file /tmp/issue-231.md \
  --label kind/bug-fix --label area/patent
```

正文已含 `P? | 类型 | 来源` 首行与 `## Problem` / `## Evidence` / `## Suggested fix` / `## 验收` 四段，
可直接粘贴，无需改写。标签与类型的对应见汇总表：

| 类型 | Labels | 编号 |
|---|---|---|
| Bug | kind/bug-fix, area/patent | #231 #232 #233 #235 |
| Task | kind/cleanup, area/patent | #234 #240 |
| Task | kind/techdebt, area/patent | #236 #237 #241 |
| Task | kind/techdebt, area/patent, area/tests | #238 #239 #242 |

**与既有 issue 的关系**：`#231` 与 #217 同族（网络预算），建议同一批处理并在两条 issue 内互相引用；
`#234` 与 #217 的「描述默认值 vs 实际默认值」同属一类契约缺陷；`#240` 与 #213 / #214
同属「死码 + 失效豁免」治理；`#238` 与 #208 / #223 同属「门禁看不见某条链路」。
`#232` / `#233` / `#237` 涉及模型输入到文件系统与网络的边界，建议优先于 P3 项处理。

## 未纳入本文档的项（未独立复核，不进正文）

以下来自扫描线但本轮**未亲自核实**，不作为 issue 提交；若处理，请先自行确认：

1. `patent-kg-query` 的 `Case/SupremeCourtJudgment/…` 枚举与 `patent-knowledge` 的 `KgNodeType`
   存在成员分叉（`Judgment` / `LawArticle` / `PersonalNote` 等只在其中一侧）。模型若传
   未被别名覆盖的成员会静默得到近零命中。
2. `patent-deadlines` 对「重复的非重复类通知书」抛出 `DeadlineQueryError`，却被上层映射为
   `contradictory_priority_inputs`，错误码与成因不符。
3. `patent-document/src/document/errors.ts` 的 JSDoc 声称工具层会把 `DocumentRenderError`
   映射为 `invalid_tool_input`，实际该映射不存在（全包无 `PatentToolError`）。
4. `patent-knowledge/src/bin.ts`（`patent-knowledge-install`）无任何层级的测试。
5. 约 18 处测试依赖真实时钟（`setTimeout` + `Date.now()` 差值断言 / 毫秒级 sleep），
   属 `docs/testing.md` 判定的「单独通过、并发下可能误失败」形态。
6. `patent-tools` 侧 41 个只在本模块内使用的 `export` 与 28 个同类常量、194 个无外部消费的
   `export type`（`export` 面过宽，按仓库「只发布独立消费者需要的东西」可收紧）。
7. `patent-teams` 的 `./invariant` 子路径已发布、已构建、已被测试导入，但没有任何**外部**
   消费者按子路径名导入它（与 `patent-workflow` 的用法不同）。

## 验收

- 本文档为分析产出，代码零改动（工作树除本轮报告与 `docs/TECH_DEBT.md` 外无变化）。
- 每条正文的证据块均由本轮命令输出或代码原文核实；`file:line` 对应 2026-09-23 的 `master` 分支。
