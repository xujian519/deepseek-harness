"""L 形支架：底板 + 立板 + 底板安装孔。

参数（毫米）：
L（X 向总长）、W（Y 向总宽）、H（Z 向总高）、T（底板厚）、
TV（立板厚）、HOLE_D（底板孔径）、HOLE_X/HOLE_Y（孔心坐标）。
"""

from __future__ import annotations

import math

import FreeCAD as App
import Part

SIZE_KEYS = {"L": 0, "W": 1, "H": 2}

LABELS = {
    "L": "总长",
    "W": "总宽",
    "H": "总高",
    "T": "底板厚度",
    "TV": "立板厚度",
    "HOLE_D": "底板孔径",
    "HOLE_X": "孔心 X",
    "HOLE_Y": "孔心 Y",
}

REQUIRED = ("L", "W", "H", "T", "TV", "HOLE_D", "HOLE_X", "HOLE_Y")

_TOLERANCE = 1e-6


def build(params: dict) -> Part.Shape:
    """按参数生成 L 形支架几何。

    @param params - 参数名到数值的字典，键见模块文档。
    @returns 支架实体形状。
    @throws ValueError - 参数缺失、非正或几何冲突。
    """
    p = normalize(params)

    base = Part.makeBox(p["L"], p["W"], p["T"])
    vertical = Part.makeBox(p["L"], p["TV"], p["H"] - p["T"])
    vertical.translate(App.Vector(0, p["W"] - p["TV"], p["T"]))
    shape = base.fuse(vertical)

    if p["HOLE_D"] > 0:
        hole = Part.makeCylinder(p["HOLE_D"] / 2, p["T"] + 2, App.Vector(p["HOLE_X"], p["HOLE_Y"], -1))
        shape = shape.cut(hole)

    return shape


def expected_volume(params: dict) -> float:
    """返回参数对应的解析体积。"""
    p = normalize(params)
    base = p["L"] * p["W"] * p["T"]
    vertical = p["L"] * p["TV"] * (p["H"] - p["T"])
    hole = math.pi * (p["HOLE_D"] / 2) ** 2 * p["T"] if p["HOLE_D"] > 0 else 0.0
    return base + vertical - hole


def normalize(params: dict) -> dict:
    """校验并规范化参数。

    @throws ValueError - 任一约束不满足。
    """
    missing = [key for key in REQUIRED if key not in params]
    if missing:
        raise ValueError(f"支架缺少参数：{missing}")

    p = {key: float(params[key]) for key in REQUIRED}
    for key in ("L", "W", "H", "T", "TV"):
        if p[key] <= 0:
            raise ValueError(f"{key} 必须为正，实际为 {p[key]}")
    if p["H"] <= p["T"]:
        raise ValueError(f"总高 H={p['H']} 必须大于底板厚 T={p['T']}")
    if p["TV"] >= p["W"]:
        raise ValueError(f"立板厚 TV={p['TV']} 必须小于总宽 W={p['W']}")

    if p["HOLE_D"] < 0:
        raise ValueError(f"HOLE_D 不能为负，实际为 {p['HOLE_D']}")
    if p["HOLE_D"] > 0:
        if p["HOLE_X"] - p["HOLE_D"] / 2 < 0 or p["HOLE_X"] + p["HOLE_D"] / 2 > p["L"]:
            raise ValueError("底板孔在 X 方向越出底板")
        if p["HOLE_Y"] - p["HOLE_D"] / 2 < 0 or p["HOLE_Y"] + p["HOLE_D"] / 2 > p["W"]:
            raise ValueError("底板孔在 Y 方向越出底板")
        if p["HOLE_Y"] + p["HOLE_D"] / 2 > p["W"] - p["TV"] + _TOLERANCE:
            raise ValueError("底板孔与立板重叠，需调整 HOLE_Y 或 TV")
    return p
