"""校验输出目录中的构建产物。

用法：FreeCADCmd scripts/validate.py --out out/plate
"""

from __future__ import annotations

import argparse
import importlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from common.manifest import params_digest

EXIT_OK = 0
EXIT_PARAMS = 2
EXIT_GEOMETRY = 3
EXIT_ENV = 5

BBOX_TOLERANCE_MM = 0.1
VOLUME_REL_TOLERANCE = 0.001


def main(argv: list[str] | None = None) -> int:
    """校验目录内的全部变体。

    @param argv - 命令行参数，缺省取 sys.argv。
    @returns 进程退出码，见 README。
    """
    parser = argparse.ArgumentParser(description="校验构建产物")
    parser.add_argument("--out", required=True, help="包含 manifest.json 的目录")
    args = parser.parse_args(argv)

    target = pathlib.Path(args.out).expanduser().resolve()
    if not target.is_dir():
        print(f"ERROR: 目录不存在：{target}", file=sys.stderr)
        return EXIT_PARAMS

    try:
        import FreeCAD as App  # noqa: F401  仅为确认运行环境
        import Mesh
        import Part
    except ImportError:
        print("ERROR: 未找到 FreeCAD 模块：必须用 FreeCADCmd 运行本脚本", file=sys.stderr)
        return EXIT_ENV

    manifests = sorted(target.rglob("manifest.json"))
    if not manifests:
        print(f"ERROR: {target} 下没有 manifest.json", file=sys.stderr)
        return EXIT_PARAMS

    failures = 0
    for manifest_path in manifests:
        failures += _check_variant(manifest_path.parent, json.loads(manifest_path.read_text(encoding="utf-8")))

    if failures:
        print(f"FAIL {failures} 个变体未通过")
        return EXIT_GEOMETRY
    print(f"PASS {len(manifests)} 个变体")
    return EXIT_OK


def _check_variant(base: pathlib.Path, manifest: dict) -> int:
    label = f"{manifest.get('part')}/{manifest.get('variant')}"
    problems: list[str] = []

    if manifest.get("paramsDigest") != params_digest(manifest.get("params", {})):
        problems.append("paramsDigest 与 params 不一致")

    for name in manifest.get("files", []):
        path = base / name
        if not path.exists() or path.stat().st_size == 0:
            problems.append(f"文件缺失或为空：{name}")

    step_path = base / "model.step"
    if "step" in manifest.get("formats", []) and step_path.exists():
        shape = Part.read(str(step_path))
        if not shape.isValid():
            problems.append("重新导入的 STEP 几何无效")
        if shape.Volume <= 0:
            problems.append(f"重新导入的 STEP 体积非正：{shape.Volume}")
        expected = float(manifest.get("volumeMm3", 0))
        if expected > 0:
            delta = abs(shape.Volume - expected) / expected
            if delta > VOLUME_REL_TOLERANCE:
                problems.append(
                    f"STEP 体积偏差 {delta:.4%}：实际 {shape.Volume:.3f}，清单 {expected:.3f}"
                )
        problems.extend(_check_bbox(step_path, shape, manifest))

    stl_path = base / "model.stl"
    if "stl" in manifest.get("formats", []) and stl_path.exists():
        mesh = Mesh.Mesh(str(stl_path))
        if mesh.CountFacets <= 0:
            problems.append("STL 三角面数为 0")

    if problems:
        for problem in problems:
            print(f"FAIL {label}: {problem}")
        return 1
    print(f"OK   {label}")
    return 0


def _check_bbox(step_path: pathlib.Path, shape, manifest: dict) -> list[str]:
    params = manifest.get("params", {})
    part = manifest.get("part")
    try:
        builder = importlib.import_module(f"parts.{part}")
    except ImportError:
        return [f"找不到零件族构建器 parts/{part}.py，无法核对包围盒"]

    problems: list[str] = []
    bbox = shape.BoundBox
    actual = [bbox.XLength, bbox.YLength, bbox.ZLength]
    for key, axis in builder.SIZE_KEYS.items():
        want = float(params[key])
        if abs(actual[axis] - want) > BBOX_TOLERANCE_MM:
            problems.append(
                f"{step_path.name} 包围盒 {key}：实际 {actual[axis]:.3f}，期望 {want:.3f}"
            )
    return problems


if __name__ == "__main__":
    raise SystemExit(main())
