"""清单生成与参数摘要（纯 Python）。"""

from __future__ import annotations

import hashlib
import json
import pathlib


def params_digest(params: dict) -> str:
    """返回参数对象的规范化 SHA-256，用于比对两次构建是否同参数。

    @param params - 参数名到数值的字典。
    @returns 十六进制摘要。
    """
    canonical = json.dumps(params, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def make_manifest(
    *,
    spec: dict,
    bbox_mm: list[float],
    volume_mm3: float,
    formats: list[str],
    files: list[str],
    freecad_version: str,
    started_at: str,
    duration_seconds: float,
) -> dict:
    """组装构建清单。

    @param spec - load_params 返回的规范化参数表。
    @param bbox_mm - 包围盒三向尺寸，毫米。
    @param volume_mm3 - 几何体积，立方毫米。
    @param formats - 实际导出的格式。
    @param files - 导出的文件名（相对变体目录）。
    @param freecad_version - 运行时的 FreeCAD 版本。
    @param started_at - 构建开始时间，ISO 8601。
    @param duration_seconds - 构建总耗时。
    @returns 可序列化为 JSON 的清单字典。
    """
    return {
        "part": spec["part"],
        "variant": spec["variant"],
        "params": spec["params"],
        "paramsDigest": params_digest(spec["params"]),
        "freecad": freecad_version,
        "bboxMm": [round(value, 6) for value in bbox_mm],
        "volumeMm3": round(volume_mm3, 6),
        "formats": formats,
        "files": files,
        "startedAt": started_at,
        "durationSeconds": round(duration_seconds, 3),
    }


def write_manifest(path: str | pathlib.Path, manifest: dict) -> None:
    """把清单写入文件，UTF-8、两空格缩进、结尾单个换行。

    @param path - 清单路径。
    @param manifest - make_manifest 的返回值。
    """
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    pathlib.Path(path).write_text(text, encoding="utf-8")
