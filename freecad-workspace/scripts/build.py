"""构建零件并导出。

用法：FreeCADCmd scripts/build.py --pass params/plate-100x60.json [--out <dir>] [--formats step,stl]
"""

from __future__ import annotations

import argparse
import importlib
import pathlib
import sys
import time
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from common.manifest import make_manifest, write_manifest
from common.params import OUTPUT_FORMATS, ParamsError, load_params

EXIT_OK = 0
EXIT_PARAMS = 2
EXIT_GEOMETRY = 3
EXIT_EXPORT = 4
EXIT_ENV = 5

BBOX_TOLERANCE_MM = 0.1
VOLUME_REL_TOLERANCE = 0.001


class GeometryError(RuntimeError):
    """构建结果不满足几何断言。"""


def main(argv: list[str] | None = None) -> int:
    """执行一次构建。

    @param argv - 命令行参数，缺省取 sys.argv。
    @returns 进程退出码，见 README。
    """
    args = _parse_args(argv)
    started_at = datetime.now().astimezone().isoformat(timespec="seconds")
    started = time.monotonic()

    try:
        spec = load_params(args.params_file)
    except ParamsError as error:
        return _fail(EXIT_PARAMS, str(error), None)

    try:
        formats = _resolve_formats(args.formats, spec["outputs"])
    except ParamsError as error:
        return _fail(EXIT_PARAMS, str(error), None)

    out_dir = (
        pathlib.Path(args.out).expanduser().resolve()
        if args.out
        else ROOT / "out" / spec["part"] / spec["variant"]
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        import FreeCAD as App
        import MeshPart
        import Part
    except ImportError:
        return _fail(EXIT_ENV, "未找到 FreeCAD 模块：必须用 FreeCADCmd 运行本脚本", out_dir)

    try:
        builder = importlib.import_module(f"parts.{spec['part']}")
    except ImportError as error:
        return _fail(EXIT_PARAMS, f"找不到零件族构建器 parts/{spec['part']}.py（{error}）", out_dir)

    _log(out_dir, f"参数摘要 {spec['part']}/{spec['variant']}：{spec['params']}")
    try:
        shape = builder.build(spec["params"])
    except ValueError as error:
        return _fail(EXIT_PARAMS, str(error), out_dir)
    except Exception as error:
        return _fail(EXIT_GEOMETRY, f"构建抛出 {type(error).__name__}：{error}", out_dir)

    document = App.newDocument(f"{spec['part']}-{spec['variant']}")
    obj = document.addObject("Part::Feature", "Model")
    obj.Shape = shape
    document.recompute()

    try:
        _assert_geometry(shape, spec["params"], builder)
    except GeometryError as error:
        return _fail(EXIT_GEOMETRY, str(error), out_dir)

    files: list[str] = []
    try:
        document.saveAs(str(out_dir / "model.FCStd"))
        _require_nonempty(out_dir / "model.FCStd")
        files.append("model.FCStd")
        if "step" in formats:
            step_path = out_dir / "model.step"
            Part.export([obj], str(step_path))
            _require_nonempty(step_path)
            files.append(step_path.name)
        if "stl" in formats:
            stl_path = out_dir / "model.stl"
            mesh = MeshPart.meshFromShape(
                Shape=shape,
                LinearDeflection=0.1,
                AngularDeflection=0.5,
                Relative=False,
            )
            mesh.write(str(stl_path))
            _require_nonempty(stl_path)
            files.append(stl_path.name)
    except Exception as error:
        return _fail(EXIT_EXPORT, f"导出失败：{type(error).__name__}：{error}", out_dir)

    bbox = shape.BoundBox
    manifest = make_manifest(
        spec=spec,
        bbox_mm=[bbox.XLength, bbox.YLength, bbox.ZLength],
        volume_mm3=shape.Volume,
        formats=formats,
        files=files,
        freecad_version=".".join(App.Version()[:3]),
        started_at=started_at,
        duration_seconds=time.monotonic() - started,
    )
    write_manifest(out_dir / "manifest.json", manifest)
    _log(out_dir, f"OK {spec['part']}/{spec['variant']} → {out_dir}")
    return EXIT_OK


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按参数表构建零件并导出")
    parser.add_argument("--pass", dest="params_file", required=True, help="参数表 JSON 路径")
    parser.add_argument("--out", default=None, help="输出目录，缺省 out/<part>/<variant>")
    parser.add_argument("--formats", default=None, help="逗号分隔的导出格式，缺省取参数表 outputs")
    return parser.parse_args(argv)


def _resolve_formats(raw: str | None, defaults: list[str]) -> list[str]:
    if raw is None:
        return list(dict.fromkeys(defaults))
    formats = [item.strip() for item in raw.split(",") if item.strip()]
    if not formats:
        raise ParamsError("--formats 不能为空")
    unknown = [item for item in formats if item not in OUTPUT_FORMATS]
    if unknown:
        raise ParamsError(f"--formats 含不支持的格式：{unknown}")
    return list(dict.fromkeys(formats))


def _assert_geometry(shape, params: dict, builder) -> None:
    if not shape.isValid():
        raise GeometryError("几何无效：Shape.isValid() 为假")
    if shape.Volume <= 0:
        raise GeometryError(f"体积非正：{shape.Volume}")

    expected = builder.expected_volume(params) if hasattr(builder, "expected_volume") else None
    if expected and expected > 0:
        delta = abs(shape.Volume - expected) / expected
        if delta > VOLUME_REL_TOLERANCE:
            raise GeometryError(
                f"体积与参数不符：实际 {shape.Volume:.3f}，期望 {expected:.3f}，偏差 {delta:.4%}"
            )

    bbox = shape.BoundBox
    actual = [bbox.XLength, bbox.YLength, bbox.ZLength]
    for key, axes in builder.SIZE_KEYS.items():
        want = float(params[key])
        axes = axes if isinstance(axes, (list, tuple)) else (axes,)
        for axis in axes:
            if abs(actual[axis] - want) > BBOX_TOLERANCE_MM:
                raise GeometryError(
                    f"包围盒 {key}（轴 {axis}）与参数不符：实际 {actual[axis]:.3f}，期望 {want:.3f}"
                )


def _require_nonempty(path: pathlib.Path) -> None:
    if not path.exists() or path.stat().st_size == 0:
        raise RuntimeError(f"未产出文件或文件为空：{path}")


def _log(out_dir: pathlib.Path | None, message: str) -> None:
    print(message)
    if out_dir is not None:
        with (out_dir / "build.log").open("a", encoding="utf-8") as handle:
            handle.write(message + "\n")


def _fail(code: int, message: str, out_dir: pathlib.Path | None) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    _log(out_dir, f"ERROR: {message}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
