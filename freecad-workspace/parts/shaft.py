"""阶梯轴：多段同轴圆柱沿 Z 轴堆叠。

参数（毫米）：
D1/L1、D2/L2、D3/L3（三段直径与长度，从 Z=0 起依次堆叠），
D_MAX（最大直径，用于包围盒断言）、L（总长度，= L1+L2+L3）。
"""

from __future__ import annotations

import math

import FreeCAD as App
import Part

SIZE_KEYS = {"D_MAX": [0, 1], "L": 2}

LABELS = {
    "D1": "第一段直径",
    "L1": "第一段长度",
    "D2": "第二段直径",
    "L2": "第二段长度",
    "D3": "第三段直径",
    "L3": "第三段长度",
    "D_MAX": "最大直径",
    "L": "总长",
}

SEGMENTS = (("D1", "L1"), ("D2", "L2"), ("D3", "L3"))

_TOLERANCE = 1e-6


def build(params: dict) -> Part.Shape:
    """按参数生成阶梯轴几何。

    @param params - 参数名到数值的字典，键见模块文档。
    @returns 阶梯轴实体形状。
    @throws ValueError - 参数缺失、非正或 D_MAX/L 与分段不一致。
    """
    p = normalize(params)
    segments = _segments(p)
    cylinders = []
    offset = 0.0
    for diameter, length in segments:
        cyl = Part.makeCylinder(diameter / 2, length)
        cyl.translate(App.Vector(0, 0, offset))
        cylinders.append(cyl)
        offset += length
    return cylinders[0].multiFuse(cylinders[1:]) if len(cylinders) > 1 else cylinders[0]


def expected_volume(params: dict) -> float:
    """返回参数对应的解析体积。"""
    p = normalize(params)
    return sum(math.pi / 4 * d ** 2 * l for d, l in _segments(p))


def normalize(params: dict) -> dict:
    """校验并规范化参数。

    @throws ValueError - 任一约束不满足。
    """
    for diameter_key, length_key in SEGMENTS:
        if diameter_key not in params or length_key not in params:
            raise ValueError(f"阶梯轴缺少分段参数：{diameter_key}/{length_key}")

    p = {}
    for diameter_key, length_key in SEGMENTS:
        d = float(params[diameter_key])
        l = float(params[length_key])
        if d <= 0:
            raise ValueError(f"{diameter_key} 必须为正，实际为 {d}")
        if l <= 0:
            raise ValueError(f"{length_key} 必须为正，实际为 {l}")
        p[diameter_key] = d
        p[length_key] = l

    d_max = float(params["D_MAX"])
    total = float(params["L"])
    if d_max <= 0:
        raise ValueError(f"D_MAX 必须为正，实际为 {d_max}")
    if total <= 0:
        raise ValueError(f"L 必须为正，实际为 {total}")
    p["D_MAX"] = d_max
    p["L"] = total

    computed_max = max(p[f"D{i}"] for i in range(1, 4))
    computed_total = sum(p[f"L{i}"] for i in range(1, 4))
    if abs(d_max - computed_max) > _TOLERANCE:
        raise ValueError(f"D_MAX={d_max} 与分段最大直径 {computed_max} 不一致")
    if abs(total - computed_total) > _TOLERANCE:
        raise ValueError(f"L={total} 与分段长度之和 {computed_total} 不一致")
    return p


def _segments(p: dict) -> list[tuple[float, float]]:
    return [(p[f"D{i}"], p[f"L{i}"]) for i in range(1, 4)]
