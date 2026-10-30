"""把 sheet.py 产出的 R12 DXF 渲染成 PDF。

用法：
  python3 scripts/render_pdf.py --dxf out/plate/100x60/model.dxf
  python3 scripts/render_pdf.py --dxf out/plate/100x60/model.dxf --pdf out/plate/100x60/model.pdf

用系统 Python 执行，不依赖 FreeCAD：FreeCAD 的 TechDraw PDF 导出需要 GUI，
而本沙箱的 GUI 进程无法以脚本方式稳定执行。这里按 DXF 的 LINE/CIRCLE/TEXT
实体重绘到 A4 横放页面，几何与 DXF 完全一致。
"""

from __future__ import annotations

import argparse
import pathlib
import sys

EXIT_OK = 0
EXIT_INPUT = 2
EXIT_RENDER = 4

PAGE_MM = (297.0, 210.0)

# 候选中文字体，按顺序取第一个可注册的。
FONT_CANDIDATES = (
    ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", 0),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
)


def main(argv: list[str] | None = None) -> int:
    """渲染一份 DXF 为 PDF。

    @param argv - 命令行参数，缺省取 sys.argv。
    @returns 进程退出码：0 成功，2 输入缺失，4 渲染失败。
    """
    parser = argparse.ArgumentParser(description="把 DXF 渲染为 PDF")
    parser.add_argument("--dxf", required=True, help="输入 DXF 路径")
    parser.add_argument("--pdf", default=None, help="输出 PDF 路径，缺省与 DXF 同名")
    args = parser.parse_args(argv)

    dxf_path = pathlib.Path(args.dxf).expanduser().resolve()
    if not dxf_path.exists():
        print(f"ERROR: 找不到 DXF：{dxf_path}", file=sys.stderr)
        return EXIT_INPUT
    pdf_path = (
        pathlib.Path(args.pdf).expanduser().resolve()
        if args.pdf
        else dxf_path.with_suffix(".pdf")
    )

    try:
        import ezdxf
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
    except ImportError as error:
        print(f"ERROR: 缺少依赖（ezdxf / reportlab）：{error}", file=sys.stderr)
        return EXIT_RENDER

    font_name = _register_font(pdfmetrics, TTFont)

    try:
        document = ezdxf.readfile(dxf_path)
    except Exception as error:
        print(f"ERROR: 无法解析 DXF：{type(error).__name__}：{error}", file=sys.stderr)
        return EXIT_INPUT

    page_w, page_h = PAGE_MM
    sheet = canvas.Canvas(str(pdf_path), pagesize=(page_w * mm, page_h * mm))
    sheet.setStrokeColorRGB(0, 0, 0)
    sheet.setFillColorRGB(0, 0, 0)

    for entity in document.modelspace():
        kind = entity.dxftype()
        if kind == "LINE":
            start, end = entity.dxf.start, entity.dxf.end
            sheet.setLineWidth(0.2 * mm)
            sheet.line(start.x * mm, start.y * mm, end.x * mm, end.y * mm)
        elif kind == "CIRCLE":
            center = entity.dxf.center
            sheet.setLineWidth(0.2 * mm)
            sheet.circle(center.x * mm, center.y * mm, entity.dxf.radius * mm, stroke=1, fill=0)
        elif kind == "ARC":
            center = entity.dxf.center
            radius = entity.dxf.radius
            start = float(entity.dxf.start_angle)
            extent = (float(entity.dxf.end_angle) - start) % 360.0
            sheet.setLineWidth(0.2 * mm)
            sheet.arc(
                (center.x - radius) * mm,
                (center.y - radius) * mm,
                (center.x + radius) * mm,
                (center.y + radius) * mm,
                startAng=start,
                extent=extent,
            )
        elif kind == "TEXT":
            height = float(entity.dxf.height)
            sheet.setFont(font_name, height * mm)
            # DXF 用 %%c 表示直径（R12 无 Unicode）。wqy 中文字体没有 U+2300，
            # PDF 里改用同字形含义的 Ø（U+00D8）；CAD 打开 DXF 仍显示 ⌀。
            text = entity.dxf.text.replace("%%c", "Ø")
            insert = entity.dxf.insert
            sheet.drawString(insert.x * mm, insert.y * mm, text)

    sheet.showPage()
    sheet.save()
    print(f"OK {dxf_path.name} → {pdf_path}")
    return EXIT_OK


def _register_font(pdfmetrics, ttfont_class) -> str:
    """注册第一个可用的中文字体，失败时退回内置字体。

    @param pdfmetrics - reportlab 的 pdfmetrics 模块。
    @param ttfont_class - reportlab 的 TTFont 类。
    @returns 可传给 canvas.setFont 的字体名。
    """
    for path, index in FONT_CANDIDATES:
        if not pathlib.Path(path).exists():
            continue
        try:
            pdfmetrics.registerFont(ttfont_class("DshCJK", path, subfontIndex=index))
            return "DshCJK"
        except Exception:
            continue
    return "Helvetica"


if __name__ == "__main__":
    raise SystemExit(main())
