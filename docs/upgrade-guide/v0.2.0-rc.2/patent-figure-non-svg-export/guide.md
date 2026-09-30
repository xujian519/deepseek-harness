---
kind: upgrade-guide
description: "generate_patent_figure 的 png/pdf 交付在给定 target_office 或图型只有 SVG 通路时改经 Inkscape 从 SVG 导出，产物为落版后的附图页，并要求本机装有 Inkscape。"
---

# png/pdf 附图改经 Inkscape 从 SVG 导出

English | [中文](guide.zh.md)

## Change

`generate_patent_figure` 的 `format: "png"` / `"pdf"` 此前只把 Graphviz 或渲染器的产物原样落盘：落版（`target_office`）、渲染复核与文字转路径都只对 `format: "svg"` 生效，非 SVG 时工具返回「落版仅支持 SVG 输出」的警告；矢量图型（`circuit`/`plot`/`cross_section`/`sequence_diagram`/`appearance_view`）对非 SVG 直接报错。

从下一版本起：

- 给 `target_office` 时，png/pdf 改走「渲染器出 SVG → 落版 → 渲染复核 → 文字转路径 → Inkscape（`--export-type=png|pdf --export-area-page`）导出」。交付物从原始画布变成落版后的附图页（中国为 A4 210×297 毫米），`layout` 字段随之返回，落版与复核的提示进入 `warnings`。`dpi` 传给 `--export-dpi`。
- 矢量图型导出 png/pdf 不再报错，同样走这条链；该链需要 Inkscape，缺 Inkscape 时该图型仍无产物可交，报 `setup_required`。
- 未给 `target_office` 的直绘图型（流程图/框图等）不受影响：仍由渲染器直接出 png/pdf，与升级前逐字节一致。
- 含中文的图形导出 pdf 需要 `Config.figureTextToPath: true`。Inkscape 1.4.4 在未转路径时对个别中文字形（本机实测「源」）会写出缺 `startxref` 的截断 PDF，退出码仍为 0；工具检出产物不完整后按导出失败处理——直绘图型退回渲染器直接出图并给出警告，矢量图型报错。

受影响的是对同一输入取得不同交付物、以及在没有 Inkscape 的主机上请求落版 png/pdf 的自动化。

## Migration

1. 确认本机装有 Inkscape 1.4：`inkscape --version`。缺它时 png/pdf 会退回渲染器直接出图（附明确警告），落版不生效；或改用 `format: "svg"`。
2. 需要交付含中文的 PDF 时，在 `cordis.yml` 的 `patent-tools` 配置里设 `figureTextToPath: true`，并确认 `inkscape --export-text-to-path` 可用。代价是该选项在缺 Inkscape 的主机上会让所有附图生成 fail loud。
3. 确认：以 `target_office: "cnipa"`、`format: "pdf"` 生成一图，检查返回的 `layout.office` 为 `cnipa`，且产物的页面尺寸为 210×297 毫米（`pdfinfo` 或等效工具）。
