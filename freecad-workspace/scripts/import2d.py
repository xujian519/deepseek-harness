"""客户既有图纸接入：DWG/DXF/PDF → 可清理的 SVG 线稿。

用法：
  python3 scripts/import2d.py --input incoming/JWZF20K/source/JWZF20K带支架.DWG --case JWZF20K
  python3 scripts/import2d.py --input drawing.dxf --drop-layer DIM --drop-pattern '^标注'

依赖：DXF 路径需要 ezdxf（pip install ezdxf）；DWG 路径需要 dwg2dxf（LibreDWG）；
PDF 路径使用系统 pdftocairo。本脚本不依赖 FreeCAD，可用系统 Python 运行。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

EXIT_OK = 0
EXIT_INPUT = 2
EXIT_CONVERT = 4
EXIT_ENV = 5

DEFAULT_TEXT_TYPES = ("TEXT", "MTEXT")


def main(argv: list[str] | None = None) -> int:
    """接入一张客户图纸。

    @param argv - 命令行参数，缺省取 sys.argv。
    @returns 进程退出码。
    """
    args = _parse_args(argv)
    source = pathlib.Path(args.input).expanduser().resolve()
    if not source.exists():
        return _fail(EXIT_INPUT, f"输入文件不存在：{source}")

    case = args.case or source.parent.name
    out_dir = (
        pathlib.Path(args.out).expanduser().resolve()
        if args.out
        else ROOT / "out" / case / "converted"
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    suffix = source.suffix.lower()
    if suffix == ".pdf":
        return _route_pdf(source, out_dir, case)
    if suffix not in {".dwg", ".dxf"}:
        return _fail(EXIT_INPUT, f"不支持的输入格式：{suffix or '无扩展名'}；支持 .dwg、.dxf、.pdf")

    converter: str | None = None
    with tempfile.TemporaryDirectory(prefix="import2d-") as workspace:
        dxf_path = source
        if suffix == ".dwg":
            converter = shutil.which("dwg2dxf")
            if converter is None:
                return _fail(
                    EXIT_ENV,
                    "缺少 DWG 转 DXF 工具：安装 LibreDWG 的 dwg2dxf，"
                    "或先用 ODA File Converter / AutoCAD 手动转成 DXF 后重跑",
                )
            dxf_path = pathlib.Path(workspace) / (source.stem + ".dxf")
            result = subprocess.run(
                [converter, "-y", "-o", str(dxf_path), str(source)],
                capture_output=True,
                text=True,
                timeout=300,
            )
            if result.returncode != 0 or not dxf_path.exists():
                return _fail(
                    EXIT_CONVERT,
                    f"dwg2dxf 失败（退出码 {result.returncode}）：{result.stderr.strip()[:400]}",
                )
        code = _convert_dxf(source, dxf_path, out_dir, args, converter)
    return code


def _convert_dxf(source: pathlib.Path, dxf_path: pathlib.Path, out_dir: pathlib.Path, args, converter_name: str | None) -> int:
    try:
        import ezdxf
        from ezdxf.addons.drawing import Frontend, RenderContext
        from ezdxf.addons.drawing.config import ColorPolicy, Configuration
        from ezdxf.addons.drawing.layout import Margins, Page, Settings
        from ezdxf.addons.drawing.svg import SVGBackend
        from ezdxf.bbox import extents
    except ImportError:
        return _fail(EXIT_ENV, "缺少 ezdxf：pip install ezdxf")

    document = ezdxf.readfile(str(dxf_path))
    modelspace = document.modelspace()

    dropped = {"layer": 0, "dimension": 0, "text": 0}
    pattern = re.compile("|".join(args.drop_pattern)) if args.drop_pattern else None
    kept: dict[str, int] = {}

    for entity in list(modelspace):
        layer = str(entity.dxf.get("layer", "0"))
        kind = entity.dxftype()
        reason = None
        if layer in args.drop_layer or (pattern is not None and pattern.search(layer)):
            reason = "layer"
        elif kind == "DIMENSION":
            reason = "dimension"
        elif kind in DEFAULT_TEXT_TYPES and not args.keep_text:
            reason = "text"
        if reason is None:
            kept[layer] = kept.get(layer, 0) + 1
            continue
        dropped[reason] += 1
        modelspace.delete_entity(entity)

    if not kept:
        return _fail(EXIT_CONVERT, "清理后没有保留任何实体，检查 --drop-layer 与 --drop-pattern")

    bounds = extents(modelspace)
    margin = 2.0
    page = Page(
        width=max(bounds.size.x, 1.0) + margin * 2,
        height=max(bounds.size.y, 1.0) + margin * 2,
        margins=Margins(top=margin, right=margin, bottom=margin, left=margin),
    )

    backend = SVGBackend()
    config = Configuration(color_policy=ColorPolicy.BLACK)
    Frontend(RenderContext(document), backend, config=config).draw_layout(modelspace, finalize=True)
    svg = backend.get_string(page, settings=Settings(fit_page=True))
    svg_path = out_dir / "model.svg"
    svg_path.write_text(svg, encoding="utf-8")

    layers = [
        {"name": layer.dxf.name, "entities": kept.get(layer.dxf.name, 0), "kept": layer.dxf.name in kept}
        for layer in document.layers
    ]
    (out_dir / "layers.json").write_text(
        json.dumps(layers, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    record = {
        "input": str(source),
        "case": args.case or source.parent.name,
        "route": "dxf",
        "sha256": _sha256(source),
        "converter": converter_name,
        "ezdxf": getattr(__import__("ezdxf"), "__version__", None),
        "dropped": dropped,
        "keptLayers": kept,
        "outputs": [svg_path.name, "layers.json"],
        "cleaning": "automatic",
    }
    _write_record(out_dir, record)
    print(f"OK {source.name} → {svg_path}（删除 图层 {dropped['layer']} / 尺寸 {dropped['dimension']} / 文字 {dropped['text']}）")
    return EXIT_OK


def _route_pdf(source: pathlib.Path, out_dir: pathlib.Path, case: str) -> int:
    tool = shutil.which("pdftocairo")
    if tool is None:
        return _fail(EXIT_ENV, "缺少 pdftocairo：安装 poppler-utils 后重跑")
    svg_path = out_dir / "model.svg"
    result = subprocess.run(
        [tool, "-svg", str(source), str(svg_path)],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0 or not svg_path.exists():
        return _fail(EXIT_CONVERT, f"pdftocairo 失败（退出码 {result.returncode}）：{result.stderr.strip()[:400]}")

    record = {
        "input": str(source),
        "case": case,
        "route": "pdf",
        "sha256": _sha256(source),
        "converter": tool,
        "dropped": {"layer": 0, "dimension": 0, "text": 0},
        "outputs": sorted(path.name for path in out_dir.glob("*.svg")),
        "cleaning": "manual",
    }
    _write_record(out_dir, record)
    print(f"OK {source.name} → {svg_path}（PDF 路径无图层，尺寸与图框需人工清理）")
    return EXIT_OK


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="客户图纸 → 可清理 SVG")
    parser.add_argument("--input", required=True, help="DWG / DXF / PDF 路径")
    parser.add_argument("--case", default=None, help="案件编号，缺省取输入文件上级目录名")
    parser.add_argument("--out", default=None, help="输出目录，缺省 out/<case>/converted")
    parser.add_argument("--drop-layer", action="append", default=[], help="按图层名精确删除，可重复")
    parser.add_argument("--drop-pattern", action="append", default=[], help="按图层名正则删除，可重复")
    parser.add_argument("--keep-text", action="store_true", help="保留 TEXT/MTEXT（默认删除）")
    return parser.parse_args(argv)


def _sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_record(out_dir: pathlib.Path, record: dict) -> None:
    (out_dir / "convert.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _fail(code: int, message: str) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
