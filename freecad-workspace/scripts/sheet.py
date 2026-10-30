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
from common.params import ParamsError, load_params

EXIT_OK = 0
EXIT_PARAMS = 2
EXIT_GEOMETRY = 3
EXIT_EXPORT = 4
EXIT_ENV = 5

TEMPLATE_NAME = "A4_landscape.svg"
PROJECTIONS = ("Front", "Top", "Left")
DIM_OFFSET_MM = 12.0
FALLBACK_PAGE_MM = (297.0, 210.0)


def main(argv: list[str] | None = None) -> int:
    """执行一次出图。

    @param argv - 命令行参数，缺省取 sys.argv。
    @returns 进程退出码，见 README。
    """
    args = _parse_args(argv)
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
        import TechDraw
    except ImportError:
        return _fail(EXIT_ENV, "未找到 FreeCAD/TechDraw 模块：必须用 FreeCADCmd 或 freecad 运行本脚本")

    document = App.openDocument(str(document_path))
    model = document.getObject("Model")
    if model is None:
        return _fail(EXIT_GEOMETRY, f"{document_path} 中没有名为 Model 的对象")

    page, template = _create_page(document, template_path)
    document.recompute()
    width, height = _page_size(template)

    group = _create_projection_group(document, page, model)
    document.recompute()

    views = _projection_map(group)
    _layout(group, views, width, height)
    document.recompute()

    fields = _field_values(args, spec, views)
    _fill_fields(template, fields)

    results = _place_dimensions(document, page, views, spec["params"])
    document.recompute()

    files: list[str] = []
    dxf_path = out_dir / "model.dxf"
    try:
        TechDraw.writeDXFPage(page, str(dxf_path))
        _require_nonempty(dxf_path)
        files.append(dxf_path.name)
    except Exception as error:
        return _fail(EXIT_EXPORT, f"DXF 导出失败：{type(error).__name__}：{error}")

    if args.pdf:
        try:
            import TechDrawGui

            pdf_path = out_dir / "model.pdf"
            TechDrawGui.exportPageAsPdf(page, str(pdf_path))
            _require_nonempty(pdf_path)
            files.append(pdf_path.name)
        except ImportError:
            return _fail(EXIT_ENV, "PDF 导出需要 GUI：请用 xvfb-run -a freecad 运行并加 --pdf")
        except Exception as error:
            return _fail(EXIT_EXPORT, f"PDF 导出失败：{type(error).__name__}：{error}")

    _write_dimensions(out_dir, views, results, files)
    _shutdown_gui()

    manual = sum(1 for item in results if item["status"] != "ok")
    print(f"OK {spec['part']}/{spec['variant']} → {dxf_path}（人工补标 {manual} 项）")
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


def _page_size(template) -> tuple[float, float]:
    width = float(getattr(template, "Width", 0) or 0)
    height = float(getattr(template, "Height", 0) or 0)
    if width <= 0 or height <= 0:
        return FALLBACK_PAGE_MM
    return width, height


def _field_values(args: argparse.Namespace, spec: dict, views: dict) -> dict:
    """按 docs/field-dictionary.md 组装标题栏字段，缺值统一填 —。"""
    return {
        "FC-Title": args.title or spec.get("description") or spec["variant"],
        "FC-DrawingNumber": args.drawing_number or spec["variant"],
        "FC-Scale": _scale_text(views.get("Front")),
        "FC-PageNumber": "1",
        "FC-PageCount": "1",
        "FC-Author": args.author or "—",
        "FC-Date": date.today().isoformat(),
        "FC-Organization": args.organization or "—",
    }


def _scale_text(view) -> str:
    """把视图 Scale（图:物）转成标题栏比例文本。"""
    scale = float(getattr(view, "Scale", 1.0) or 1.0)
    if scale >= 1.0:
        return f"{round(scale)}:1"
    return f"1:{round(1.0 / scale)}"


def _fill_fields(template, fields: dict) -> None:
    texts = dict(template.EditableTexts)
    texts.update(fields)
    template.EditableTexts = texts


def _create_projection_group(document, page, model):
    group = document.addObject("TechDraw::DrawProjGroup", "Views")
    page.addView(group)
    group.Source = [model]
    group.ProjectionType = "First Angle"
    for name in PROJECTIONS:
        group.addProjection(name)
    return group


def _projection_map(group) -> dict:
    """按投影名取子视图对象；取不到的名字记为 None。"""
    return {name: _projection(group, name) for name in PROJECTIONS}


def _projection(group, name: str):
    getter = getattr(group, "getProjection", None)
    if callable(getter):
        return getter(name)
    for child in getattr(group, "Views", []) or []:
        if getattr(child, "Name", "") == name or getattr(child, "Label", "") == name:
            return child
    return None


def _layout(group, views: dict, width: float, height: float) -> None:
    """按页面尺寸摆放视图；自动分布不可用时按固定间距手工摆放。"""
    front = views.get("Front")
    if front is None:
        return

    if hasattr(group, "AutoDistribute"):
        group.AutoDistribute = True
        group.X = width * 0.45
        group.Y = height * 0.55
        return

    front.X = width * 0.45
    front.Y = height * 0.55
    top = views.get("Top")
    if top is not None:
        top.X = front.X
        top.Y = front.Y - height * 0.22
    left = views.get("Left")
    if left is not None:
        left.X = front.X + width * 0.22
        left.Y = front.Y


def _visible_edges(view) -> list[tuple[int, object]]:
    """返回 (EdgeN 序号, 边)。

    假设 EdgeN 顺序与 getVisibleEdges() 的返回顺序一致；该假设需在目标机实测确认。
    """
    edges = []
    for number, item in enumerate(view.getVisibleEdges() or [], start=1):
        edge = item[0] if isinstance(item, (tuple, list)) else item
        edges.append((number, edge))
    return edges


def _place_dimensions(document, page, views: dict, params: dict) -> list[dict]:
    results: list[dict] = []
    for rule in dim_rules.RULES:
        view_name = dim_rules.RULE_VIEWS[rule]
        view = views.get(view_name)
        if view is None:
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

        result = dim_rules.select(rule, _visible_edges(view), params)
        result["view"] = view_name
        result["created"] = False
        if result["status"] == "ok":
            result["created"] = _create_dimension(document, page, view, result)
        results.append(result)
    return results


def _create_dimension(document, page, view, result: dict) -> bool:
    dimension = None
    try:
        dimension = document.addObject("TechDraw::DrawViewDimension", f"Dim_{result['rule']}")
        dimension.Type = "Diameter" if result["rule"] == "hole_dia" else "Distance"
        dimension.References2D = [(view, f"Edge{number}") for number in result["edges"]]
        page.addView(dimension)
        dimension.X = float(getattr(view, "X", 0)) + DIM_OFFSET_MM
        dimension.Y = float(getattr(view, "Y", 0)) + DIM_OFFSET_MM
        if result.get("quantity", 1) > 1:
            try:
                dimension.FormatSpec = f"{result['quantity']}×⌀%.1f"
            except (AttributeError, ValueError) as error:
                result["reason"] = f"数量前缀未生效：{error}"
        document.recompute()
        return True
    except Exception as error:
        result["status"] = "manual"
        result["reason"] = f"尺寸对象创建失败：{type(error).__name__}：{error}"
        if dimension is not None:
            document.removeObject(dimension.Name)
        return False


def _write_dimensions(
    out_dir: pathlib.Path, views: dict, results: list[dict], files: list[str]
) -> None:
    payload = {
        "views": {
            name: (getattr(view, "Name", None) if view else None)
            for name, view in views.items()
        },
        "dimensions": results,
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
    """清修改标记并关闭主窗口，避免 GUI 退出时弹保存对话框。"""
    try:
        import FreeCAD as App
        import FreeCADGui as Gui
    except ImportError:
        return
    for opened in App.listDocuments().values():
        Gui.getDocument(opened.Name).Modified = False
    Gui.getMainWindow().close()


def _require_nonempty(path: pathlib.Path) -> None:
    if not path.exists() or path.stat().st_size == 0:
        raise RuntimeError(f"未产出文件或文件为空：{path}")


def _fail(code: int, message: str) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
