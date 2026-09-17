# Agent Note: 附图工具共用子进程样板与输出 schema

Status: implemented

[English](2026-09-17-figure-tools-shared-bootplate.md) | 中文

## 问题

`generate_structure_figure`（FreeCAD/TechDraw）是按 `generate_patent_figure`（Graphviz）的结构孪生体写的：`figure/freecad-renderer.ts` 镜像 `figure/graphviz-renderer.ts`，`tool/generate-structure-figure.ts` 重复了 `tool/generate-patent-figure.ts` 与 `tool/analyze-patent-figure.ts` 中已有的组件与标号映射输出 schema。这些副本是语义性的而非装饰性的：两个渲染器必须用同一套方式归类同一种失败（内部超时优先于调用方取消，后者优先于信号终止，再优先于退出码），也必须对 spawn 宽限期达成一致；三个工具必须向模型描述同一套组件结构，否则一个工具产出的附图不再能被他者回读。四处克隆（渲染器文件之间三处、工具文件之间一处）让 master 上的 `pnpm run duplication`（jscpd）失败。

## 决策

共用样板移入两个模块，每个渲染器与工具只保留各自不同的部分：

- `figure/subprocess-render.ts` 负责收集流的 stdio 配置、版本探测（`spawnVersionProbe`，返回退出事实与合并后的 stdout/stderr 文本）、渲染截止期（`startRenderDeadline`：内部超时与调用方取消终止同一信号，`dispose()` 一并清理）、stderr 摘录（`renderStderr`）与失败原因措辞（`describeRenderFailure`）。`SPAWN_GRACE_MS` 是两个渲染器传给 spawn 的唯一宽限期。
- `tool/internal/figure-schemas.ts` 负责 `FIGURE_COMPONENT_KINDS`、`NUMERAL_MAP_SCHEMA` 与 `COMPONENT_SCHEMA`。`analyze_patent_figure` 转发导出它此前的组件类型词汇表，因此其导出面不变；`generate_patent_figure` 与 `generate_structure_figure` 导入两个 schema。

真正不同的部分仍留在各自文件内：候选可执行文件清单、安装引导、argv 与 cwd、FreeCAD 的 `HOME`/`XDG_*` 隔离环境与其 `manifest.json` 存在性判定、Graphviz 的产物文件校验与 DOT stdin 映射。

## 备选方案

**用 `jscpd:ignore` 块标记克隆对。** 拒绝：重复代码承载的是共用契约——同一失败原因顺序、同一组件结构——抑制检测器恰好会掩盖它本应捕获的漂移。

**把两个渲染器合并为一个按渲染器种类参数化的模块。** 拒绝：两者在 argv、stdin、产物、环境隔离与成功判定上都不同；合一个模块会带两套条件分支，而两个小模块各自读得清楚。

**保留复制的 schema，靠人工保持内容一致。** 拒绝：当某个工具的 `kind` 枚举改变而其余未变时不会有任何失败，而这正是副本容易造成的漂移。

## 后果

对探测、截止期或失败措辞的修改，现在对两个渲染器只需改一处；对组件或标号映射 schema 的修改，对三个附图工具也只需改一处。

共用渲染模块同时固定了渲染失败的措辞，因此需要不同原因顺序的渲染器必须显式说明，而不是在副本里各自分叉。

## 验证

`pnpm run duplication` 报告零克隆。`packages/patent/patent-tools` 的 610 个测试通过，包括钉住两个渲染器版本探测结果，以及超时、调用方取消、信号终止、非零退出与预中止信号这些渲染结果的测试套件。`pnpm run typecheck` 与 `pnpm run lint` 通过。
