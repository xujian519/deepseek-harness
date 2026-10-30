"""参数表加载与校验（纯 Python，不导入 FreeCAD）。

参数表字段：part、variant、params、outputs，可选 description。
"""

from __future__ import annotations

import json
import math
import pathlib
import re

REQUIRED_KEYS = ("part", "variant", "params", "outputs")
ALLOWED_KEYS = frozenset(REQUIRED_KEYS) | {"description"}
OUTPUT_FORMATS = frozenset({"step", "stl"})
_PART_NAME = re.compile(r"^[a-z0-9_]+$")


class ParamsError(ValueError):
    """参数表不符合约定。"""


def load_params(path: str | pathlib.Path) -> dict:
    """读取并校验参数表，返回规范化后的字典。

    @param path - 参数表 JSON 路径。
    @returns 含 part、variant、params、outputs 与可选 description 的字典。
    @throws ParamsError - 文件缺失、JSON 非法或字段不符合约定。
    """
    file = pathlib.Path(path)
    try:
        raw = json.loads(file.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ParamsError(f"参数表不存在：{file}") from error
    except json.JSONDecodeError as error:
        raise ParamsError(
            f"参数表不是合法 JSON：{file}（第 {error.lineno} 行第 {error.colno} 列）"
        ) from error

    if not isinstance(raw, dict):
        raise ParamsError("参数表必须是 JSON 对象")

    unknown = set(raw) - ALLOWED_KEYS
    if unknown:
        raise ParamsError(f"参数表含未知字段：{sorted(unknown)}")
    missing = [key for key in REQUIRED_KEYS if key not in raw]
    if missing:
        raise ParamsError(f"参数表缺少字段：{missing}")

    part = raw["part"]
    if not isinstance(part, str) or not _PART_NAME.match(part):
        raise ParamsError("part 必须是由小写字母、数字或下划线组成的非空字符串")

    variant = raw["variant"]
    if (
        not isinstance(variant, str)
        or not variant
        or "/" in variant
        or "\\" in variant
        or variant in {".", ".."}
    ):
        raise ParamsError("variant 必须是非空文件名片段，不能包含路径分隔符")

    params = raw["params"]
    if not isinstance(params, dict) or not params:
        raise ParamsError("params 必须是非空对象")
    for key, value in params.items():
        if not isinstance(key, str) or not key:
            raise ParamsError("params 的键必须是非空字符串")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ParamsError(f"params.{key} 必须是数值，实际为 {type(value).__name__}")
        if not math.isfinite(value):
            raise ParamsError(f"params.{key} 必须是有限数值")

    outputs = raw["outputs"]
    if not isinstance(outputs, list) or not outputs:
        raise ParamsError("outputs 必须是非空数组")
    for name in outputs:
        if name not in OUTPUT_FORMATS:
            raise ParamsError(
                f"outputs 含不支持的格式：{name!r}；仅支持 {sorted(OUTPUT_FORMATS)}"
            )

    return {
        "part": part,
        "variant": variant,
        "params": dict(params),
        "outputs": list(outputs),
        "description": raw.get("description"),
    }
