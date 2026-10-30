"""TechDraw 出图：模板装页、三视图、规则标注、DXF/PDF 导出。

用法：
  FreeCADCmd scripts/sheet.py --pass params/plate-100x60.json
  xvfb-run -a freecad scripts/sheet.py --pass params/plate-100x60.json --pdf

前置条件：同一变体已由 build.py 产出 out/<part>/<variant>/model.FCStd。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import dim_rules
from common import freecad_argv
from common.params import ParamsError, load_params

EXIT_OK = 0
EXIT_PARAMS = 2
EXIT_GEOMETRY = 3
EXIT_EXPORT = 4
EXIT_ENV = 5

TEMPLATE_NAME = "A4_landscape.svg"
FALLBACK_PAGE_MM = (297.0, 210.0)


def main(argv: list[str] | None = None) -> int:
    """执行一次出图。

    @param argv - 命令行参数，缺省取 sys.argv。
    @returns 进程退出码，见 README。
    """
    args = _parse_args(freecad_argv(argv))
    try:
        spec = load_params(args.params_file)
    except ParamsError as error:
        return _fail(EXIT_PARAMS, str(error))

    out_dir = (
        pathlib.Path(args.out).expanduser().resolve()
        if args.out
        else ROOT / "out" / spec["part"] / spec["variant"]
    )
    document_path = out_dir / "model.FCStd"
    template_path = pathlib.Path(args.template).expanduser().resolve()

    if not document_path.exists():
        return _fail(EXIT_GEOMETRY, f"缺少上游产物：{document_path}，先运行 build.py")
    if not template_path.exists():
        return _fail(EXIT_PARAMS, f"图框模板不存在：{template_path}")

    try:
        import FreeCAD as App
        import Part
    except ImportError:
        return _fail(EXIT_ENV, "未找到 FreeCAD/Part 模块：必须用 FreeCADCmd 或 freecad 运行本脚本")

    document = App.openDocument(str(document_path))
    model = document.getObject("Model")
    if model is None:
        return _fail(EXIT_GEOMETRY, f"{document_path} 中没有名为 Model 的对象")

    # 用 Part.HLRBRep 直接生成投影视图（无头模式下 TechDraw HLR 不运行）。
    projections = _project_views(model.Shape)
    if not projections:
        return _fail(EXIT_GEOMETRY, "投影视图生成失败")

    # 用投影边匹配标注规则，匹配失败时回退到 3D 几何测量。
    try:
        results = _place_dimensions(projections, spec["params"], model.Shape)
    except Exception as error:
        return _fail(EXIT_GEOMETRY, f"标注失败：{type(error).__name__}：{error}")

    files: list[str] = []
    dxf_path = out_dir / "model.dxf"
    try:
        _export_dxf(projections, results, args, spec, str(dxf_path))
        _require_nonempty(dxf_path)
        files.append(dxf_path.name)
    except Exception as error:
        return _fail(EXIT_EXPORT, f"DXF 导出失败：{type(error).__name__}：{error}")

    if args.pdf:
        try:
            import TechDraw
            import TechDrawGui

            page, template = _create_page(document, template_path)
            document.recompute()
            fields = _field_values(args, spec, {})
            _fill_fields(template, fields)
            pdf_path = out_dir / "model.pdf"
            TechDrawGui.exportPageAsPdf(page, str(pdf_path))
            _require_nonempty(pdf_path)
            files.append(pdf_path.name)
        except ImportError:
            return _fail(EXIT_ENV, "PDF 导出需要 GUI：请用 xvfb-run -a freecad 运行并加 --pdf")
        except Exception as error:
            return _fail(EXIT_EXPORT, f"PDF 导出失败：{type(error).__name__}：{error}")

    _write_dimensions(out_dir, projections, results, files)
    _shutdown_gui()

    manual = sum(1 for item in results if item["status"] != "ok")
    ok_msg = f"OK {spec['part']}/{spec['variant']} → {dxf_path}（人工补标 {manual} 项）"
    print(ok_msg)
    return EXIT_OK


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按参数表生成工程图")
    parser.add_argument("--pass", dest="params_file", required=True, help="参数表 JSON 路径")
    parser.add_argument("--out", default=None, help="变体目录，缺省 out/<part>/<variant>")
    parser.add_argument(
        "--template",
        default=str(ROOT / "templates" / TEMPLATE_NAME),
        help="图框 SVG 路径",
    )
    parser.add_argument("--pdf", action="store_true", help="同时导出 PDF（需要 GUI）")
    parser.add_argument("--title", default=None, help="图名，缺省取参数表 description")
    parser.add_argument("--drawing-number", default=None, help="图号，缺省取变体名")
    parser.add_argument("--author", default=None, help="制图人")
    parser.add_argument("--organization", default=None, help="单位名称")
    return parser.parse_args(argv)


def _create_page(document, template_path: pathlib.Path):
    template = document.addObject("TechDraw::DrawSVGTemplate", "Template")
    template.Template = str(template_path)
    page = document.addObject("TechDraw::DrawPage", "Sheet")
    page.Template = template
    return page, template


def _field_values(args: argparse.Namespace, spec: dict, views: dict) -> dict:
    """按 docs/field-dictionary.md 组装标题栏字段，缺值统一填 —。"""
    return {
        "FC-Title": args.title or spec.get("description") or spec["variant"],
        "FC-DrawingNumber": args.drawing_number or spec["variant"],
        "FC-Scale": "1:1",
        "FC-PageNumber": "1",
        "FC-PageCount": "1",
        "FC-Author": args.author or "—",
        "FC-Date": date.today().isoformat(),
        "FC-Organization": args.organization or "—",
    }


def _fill_fields(template, fields: dict) -> None:
    texts = dict(template.EditableTexts)
    texts.update(fields)
    template.EditableTexts = texts


def _project_views(shape) -> dict:
    """用 Part.HLRBRep 生成三视图的可见边投影。

    无头模式下 TechDraw 的 HLR 不运行，故直接调用 OpenCASCADE 的 HLRBRep。
    为使各视图落在统一的 XY 平面，先将实体旋转到对应朝向再沿 Z 投影。

    @param shape - Part.Shape 实体。
    @returns {视图名: Part.Shape(可见边复合)}。
    """
    import FreeCAD as App
    import Part

    def _project(source, direction):
        hlr = Part.HLRBRep.Algo()
        hlr.add(source)
        hlr.showAll()
        hlr.setProjector(direction)
        hlr.update()
        return Part.HLRBRep.HLRToShape(hlr).vCompound()

    projections: dict = {}
    projections["Top"] = _project(shape, App.Vector(0, 0, 1))

    front_src = shape.copy()
    front_src.rotate(App.Vector(0, 0, 0), App.Vector(1, 0, 0), -90)
    projections["Front"] = _project(front_src, App.Vector(0, 0, 1))

    left_src = shape.copy()
    left_src.rotate(App.Vector(0, 0, 0), App.Vector(0, 1, 0), 90)
    projections["Left"] = _project(left_src, App.Vector(0, 0, 1))

    return projections


def _visible_edges(projection) -> list[tuple[int, object]]:
    """把投影可见边转为 (序号, 边) 列表，供 dim_rules 匹配。"""
    return [(number, edge) for number, edge in enumerate(projection.Edges, start=1)]


def _place_dimensions(projections: dict, params: dict, shape=None) -> list[dict]:
    """为每条规则匹配尺寸；投影边匹配失败时回退到 Part 几何测量。"""
    results: list[dict] = []
    for rule in dim_rules.RULES:
        view_name = dim_rules.RULE_VIEWS[rule]
        projection = projections.get(view_name)
        if projection is None or len(projection.Edges) == 0:
            fallback = _measure_from_shape(rule, shape, params) if shape is not None else None
            if fallback is not None:
                fallback["view"] = view_name
                fallback["created"] = False
                results.append(fallback)
            else:
                results.append(
                    {
                        "rule": rule,
                        "view": view_name,
                        "status": "manual",
                        "edges": [],
                        "value": None,
                        "created": False,
                        "reason": f"未取到 {view_name} 投影视图",
                    }
                )
            continue

        edges = _visible_edges(projection)
        result = dim_rules.select(rule, edges, params)
        # 投影边匹配失败时回退到 3D 测量；测量给出的原因更具体（参数未声明、
        # 实测值与参数不符等），因此只要它有结论就采用。
        if result["status"] != "ok" and shape is not None:
            measured = _measure_from_shape(rule, shape, params)
            if measured["status"] == "ok" or measured.get("reason"):
                result = measured
        result["view"] = view_name
        result["created"] = result["status"] == "ok"
        results.append(result)
    return results


def _measure_from_shape(rule: str, shape, params: dict) -> dict:
    """从 Part 实体直接测量尺寸值，作为 TechDraw 投影边不可用时的回退。

    @param rule - RULES 之一。
    @param shape - Part.Shape 实体。
    @param params - 参数表数值。
    @returns 含 rule、status、edges、value、reason 的字典；edges 恒为空（无投影边可引用）。
    """
    if shape is None:
        return {
            "rule": rule,
            "status": "manual",
            "edges": [],
            "value": None,
            "reason": "模型无 Shape，无法测量",
        }

    declared = dim_rules.expected(rule, params)
    if declared is None:
        return {
            "rule": rule,
            "status": "manual",
            "edges": [],
            "value": None,
            "reason": f"参数表未声明 {dim_rules.PARAM_KEYS[rule][0]}，该零件不适用此项",
        }

    bbox = shape.BoundBox
    if rule == "overall_x":
        value = bbox.XLength
        key, expected_value = declared
        reason = None if abs(value - expected_value) <= 1e-3 else \
            f"实测 {value:.3f} mm，与参数 {key}={expected_value} 不符"
    elif rule == "overall_y":
        value = bbox.YLength
        key, expected_value = declared
        reason = None if abs(value - expected_value) <= 1e-3 else \
            f"实测 {value:.3f} mm，与参数 {key}={expected_value} 不符"
    elif rule == "thickness":
        value = bbox.ZLength
        key, expected_value = declared
        reason = None if abs(value - expected_value) <= 1e-3 else \
            f"实测 {value:.3f} mm，与参数 {key}={expected_value} 不符"
    elif rule == "hole_dia":
        value = _hole_diameter_from_shape(shape, params)
        reason = None if value is not None else "未找到匹配孔径的圆柱面"
        if value is None:
            return {"rule": rule, "status": "manual", "edges": [], "value": None, "reason": reason}
    elif rule == "pitch_dia":
        value = _pitch_diameter_from_shape(shape, params)
        reason = None if value is not None else "孔数不足或不共圆，无法确定节圆"
        if value is None:
            return {"rule": rule, "status": "manual", "edges": [], "value": None, "reason": reason}
    else:
        return {"rule": rule, "status": "manual", "edges": [], "value": None, "reason": f"未知规则 {rule}"}

    result = {
        "rule": rule,
        "status": "ok" if reason is None else "manual",
        "edges": [],
        "value": round(value, 4),
        "reason": reason,
    }
    if rule in ("hole_dia", "pitch_dia"):
        count = len(_matching_centers(shape, params))
        if count > 1:
            result["quantity"] = count
    return result


def _cylindrical_faces(shape) -> list:
    """返回形状中所有圆柱面及其半径、轴。"""
    cylinders = []
    for face in shape.Faces:
        surface = getattr(face, "Surface", None)
        if surface is None:
            continue
        if not hasattr(surface, "Radius") or not hasattr(surface, "Axis"):
            continue
        radius = float(surface.Radius)
        if radius <= 0:
            continue
        axis = surface.Axis
        center = surface.Center
        cylinders.append({"face": face, "radius": radius, "axis": axis, "center": center})
    return cylinders


def _hole_radius_param(params: dict) -> float | None:
    """返回参数表中的孔半径；兼容 HOLE_D（板）与 BOLT_D（法兰）。"""
    for key in ("HOLE_D", "BOLT_D"):
        value = params.get(key)
        if value is not None:
            return float(value) / 2
    return None


def _hole_count_param(params: dict) -> int:
    """返回参数表中的孔数；兼容 N_HOLES_X*N_HOLES_Y（板）与 N_BOLTS（法兰）。"""
    n_bolts = params.get("N_BOLTS")
    if n_bolts is not None:
        return int(n_bolts)
    nx = int(params.get("N_HOLES_X", 0))
    ny = int(params.get("N_HOLES_Y", 0))
    return nx * ny


def _hole_diameter_from_shape(shape, params: dict) -> float | None:
    """从圆柱面测量孔径；返回匹配孔半径的直径，不匹配返回 None。"""
    radius = _hole_radius_param(params)
    if radius is None:
        return None
    for cyl in _cylindrical_faces(shape):
        if abs(cyl["radius"] - radius) <= 1e-3:
            return 2 * cyl["radius"]
    return None


def _matching_centers(shape, params: dict) -> list[tuple[float, float]]:
    """返回匹配孔径的圆柱面圆心，按 XY 去重。

    通孔在布尔切割后常产生两个半圆柱面，同一孔的圆心会重复出现。

    @param shape - Part.Shape 实体。
    @param params - 参数表数值。
    @returns 去重后的孔心坐标列表。
    """
    import math

    radius = _hole_radius_param(params)
    if radius is None:
        return []
    centers: list[tuple[float, float]] = []
    for cyl in _cylindrical_faces(shape):
        if abs(cyl["radius"] - radius) > 1e-3:
            continue
        point = (float(cyl["center"].x), float(cyl["center"].y))
        if all(math.hypot(point[0] - cx, point[1] - cy) > 1e-3 for cx, cy in centers):
            centers.append(point)
    return centers


def _pitch_diameter_from_shape(shape, params: dict) -> float | None:
    """从孔阵圆柱面测量节圆直径。

    取所有匹配孔半径的圆柱面圆心，去重后判断是否共圆；
    共圆则返回节圆直径，否则返回 None（矩形孔阵无节圆）。
    """
    import math

    centers = _matching_centers(shape, params)
    if len(centers) < 2:
        return None

    center_x = sum(c[0] for c in centers) / len(centers)
    center_y = sum(c[1] for c in centers) / len(centers)
    radii = [math.hypot(cx - center_x, cy - center_y) for cx, cy in centers]
    avg_radius = sum(radii) / len(radii)
    if avg_radius <= 1e-3:
        return None
    max_dev = max(abs(r - avg_radius) for r in radii)
    if max_dev > 1e-2:
        return None
    return 2 * avg_radius


def _export_dxf(
    projections: dict,
    results: list[dict],
    args: argparse.Namespace,
    spec: dict,
    dxf_path: str,
) -> None:
    """生成 DXF：A4 图框 + 标题栏 + 三视图 + 尺寸标注。

    直接解析 Part 形状的边（Line/Circle）并手写 DXF 实体，避开 importDXF 无法
    处理 Draft 文本对象的问题。

    @param projections - {视图名: Part.Shape}。
    @param results - 标注规则结果。
    @param args - CLI 参数。
    @param spec - 参数表。
    @param dxf_path - 输出 DXF 路径。
    """
    import FreeCAD as App
    import Part

    page_w, page_h = FALLBACK_PAGE_MM
    margin = 10.0
    inner_w = page_w - 2 * margin
    inner_h = page_h - 2 * margin

    def _rect_lines(x: float, y: float, w: float, h: float):
        """返回矩形四条边的 (x1, y1, x2, y2)。"""
        return [
            (x, y, x + w, y),
            (x + w, y, x + w, y + h),
            (x + w, y + h, x, y + h),
            (x, y + h, x, y),
        ]

    lines: list[tuple[float, float, float, float]] = []
    circles: list[tuple[float, float, float]] = []
    texts: list[tuple[str, float, float, float]] = []  # (text, x, y, height)

    # 图框：外框 + 内框。
    lines.extend(_rect_lines(0, 0, page_w, page_h))
    lines.extend(_rect_lines(margin, margin, inner_w, inner_h))

    # 标题栏（右下角，180×40）。
    tb_w, tb_h = 180.0, 40.0
    tb_x = page_w - margin - tb_w
    tb_y = margin
    lines.extend(_rect_lines(tb_x, tb_y, tb_w, tb_h))

    # 标题栏分隔线与文字。
    fields = _field_values(args, spec, {})
    title_texts = [
        (fields["FC-Title"], tb_x + 5, tb_y + tb_h - 8),
        (f"图号: {fields['FC-DrawingNumber']}", tb_x + 5, tb_y + tb_h - 18),
        (f"比例: {fields['FC-Scale']}", tb_x + 5, tb_y + tb_h - 28),
        (f"日期: {fields['FC-Date']}", tb_x + 90, tb_y + tb_h - 18),
        (f"制图: {fields['FC-Author']}", tb_x + 90, tb_y + tb_h - 28),
    ]
    for text, x, y in title_texts:
        texts.append((text, x, y, 3.0))

    # 视图布局：俯视图左上，主视图在俯视图下方，左视图在主视图右侧。
    positions = _layout_views(projections, inner_w, inner_h, margin)
    for name, (x, y, scale) in positions.items():
        # 把视图包围盒左下角对齐到槽位原点，避免原点不在几何内部时越出图框。
        bbox = projections[name].BoundBox
        # 直接从未缩放形状读取几何，再对坐标施加缩放和平移；
        # FreeCAD 0.21 中 shape.scale() 会使 edge.Curve 无法读取。
        _collect_shape_geometry(
            projections[name],
            lines,
            circles,
            scale,
            x - float(bbox.XMin) * scale,
            y - float(bbox.YMin) * scale,
        )

    # 尺寸标注：在对应视图旁添加文字。
    for result in results:
        if result["status"] != "ok" or result.get("value") is None:
            continue
        view_name = result["view"]
        if view_name not in positions:
            continue
        vx, vy, scale = positions[view_name]
        label = _dimension_label(result)
        texts.append((label, vx - 15, vy + 5, 2.5))

    _write_dxf(dxf_path, lines, circles, texts)


def _collect_shape_geometry(
    shape, lines: list, circles: list, scale: float = 1.0, off_x: float = 0.0, off_y: float = 0.0
) -> None:
    """从 Part 形状提取直线和圆，追加到 lines/circles。

    坐标先乘以 scale 再平移 (off_x, off_y)，避免调用 shape.scale() 导致
    FreeCAD 0.21 中 edge.Curve 无法读取。

    @param shape - Part.Shape 投影视图。
    @param lines - 收集到的 (x1, y1, x2, y2)。
    @param circles - 收集到的 (cx, cy, r)。
    @param scale - 缩放系数。
    @param off_x - X 方向平移。
    @param off_y - Y 方向平移。
    """
    for edge in shape.Edges:
        try:
            curve = getattr(edge, "Curve", None)
            if curve is None:
                continue
            cname = type(curve).__name__
            if cname == "Line":
                v0 = edge.Vertexes[0]
                v1 = edge.Vertexes[-1]
                lines.append((
                    float(v0.X) * scale + off_x,
                    float(v0.Y) * scale + off_y,
                    float(v1.X) * scale + off_x,
                    float(v1.Y) * scale + off_y,
                ))
            elif cname == "Circle":
                center = curve.Center
                circles.append((
                    float(center.x) * scale + off_x,
                    float(center.y) * scale + off_y,
                    float(curve.Radius) * scale,
                ))
            # 其它曲线类型（Arc 等）暂不处理。
        except Exception:
            continue


def _unique(items: list, key) -> list:
    """按 key 去重并保持原有顺序。"""
    seen = set()
    result = []
    for item in items:
        marker = key(item)
        if marker in seen:
            continue
        seen.add(marker)
        result.append(item)
    return result


def _write_dxf(
    path: str,
    lines: list[tuple[float, float, float, float]],
    circles: list[tuple[float, float, float]],
    texts: list[tuple[str, float, float, float]],
) -> None:
    """写入最小可用的 R12 DXF 文件，含 HEADER 与 ENTITIES 段。

    R12 没有 Unicode，文字按 $DWGCODEPAGE 指定的代码页编码；此处用简体中文
    代码页 ANSI_936，保证中文标题栏在 AutoCAD/LibreCAD 中正常显示。

    HLR 会把同一段几何拆成多条边（一个孔常被拆成两个半圆弧），这里按坐标
    去重，避免同一圆被写成两条重叠的 CIRCLE。
    """
    def _line_key(item):
        x1, y1, x2, y2 = item
        first = (round(x1, 4), round(y1, 4))
        second = (round(x2, 4), round(y2, 4))
        return (first, second) if first <= second else (second, first)

    lines = _unique(lines, _line_key)
    circles = _unique(circles, lambda c: (round(c[0], 4), round(c[1], 4), round(c[2], 4)))

    out: list[str] = []
    out += ["0", "SECTION", "2", "HEADER"]
    out += ["9", "$ACADVER", "1", "AC1009"]
    out += ["9", "$DWGCODEPAGE", "3", "ANSI_936"]
    out += ["9", "$INSUNITS", "70", "4"]
    out += ["0", "ENDSEC"]
    out += ["0", "SECTION", "2", "ENTITIES"]

    for x1, y1, x2, y2 in lines:
        out += [
            "0", "LINE", "8", "0",
            "10", f"{x1:.6f}", "20", f"{y1:.6f}", "30", "0.0",
            "11", f"{x2:.6f}", "21", f"{y2:.6f}", "31", "0.0",
        ]

    for cx, cy, r in circles:
        out += [
            "0", "CIRCLE", "8", "0",
            "10", f"{cx:.6f}", "20", f"{cy:.6f}", "30", "0.0",
            "40", f"{r:.6f}",
        ]

    for text, x, y, h in texts:
        # GB2312/936 不含 U+2300（⌀），统一换成 AutoCAD 控制码。
        text = text.replace("⌀", "%%c")
        out += [
            "0", "TEXT", "8", "0",
            "10", f"{x:.6f}", "20", f"{y:.6f}", "30", "0.0",
            "40", f"{h:.2f}",
            "1", text,
        ]

    out += ["0", "ENDSEC", "0", "EOF"]

    with open(path, "w", encoding="cp936") as handle:
        handle.write("\n".join(out) + "\n")


def _layout_views(
    projections: dict, inner_w: float, inner_h: float, margin: float
) -> dict:
    """按三视图第一角法摆放，返回 {视图名: (页面X, 页面Y, 缩放)}。"""
    # 计算各视图尺寸并求统一缩放。
    sizes = {}
    for name, shape in projections.items():
        bb = shape.BoundBox
        sizes[name] = (bb.XLength, bb.YLength)

    # 第一角法：俯视图在左上，主视图在俯视图正下方，左视图在主视图右侧。
    top_w, top_h = sizes.get("Top", (1, 1))
    front_w, front_h = sizes.get("Front", (1, 1))
    left_w, left_h = sizes.get("Left", (1, 1))

    gap = 15.0
    total_w = max(top_w, front_w) + gap + left_w
    total_h = top_h + gap + front_h

    avail_w = inner_w - 40
    avail_h = inner_h - 60
    scale = min(avail_w / total_w, avail_h / total_h, 1.0)

    origin_x = margin + 15
    origin_y = margin + 50

    top_x = origin_x
    top_y = origin_y + (front_h * scale) + gap
    front_x = origin_x
    front_y = origin_y
    left_x = origin_x + (front_w * scale) + gap
    left_y = origin_y

    return {
        "Top": (top_x, top_y, scale),
        "Front": (front_x, front_y, scale),
        "Left": (left_x, left_y, scale),
    }


def _dimension_label(result: dict) -> str:
    """把标注结果转为 DXF 文字。

    直径符号用 AutoCAD 控制码 `%%c`（渲染为 ⌀），因为 U+2300 不在 GB2312/936
    代码页内，直接写字符会编码失败，而 `%%c` 是纯 ASCII、所有 CAD 都支持。
    """
    rule = result["rule"]
    value = result.get("value")
    if value is None:
        return ""
    if rule == "hole_dia":
        qty = result.get("quantity", 1)
        prefix = f"{qty}×" if qty > 1 else ""
        return f"{prefix}%%c{value:.1f}"
    if rule == "pitch_dia":
        return f"%%c{value:.1f}"
    return f"{value:.1f}"


def _round_value(item: dict) -> dict:
    """复制标注结果并把数值保留三位小数，去掉浮点残差。

    例如板厚实测 7.999999999999993，写入 8.0。

    @param item - 单条标注结果。
    @returns 复制后的结果，数值已四舍五入到 0.001 mm。
    """
    entry = dict(item)
    if isinstance(entry.get("value"), float):
        entry["value"] = round(entry["value"], 3)
    return entry


def _write_dimensions(
    out_dir: pathlib.Path, projections: dict, results: list[dict], files: list[str]
) -> None:
    payload = {
        "views": {name: getattr(shape, "ShapeType", None) for name, shape in projections.items()},
        "dimensions": [_round_value(item) for item in results],
        "files": files,
    }
    (out_dir / "dimensions.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    manual = [item for item in results if item["status"] != "ok"]
    lines = ["# 人工补标清单", ""]
    if not manual:
        lines.append("全部规则自动匹配成功。")
    else:
        lines.append("| 规则 | 视图 | 原因 |")
        lines.append("|---|---|---|")
        for item in manual:
            lines.append(f"| {item['rule']} | {item['view']} | {item['reason']} |")
    lines.append("")
    (out_dir / "manual_review.md").write_text("\n".join(lines), encoding="utf-8")


def _shutdown_gui() -> None:
    """关闭文档并清修改标记；无 GUI 时仅关文档，避免保存对话框。"""
    import FreeCAD as App

    try:
        import FreeCADGui as Gui
    except ImportError:
        Gui = None

    for opened in list(App.listDocuments().values()):
        try:
            opened.Modified = False
        except Exception:
            pass
        if Gui is not None and hasattr(Gui, "getDocument"):
            try:
                Gui.getDocument(opened.Name).Modified = False
            except Exception:
                pass
        try:
            App.closeDocument(opened.Name)
        except Exception:
            pass

    if Gui is not None and hasattr(Gui, "getMainWindow"):
        try:
            Gui.getMainWindow().close()
        except Exception:
            pass


def _require_nonempty(path: pathlib.Path) -> None:
    if not path.exists() or path.stat().st_size == 0:
        raise RuntimeError(f"未产出文件或文件为空：{path}")


def _fail(code: int, message: str) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return code


# 区分 `freecadcmd sheet.py`（入口）与 `import sheet`（模块）。
# FreeCAD 以脚本 stem 作为 __name__ 导入并执行；同时要求脚本路径出现在 argv 中，
# 以排除被其他脚本 import 的情形。
def _is_entry() -> bool:
    if __name__ != pathlib.Path(__file__).stem:
        return False
    try:
        here = pathlib.Path(__file__).resolve()
        return any(
            pathlib.Path(arg).resolve() == here
            for arg in sys.argv[1:]
            if arg
        )
    except (OSError, RuntimeError):
        return False


if _is_entry():
    _code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    raise SystemExit(_code)
