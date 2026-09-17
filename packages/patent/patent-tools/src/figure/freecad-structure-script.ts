/**
 * FreeCAD TechDraw 结构线稿脚本构建器（纯函数，无 IO）。
 *
 * `buildStructureScript` 把一次结构视图投影请求渲染成一段自包含的 Python
 * 源码；调用方（freecad-renderer）把源码写入 outputDir 内的临时 .py 再
 * `freecadcmd <script.py>` 执行。脚本只依赖本机 FreeCAD 1.1 实测存在的 API：
 * `Part.read`、`TechDraw::DrawViewPart`（Source/Direction/XDirection/Scale/
 * HardHidden…）、`TechDraw.viewPartAsSvg`、`DrawViewPart.projectPoint`。
 *
 * 为什么把脚本作为源码内嵌而非随包 asset：patent-tools 的 `files` 只 ship
 * `lib/index.js` + 类型声明，额外的 `.py` 资产需要打包与路径解析；纯函数返回
 * 源码把「构建脚本」与「执行脚本」彻底分离，前者可在无 FreeCAD 的环境下单测。
 *
 * 坐标系（本机实测）：`viewPartAsSvg` 输出的 `<g>` 片段、`getVisibleVertexes`
 * 与 `projectPoint` 三者共享同一「投影视图」坐标帧（y 向上，数学约定），而
 * 独立 SVG 画布 y 向下。脚本以 `projectPoint(shape.BoundBox.Center)` 之外的
 * 「密集投影几何包围盒中心」C 把坐标归到片段帧（TechDraw 按投影后的紧致几何
 * 居中，旋转视图下 C ≠ AABB 中心投影），再把片段整体 `scale(1,-1)` 翻正、
 * 件号锚点取 `projectPoint(p) - C` 并翻转 y，保证件号落在真实顶点投影上、
 * 且图面朝上。片段不含模板边框/标题栏/图号，天然满足《专利审查指南》4.3。
 *
 * @module @deepseek-ai/dsh-patent-tools/figure/freecad-structure-script
 */

/** 支持的标准投影视图（顺序无关；每个视图映射一组 TechDraw Direction/XDirection）。 */
export const STRUCTURE_VIEWS = ['iso', 'front', 'rear', 'top', 'bottom', 'left', 'right'] as const

/** 结构视图名。 */
export type StructureViewName = (typeof STRUCTURE_VIEWS)[number]

/** 缺省视图集（等轴测 + 三视图常用组合）。 */
export const DEFAULT_STRUCTURE_VIEWS: readonly StructureViewName[] = ['iso', 'front', 'top', 'right']

/**
 * 件号锚定：把一个参考标号绑定到模型 3D 坐标，脚本投影到每个视图的真实 2D 位置。
 * point3d 落在实体表面/顶点上时，件号即锚定到该几何在各视图的投影。
 */
export type StructureCallout = {
  /** 参考标号（阿拉伯数字字符串；非数字由工具层 figureWordingWarnings 告警）。 */
  numeral: string
  /** 锚定的模型 3D 坐标（毫米，与 STEP/IGES/BREP 单位一致）。 */
  point3d: readonly [number, number, number]
  /** 可选部件名称（写入 manifest 件号表供检索，不进图面像素）。 */
  label?: string | undefined
}

/** buildStructureScript 的输入（全部由渲染器/工具层解析为绝对值后传入）。 */
export type StructureScriptParams = {
  /** 模型文件绝对路径（STEP/IGES/BREP，由 Part.read 载入）。 */
  modelPath: string
  /** 请求视图（顺序即输出与 manifest 顺序）。 */
  views: readonly StructureViewName[]
  /** TechDraw 投影比例（写入 DrawViewPart.Scale；不改变片段坐标，仅记录于 manifest）。 */
  scale: number
  /** 是否绘制隐藏线（HardHidden/IsoHidden/SmoothHidden/SeamHidden 四个布尔）。 */
  showHidden: boolean
  /** 件号锚定（可为空）。 */
  callouts: readonly StructureCallout[]
  /** 图号（决定输出文件名 fig{N}_{view}.svg 与 manifest）。 */
  figureNumber: number
  /** 输出目录绝对路径（脚本在此写 SVG/manifest/临时模板）。 */
  outputDir: string
}

/** 单个视图的 [Direction(x,y,z), XDirection(x,y,z)] 朝向对。 */
type StructureViewDirection = readonly [readonly [number, number, number], readonly [number, number, number]]

/** 视图名 → [Direction(x,y,z), XDirection(x,y,z)]（与 Direction 正交，本机实测稳定）。 */
export const STRUCTURE_VIEW_DIRECTIONS: Readonly<Record<StructureViewName, StructureViewDirection>> = {
  front: [[0, -1, 0], [1, 0, 0]],
  rear: [[0, 1, 0], [-1, 0, 0]],
  top: [[0, 0, 1], [1, 0, 0]],
  bottom: [[0, 0, -1], [1, 0, 0]],
  right: [[1, 0, 0], [0, 0, -1]],
  left: [[-1, 0, 0], [0, 0, 1]],
  iso: [[1, -1, 1], [1, 0, 1]],
}

/**
 * 输出 SVG 文件名（fig{N}_{view}.svg；Python 与 TS 共享同一约定，manifest 为准）。
 * @param figureNumber - 图号。
 * @param view - 视图名。
 * @returns 该视图的 SVG 文件名。
 */
export function structureSvgFilename(figureNumber: number, view: StructureViewName): string {
  return `fig${figureNumber}_${view}.svg`
}

/** manifest.json 文件名（脚本写入 outputDir，渲染器读回作为产物契约）。 */
export const STRUCTURE_MANIFEST_FILENAME = 'manifest.json'

/** 脚本内嵌的最小空白 TechDraw 模板文件名（写入 outputDir；不依赖 FreeCAD 自带模板路径）。 */
export const STRUCTURE_TEMPLATE_FILENAME = '.freecad-structure-template.svg'

/** 件号字高（用户单位/毫米；与片段几何同帧，随 scale 一并缩放到画布尺寸）。 */
export const STRUCTURE_NUMERAL_FONT_SIZE = 6

/** 引线长度（件号相对锚点的外向偏移，用户单位/毫米）。 */
export const STRUCTURE_LEADER_OFFSET = 10

/** 画布内边距（片段包围盒外扩，容纳引线件号与描边，用户单位/毫米）。 */
export const STRUCTURE_CANVAS_PADDING = 6

/** 引线/件号描边宽度（片段几何沿用 TechDraw 的 0.7，引线略细以区分）。 */
export const STRUCTURE_STROKE_WIDTH = 0.5

/** 密集投影采样点/边（用于求紧致投影包围盒中心 C；覆盖圆弧极值）。 */
export const STRUCTURE_EDGE_SAMPLES = 32

/** 脚本 payload（经双重 JSON 序列化内嵌，规避路径/标号的转义问题）。 */
type ScriptPayload = {
  modelPath: string
  views: readonly StructureViewName[]
  directions: Record<string, StructureViewDirection>
  scale: number
  showHidden: boolean
  callouts: readonly { numeral: string; point3d: readonly number[]; label: string }[]
  figureNumber: number
  outputDir: string
  svgFilenames: Record<string, string>
  manifestFilename: string
  templateFilename: string
  numeralFontSize: number
  leaderOffset: number
  canvasPadding: number
  strokeWidth: number
  edgeSamples: number
}

/**
 * 构建 FreeCAD 结构线稿投影脚本源码。
 *
 * 纯函数：相同入参恒返回相同 Python 文本，不做任何 IO、不接触 FreeCAD。
 * 脚本执行后在 outputDir 写出每视图一个 `fig{N}_{view}.svg`（黑描边、无边框/
 * 标题栏/图号，件号以引线锚定到真实顶点投影）与一个 `manifest.json`
 * （视图名/顺序/件号表/每视图投影锚点/包围盒）。
 * @param params - 已解析为绝对路径与数值 defaults 的投影请求。
 * @returns 可交给 `freecadcmd` 执行的 Python 源码。
 */
export function buildStructureScript(params: StructureScriptParams): string {
  const payload: ScriptPayload = {
    modelPath: params.modelPath,
    views: params.views,
    directions: Object.fromEntries(
      params.views.map((view): [string, StructureViewDirection] => {
        const [direction, xDirection] = STRUCTURE_VIEW_DIRECTIONS[view]
        return [view, [direction, xDirection]]
      }),
    ),
    scale: params.scale,
    showHidden: params.showHidden,
    callouts: params.callouts.map(callout => ({
      numeral: callout.numeral,
      point3d: [...callout.point3d],
      label: callout.label ?? '',
    })),
    figureNumber: params.figureNumber,
    outputDir: params.outputDir,
    svgFilenames: Object.fromEntries(params.views.map(view => [view, structureSvgFilename(params.figureNumber, view)])),
    manifestFilename: STRUCTURE_MANIFEST_FILENAME,
    templateFilename: STRUCTURE_TEMPLATE_FILENAME,
    numeralFontSize: STRUCTURE_NUMERAL_FONT_SIZE,
    leaderOffset: STRUCTURE_LEADER_OFFSET,
    canvasPadding: STRUCTURE_CANVAS_PADDING,
    strokeWidth: STRUCTURE_STROKE_WIDTH,
    edgeSamples: STRUCTURE_EDGE_SAMPLES,
  }
  // 双重序列化：内层是脚本要 json.loads 的对象文本，外层把它转成一个 Python
  // 双引号字符串字面量（JSON 与 Python 的 \" \\ \n \uXXXX 转义规则一致）。
  const payloadLiteral = JSON.stringify(JSON.stringify(payload))
  return PYTHON_TEMPLATE.replace('__PAYLOAD_LITERAL__', payloadLiteral)
}

/**
 * Python 脚本模板（`__PAYLOAD_LITERAL__` 处内嵌参数）。
 *
 * 只使用本机 FreeCAD 1.1.3 实测存在的 API；`DrawProjGroup.addProjection` 在
 * 1.1.3 抛 TypeError，故每个视图独立建 `DrawViewPart` 并显式设 Direction/
 * XDirection。投影只有当视图归属一个带模板的 DrawPage 时才执行，脚本自带一个
 * 最小空白模板（不套 TechDraw 自带模板，输出片段因此不含边框/标题栏/图号）。
 */
const PYTHON_TEMPLATE = String.raw`import json
import math
import os
import sys
import traceback

import FreeCAD as App
import Part
import TechDraw

PARAMS = json.loads(__PAYLOAD_LITERAL__)

MODEL_PATH = PARAMS["modelPath"]
VIEWS = PARAMS["views"]
DIRECTIONS = PARAMS["directions"]
SCALE = float(PARAMS["scale"])
SHOW_HIDDEN = bool(PARAMS["showHidden"])
CALLOUTS = PARAMS["callouts"]
FIGURE_NUMBER = int(PARAMS["figureNumber"])
OUTPUT_DIR = PARAMS["outputDir"]
SVG_FILENAMES = PARAMS["svgFilenames"]
MANIFEST_FILENAME = PARAMS["manifestFilename"]
TEMPLATE_FILENAME = PARAMS["templateFilename"]
NUMERAL_FONT_SIZE = float(PARAMS["numeralFontSize"])
LEADER_OFFSET = float(PARAMS["leaderOffset"])
CANVAS_PADDING = float(PARAMS["canvasPadding"])
STROKE_WIDTH = float(PARAMS["strokeWidth"])
EDGE_SAMPLES = int(PARAMS["edgeSamples"])

# 最小空白 TechDraw 模板：DrawPage 需要一个模板才会执行视图投影；本方案只取
# viewPartAsSvg 的几何片段、不套模板边框，故模板内容仅需一个页面矩形。
MINIMAL_TEMPLATE = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" '
    'viewBox="0 0 297 210">'
    '<rect x="0" y="0" width="297" height="210" fill="none" stroke="none"/>'
    '</svg>'
)


def fmt(value):
    """坐标格式化：去尾零，保留三位小数。"""
    return ("%.3f" % value).rstrip("0").rstrip(".")


def escape_text(value):
    """XML 文本转义（件号/名称仅出现在文本节点）。"""
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def projected_bbox_center(view, shape):
    """
    求投影视图的紧致几何包围盒与其中心 C。

    离散化每条边后逐点 projectPoint：TechDraw 按投影后的紧致几何居中片段，
    旋转视图（如 iso）下该中心不等于模型 AABB 中心的投影，故必须实测取样。
    返回 (C, (x_min, x_max, y_min, y_max))，均在 projectPoint 的原始帧（y 向上）。
    """
    xs = []
    ys = []
    for edge in shape.Edges:
        for point in edge.discretize(Number=EDGE_SAMPLES):
            projected = view.projectPoint(point)
            xs.append(projected.x)
            ys.append(projected.y)
    if not xs:
        raise RuntimeError("投影未产生任何几何：模型可能为空或视图朝向退化")
    center = ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)
    return center, (min(xs), max(xs), min(ys), max(ys))


def make_view(doc, page, shape_obj, view_name, index):
    """建单个 TechDraw::DrawViewPart（显式朝向 + 隐藏线开关）并归属页面后重算。"""
    direction, xdirection = DIRECTIONS[view_name]
    view = doc.addObject("TechDraw::DrawViewPart", "View_%d" % index)
    view.Source = [shape_obj]
    view.Direction = App.Vector(direction[0], direction[1], direction[2])
    view.XDirection = App.Vector(xdirection[0], xdirection[1], xdirection[2])
    view.Scale = SCALE
    view.HardHidden = SHOW_HIDDEN
    view.IsoHidden = SHOW_HIDDEN
    view.SmoothHidden = SHOW_HIDDEN
    view.SeamHidden = SHOW_HIDDEN
    page.addView(view)
    doc.recompute()
    doc.recompute()
    return view


def callout_fragments(view, center, bbox):
    """
    把件号投影到视图并生成引线 + 数字文本（y-down SVG 帧）。

    锚点 = projectPoint(point3d) - C，再翻转 y（片段帧 y 向上 → SVG y 向下）。
    片段按投影几何居中于原点，故几何中心恒为 (0,0)，引线方向即锚点向量本身；
    件号沿该外向偏移 LEADER_OFFSET，落在实体外侧。
    返回 (svg_片段列表, 锚点信息列表, 扩展包围盒)。
    """
    c_x, c_y = center
    fragments = []
    anchors = []
    min_x, max_x = bbox[0] - c_x, bbox[1] - c_x
    min_y, max_y = -bbox[3] + c_y, -bbox[2] + c_y  # 翻转后的 y-down 范围
    for callout in CALLOUTS:
        px, py, pz = callout["point3d"]
        projected = view.projectPoint(App.Vector(px, py, pz))
        anchor_x = projected.x - c_x
        anchor_y = -(projected.y - c_y)  # 翻转到 y-down
        length = math.hypot(anchor_x, anchor_y)
        if length < 1e-9:
            unit_x, unit_y = 1.0, 0.0
        else:
            unit_x, unit_y = anchor_x / length, anchor_y / length
        text_x = anchor_x + unit_x * LEADER_OFFSET
        text_y = anchor_y + unit_y * LEADER_OFFSET
        fragments.append(
            '<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="#000000" '
            'stroke-width="%s" fill="none"/>'
            % (fmt(anchor_x), fmt(anchor_y), fmt(text_x), fmt(text_y), fmt(STROKE_WIDTH))
        )
        fragments.append(
            '<text x="%s" y="%s" font-size="%s" font-family="sans-serif" '
            'text-anchor="middle" fill="#000000" stroke="none">%s</text>'
            % (
                fmt(text_x),
                fmt(text_y + NUMERAL_FONT_SIZE * 0.35),
                fmt(NUMERAL_FONT_SIZE),
                escape_text(callout["numeral"]),
            )
        )
        # 文本盒外扩，纳入画布包围盒。
        min_x = min(min_x, text_x - NUMERAL_FONT_SIZE)
        max_x = max(max_x, text_x + NUMERAL_FONT_SIZE)
        min_y = min(min_y, text_y - NUMERAL_FONT_SIZE)
        max_y = max(max_y, text_y + NUMERAL_FONT_SIZE)
        anchors.append(
            {
                "numeral": callout["numeral"],
                "label": callout["label"],
                "point3d": [px, py, pz],
                "point2d": [round(anchor_x, 4), round(anchor_y, 4)],
            }
        )
    return fragments, anchors, (min_x, max_x, min_y, max_y)


def build_view_svg(view, shape, view_name):
    """生成单个视图的独立黑白 SVG 文本与其 manifest 元数据。"""
    center, bbox = projected_bbox_center(view, shape)
    c_x, c_y = center
    fragment = TechDraw.viewPartAsSvg(view)
    if fragment is None or fragment.strip() == "":
        raise RuntimeError("viewPartAsSvg 返回空片段：视图 %s 未产生投影几何" % view_name)
    # 片段帧（y-up）几何范围。
    geo_min_x, geo_max_x = bbox[0] - c_x, bbox[1] - c_x
    geo_min_y, geo_max_y = bbox[2] - c_y, bbox[3] - c_y
    callout_svg, anchors, extent = callout_fragments(view, center, bbox)
    min_x = min(geo_min_x, extent[0]) - CANVAS_PADDING
    max_x = max(geo_max_x, extent[1]) + CANVAS_PADDING
    min_y = min(-geo_max_y, extent[2]) - CANVAS_PADDING
    max_y = max(-geo_min_y, extent[3]) + CANVAS_PADDING
    width = max_x - min_x
    height = max_y - min_y
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" '
        'width="%smm" height="%smm">'
        % (fmt(min_x), fmt(min_y), fmt(width), fmt(height), fmt(width * SCALE), fmt(height * SCALE)),
        '<g transform="scale(1,-1)">',
        fragment,
        "</g>",
    ]
    parts.extend(callout_svg)
    parts.append("</svg>")
    return "".join(parts), {
        "bbox": [round(min_x, 4), round(min_y, 4), round(width, 4), round(height, 4)],
        "anchors": anchors,
    }


def main():
    template_path = os.path.join(OUTPUT_DIR, TEMPLATE_FILENAME)
    with open(template_path, "w") as handle:
        handle.write(MINIMAL_TEMPLATE)

    shape = Part.read(MODEL_PATH)
    if shape is None or shape.isNull():
        raise RuntimeError("无法载入模型或模型为空：%s" % MODEL_PATH)

    doc = App.newDocument("structure_figure")
    # TechDraw 重算时会把模板拷进「文档所在目录」；内存文档无文件名会解析到根
    # 目录（/）导致拷贝失败，故给文档一个 outputDir 内的文件名作为拷贝基准。
    doc.FileName = os.path.join(OUTPUT_DIR, "structure-figure.FCStd")
    shape_obj = doc.addObject("Part::Feature", "Model")
    shape_obj.Shape = shape
    doc.recompute()

    page = doc.addObject("TechDraw::DrawPage", "Page")
    template = doc.addObject("TechDraw::DrawSVGTemplate", "Template")
    template.Template = template_path
    page.Template = template
    doc.recompute()

    manifest_views = []
    for index, view_name in enumerate(VIEWS):
        view = make_view(doc, page, shape_obj, view_name, index)
        svg_text, meta = build_view_svg(view, shape, view_name)
        svg_path = os.path.join(OUTPUT_DIR, SVG_FILENAMES[view_name])
        with open(svg_path, "w") as handle:
            handle.write(svg_text)
        manifest_views.append(
            {
                "name": view_name,
                "order": index,
                "path": svg_path,
                "bbox": meta["bbox"],
                "anchors": meta["anchors"],
            }
        )

    manifest = {
        "figureNumber": FIGURE_NUMBER,
        "modelPath": MODEL_PATH,
        "scale": SCALE,
        "showHidden": SHOW_HIDDEN,
        "generator": "freecad-structure",
        "views": manifest_views,
    }
    manifest_path = os.path.join(OUTPUT_DIR, MANIFEST_FILENAME)
    with open(manifest_path, "w") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    sys.stdout.write("STRUCTURE_OK %d views\n" % len(manifest_views))


# freecadcmd 吞掉未捕获异常并以退出码 0 结束（实测），故显式包裹 main：
# 失败时打印 traceback 到 stderr 并 sys.exit(1)，让渲染器据退出码 fail-loud。
try:
    main()
except SystemExit:
    raise
except BaseException:
    traceback.print_exc()
    sys.exit(1)
`
