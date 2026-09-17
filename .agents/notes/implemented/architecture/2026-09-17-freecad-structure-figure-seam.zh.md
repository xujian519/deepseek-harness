# Agent Note: FreeCAD 结构线稿接缝与 TechDraw 投影决策

Status: implemented

[English](2026-09-17-freecad-structure-figure-seam.md) | 中文

## Problem

`generate_patent_figure` 画的是 Graphviz 图：流程图、框图、部件层级图。它画不出几何已经以 CAD 模型（STEP/IGES/BREP）存在的机械结构。把这种附图伪装成框图会丢掉《专利审查指南》第一部分第一章 4.3 下结构线稿的意义，而手工重画模型已经携带的几何则复制了真相。宿主可能装有 FreeCAD；harness 在其缺失时绝不能静默降级，且重量级 CAD 依赖绝不能渗进默认工具面。

## Decision

在 `@deepseek-ai/dsh-patent-tools` 内交付独立工具 `generate_structure_figure`，与 `generate_patent_figure` 平行，经宿主 `freecadcmd`（FreeCAD 1.1，TechDraw）把 CAD 模型投影为黑白多视图 SVG。下面每条决策都先在 macOS 上对 FreeCAD 1.1.3 做过实机验证再落笔。

**能力接缝。**服务定义是渲染结果契约 `StructureRenderOutcome`（`{ ok: true, manifestPath }` 或 `{ ok: false, code: 'not_installed' | 'render_failed' | 'aborted', error }`），刻意与 `GraphvizRenderOutcome` 同形，让工具层用同一套结果映射代码处理两个渲染器。Provider 是 `src/figure/freecad-renderer.ts`（路径发现、probe、子进程 spawn）；Consumer 是 `src/tool/generate-structure-figure.ts`，只依赖注入的 `render` 函数，自身绝不触碰 `ctx.subprocess`。Python 脚本是纯函数（`src/figure/freecad-structure-script.ts` 的 `buildStructureScript`），脚本构建可在无 FreeCAD 环境下单测；渲染器把脚本写入输出目录后 spawn `freecadcmd <script.py>`。脚本以内嵌源码而非随包 asset 交付，因为包的 `files` 只 ship `lib/index.js` 加类型声明。

**CAD 隔离、默认关闭、fail-loud。**工具由 `Config.structureFigureEnabled` 门禁（默认 `false`）。门禁未开启、`subprocess` 服务缺失或 `freecadcmd` 缺失都在执行期以 `setup_required` 加安装引导报错——绝不回退成示意图。子进程的 HOME/XDG/临时目录重定向到输出目录内的 `.freecad-home` 子目录以圈住副作用。

**Page + 最小模板，每视图一个 `DrawViewPart`。**TechDraw 只投影归属于带模板 `DrawPage` 的视图，故脚本自带一个最小空白 SVG 模板（一个不可见页面矩形）并把 `doc.FileName` 设进输出目录——TechDraw 会把模板拷到文档文件旁边，无文件名的内存文档会把该拷贝解析到 `/` 而失败。每个请求视图是单个带显式 `Direction`/`XDirection` 的 `TechDraw::DrawViewPart`；`DrawProjGroup.addProjection(str)` 在 1.1.3 抛 `TypeError: wrong type`，弃用。旧 `Drawing` 工作台在 FreeCAD 1.1 已移除，不用。

**输出取 `viewPartAsSvg` 原始片段，而非渲染整页。**`TechDraw.viewPartAsSvg(view)` 返回纯 `<g fill="none" stroke="#000000">` 几何片段，不含模板边框、标题栏或图号——正是 4.3 的要求——故脚本把片段包成独立 `<svg viewBox=…>` 而不导出页面。片段坐标帧 y 向上（数学约定）而 SVG 画布 y 向下，故片段置于 `<g transform="scale(1,-1)">` 内。

**件号在 Python 侧经 `projectPoint` 锚定。**`DrawViewPart.projectPoint(App.Vector)` 与片段共享同一坐标帧（实测：两者都产出形如 `M -10 2.5` 的坐标），故脚本把每个件号的 3D 点投影、减去帧中心、翻转 y，在那里画引线与数字。在 Python 侧锚定让件号落在真实投影顶点上；在 TypeScript 侧做则要在外部重新推导 TechDraw 的投影。帧中心 C 是**紧致投影几何包围盒**的中心，经离散化每条边（`discretize(Number=32)`）逐点投影取样求得：TechDraw 按投影后的几何居中片段，旋转视图（iso）下 C *不是*模型 AABB 中心的投影——用 AABB 投影会可见地放错件号。

**成功判定只看退出码加 manifest 存在。**`freecadcmd` 对 `~/Library/Preferences/FreeCAD` 与缓存写失败仅告警、非致命（STEP 载入/投影/导出均成功），且 macOS 下这些路径不随重定向的 HOME 迁移——已知无害局限。反过来，`freecadcmd` 吞掉未捕获的 Python 异常并以退出码 0 结束，故脚本包裹 `main()`，失败时 `traceback.print_exc()` + `sys.exit(1)`；没有这层包裹，失败的投影会看起来像成功。因此 stderr 文本绝不作为失败依据，只摘引进错误消息。

**工具层复用附图不变量。**输出 SVG 经与 Graphviz 路径同一的 `assertSafeSvg` 门禁，件号名称/标号经 `figureWordingWarnings`，每张图以 `analysis.figureType='structure'`、`modelUsed='freecad-structure'` 持久化进 `figureIndexStore`。`model_path` 为目录时按排序渲染每个受支持模型、图号递增，各自渲染进独立的 `fig{N}/` 子目录，批内 manifest/脚本/模板/home 文件互不冲突。

## Alternatives considered

- **给 `generate_patent_figure` 扩一个 `structure` 附图类型。**拒绝：两边输入 schema 几乎无交集（面向 DOT 的 steps/nodes vs 模型路径/视图/件号），门禁不同（CAD 默认关闭 vs 恒开），一个工具带两个不相交模式会拖累双方描述。两个工具让各自 schema 诚实。
- **用 `DrawProjGroup.addProjection`** 生成标准视图组。拒绝：在 FreeCAD 1.1.3 抛 `TypeError: wrong type`（实机验证）；带显式朝向的单个 `DrawViewPart` 稳定。
- **把渲染后的 `DrawPage` 导出为 SVG**（会带上模板）。拒绝：整页导出携带模板几何与页面装饰；专利附图像素内既不能有边框也不能有图号。
- **把 Python 脚本作为包 asset 交付。**拒绝：`files` 只 ship `lib/index.js` 加类型；asset 需要打包与运行期路径解析。返回源码文本的纯构建函数无 FreeCAD 也可测，且不动打包。
- **以 stderr 干净与否判定成功。**拒绝：FreeCAD 在健康运行里也会输出 `system.cfg`/transcoder 告警；把它们当致命会让某些宿主上每次渲染都失败。
- **引线几何（与 `src/figure/leader-line.ts` 同批交付）：以节点 bbox 中位尺寸推导图面 scale。**实现期拒绝，改为以各节点组**实读 `font-size`** 的中位数相对基线 10 推导：几何常量（间隙、边距、文本行高）本就是按字号调校的，统一字宽模型已逐组实读 font-size，而 bbox 中位数会把标签长度混进图面 scale。

## Consequences

- 新增 Config 面：`freecadExecutable`、`structureFigureEnabled`、`structureFigureScale`、`structureFigureViews`；发现顺序与 Graphviz 同构（覆盖值 → `DSH_FREECAD_CMD` → 平台候选路径 → `PATH`）。
- `index.ts` 带一处 TypeScript 解析器缺陷的绕行：返回对象字面量的 `async` 箭头直接作三元分支、且整条赋值给以索引访问类型（`GenerateStructureFigureDeps['render']`）标注的 const 时会误解析（TS1359）；该分支被提升为具名常量 `structureNoSubprocess`。
- 工具数断言（`registration.spec.ts`、双语 README）从 27 → 28。
- Python 脚本内的件号放置自洽（简单外向偏移），不共享 TypeScript 引线的碰撞原语。TS/Python 放置数学的统一推迟到 Python 侧放置出现第二个消费者时再做。

## Testing

- `tests/figure-freecad-structure-script.spec.ts` —— 对构建出的脚本做纯函数断言（API 使用、视图表、payload 往返），无需 FreeCAD。
- `tests/figure-freecad-renderer.spec.ts` —— mock `SubprocessRuntime`：发现顺序、probe、退出码分类、env 隔离、超时、取消。
- `tests/structure-figure-tool.spec.ts` —— mock render：门禁、单模型/批量、图面用语告警、safe-SVG 门禁、索引持久化及其降级路径。
- `tests/figure-freecad-real-render.spec.ts` —— `describe.skipIf(!hasFreeCad)` 真实端到端，跑签入的 `tests/fixtures/structure-bracket.step`（由签入的 `generate-structure-fixture.py` 生成；一条恒开测试断言 fixture 的 ISO-10303-21 头部签名与该生成器一致）：iso+front 投影含 `<path>`、仅黑描边、无边框/图号，且两个件号锚点都落在各自视图 bbox 内。

## Related

- [Capability seams](2026-06-13-capability-seams.zh.md) —— 本 note 沿用的接缝词汇（service definition / provider / consumer）。
- `src/figure/graphviz-renderer.ts` —— `freecad-renderer.ts` 镜像的契约（发现、probe、结果形状、SIGTERM→SIGKILL 宽限）。
