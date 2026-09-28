# Agent Note: 经可选 Inkscape 步骤导出不依赖字体的附图

Status: implemented

[English](2026-09-28-inkscape-text-to-path-figure-export.md) | 中文

## 问题

生成的附图 SVG 不声明 `font-family`，其中的 `<text>` 由阅读器手头的字体渲染。在没有中文字体的机器上（印厂、审查端阅读器、同事的笔记本），标号会变成豆腐块或字宽错位——而这份文件的全部意义就是被读。两条绘图通路都有这个问题：直绘 SVG 与 Graphviz DOT。守护图面质量的渲染复核之所以要用逐字宽度比例估算文字外框，也是同一个原因：量测时并不知道真实字体。

## 决策

`generate_patent_figure` 增加一个可选导出步骤，由 `Config.figureTextToPath` 开关（默认关）。开启时宿主向工具注入 `outlineText` 端口（与 DOT 的 `render` 端口同一注入形状），每个完成的 SVG 都经系统 Inkscape 执行 `--export-type=svg --export-plain-svg --export-text-to-path`，字形因此换成轮廓路径。由此确定的事实：

- **排在最后。** 在落版（`applySubmissionPage` 会改写坐标）之后、索引落库之前；其后没有任何步骤解析该文件。
- **只对 SVG 生效。** png/pdf 由渲染器自己出字（`Config.dotFont`），故工具以警告明示「本参数不生效」，而不是静默忽略。
- **缺失即报错。** 未挂载 subprocess 服务、或 Inkscape 路径缺失/无效 ⇒ `not_installed` → `setup_required` 并附安装引导；转换产物里仍有 `<text>` ⇒ `render_failed`。开关的承诺是字体无关，悄悄交出文字版不是一个选项。
- **产物先校验再原地替换。** 临时产物过本通路统一的 `assertSafeSvg` 安全校验，写回原路径，临时目录删除。
- **复用共用样板。** `figure/inkscape-renderer.ts` 调用 `figure/subprocess-render.ts` 的 `findExecutable`、`spawnRenderProcess` 与 `describeRenderThrow`，因此可执行文件探测、spawn 宽限期、截止期与失败归类与 Graphviz、FreeCAD 走的是同一套（[共用子进程样板](../simplification/2026-09-17-figure-tools-shared-bootplate.zh.md)）。

## 备选方案

**在进程内用真实字体量测文字（`opentype.js`/`fontkit`）而不转路径。** 导出侧拒绝：精确字宽能让落位与复核模型都更准，但文件仍然要求阅读器拥有那款字体。若某个部署想收紧模型，这些库仍是可选路径。

**把字体嵌入 SVG。** 拒绝：每个附图文件都要带一份字体程序，中文字体子集依然很大，而且等于替用户决定字体授权。

**改为栅格化输出。** 拒绝：专利附图是必须保持矢量的线条图（300 dpi 是下限而非目标），位图还会丢弃渲染复核实测的几何。

**无条件转路径，不给配置开关。** 拒绝：没有 Inkscape 的部署也必须能生成附图；而由绘图员在矢量编辑器里收尾时，带 `<text>` 的文件更好用。

**Inkscape 缺失时仅警告并保留文字。** 拒绝：这会让自己承诺的字体无关落空，而且在产物里看不出来。

## 后果

开启导出的附图不再依赖任何字体：绘图员看到的即印厂渲染的。代价是部署要装一个外部 GPL 二进制（约 645 MB）、每图约 0.4 秒、文件大约大十倍（轮廓路径代替 `<text>`），并且文字不再可搜索、不可就地编辑。

这类文件里渲染复核已没有文字可量：字形轮廓按普通路径量测，其曲线段按设计报「未量测」。因此贯穿检查在生成时、转路径之前、在文字版上完成；事后单独跑 `verify_patent_figure` 仍能量测线条、剖面线与画布边界。

## 验证

`packages/patent/patent-tools` 的 956 个测试通过。其中包括渲染器自身的假子进程测试套件（安装引导、精确 argv、产物仍含 `<text>` 时拒绝、安全校验、调用方取消、spawn 抛错、产物不可写），以及一套真实子进程端到端测试——没有 Inkscape 时整组跳过，CI 不装 Inkscape，故 CI 上这条链路「无信号」，与 FreeCAD 投影那套记录的处境相同。

真实链路还手工跑过一次 CNIPA 落版 A4 页：产物无 `<text>`，`width="210mm" height="297mm" viewBox="0 0 210 297"` 与全部 `stroke-width` 逐值保持，栅格化结果与文字版观感一致。`pnpm run duplication`、`pnpm run typecheck`、`pnpm run lint` 与文档门禁均通过。
