"""法兰：外圆环体 + 中心通孔 + 螺栓孔圆周阵列。

参数（毫米 / 个数）：
OD（外径）、ID（中心孔径）、T（厚度）、BCD（螺栓孔节圆直径）、
BOLT_D（螺栓孔径）、N_BOLTS（螺栓孔数）。
"""

from __future__ import annotations

import math

import FreeCAD as App
import Part

SIZE_KEYS = {"OD": [0, 1], "T": 2}

LABELS = {
    "OD": "外径",
    "ID": "中心孔径",
    "T": "法兰厚度",
    "BCD": "螺栓孔节圆直径",
    "BOLT_D": "螺栓孔径",
    "N_BOLTS": "螺栓孔数",
}

REQUIRED = ("OD", "ID", "T", "BCD", "BOLT_D", "N_BOLTS")

_TOLERANCE = 1e-6


def build(params: dict) -> Part.Shape:
    """按参数生成法兰几何。

    @param params - 参数名到数值的字典，键见模块文档。
    @returns 法兰实体形状。
    @throws ValueError - 参数缺失、非正、螺栓孔超出外径或孔径超过节圆。
    """
    p = normalize(params)
    shape = _ring(p["OD"], p["ID"], p["T"])

    if p["N_BOLTS"] > 0:
        radius = p["BOLT_D"] / 2
        bolt = Part.makeCylinder(radius, p["T"] + 2, App.Vector(0, 0, -1))
        bolts = []
        for index in range(p["N_BOLTS"]):
            angle = 2 * math.pi * index / p["N_BOLTS"]
            x = p["BCD"] / 2 * math.cos(angle)
            y = p["BCD"] / 2 * math.sin(angle)
            bolts.append(bolt.copy())
            bolts[-1].translate(App.Vector(x, y, 0))
        shape = shape.cut(bolts[0] if len(bolts) == 1 else Part.makeCompound(bolts))

    return shape


def expected_volume(params: dict) -> float:
    """返回参数对应的解析体积。"""
    p = normalize(params)
    ring = math.pi / 4 * (p["OD"] ** 2 - p["ID"] ** 2) * p["T"]
    bolts = p["N_BOLTS"] * math.pi * (p["BOLT_D"] / 2) ** 2 * p["T"]
    return ring - bolts


def normalize(params: dict) -> dict:
    """校验并规范化参数。

    @throws ValueError - 任一约束不满足。
    """
    missing = [key for key in REQUIRED if key not in params]
    if missing:
        raise ValueError(f"法兰缺少参数：{missing}")

    p = {key: float(params[key]) for key in ("OD", "ID", "T", "BCD", "BOLT_D")}
    for key in ("OD", "ID", "T", "BCD", "BOLT_D"):
        if p[key] <= 0:
            raise ValueError(f"{key} 必须为正，实际为 {p[key]}")
    if p["ID"] >= p["OD"]:
        raise ValueError(f"中心孔径 {p['ID']} 必须小于外径 {p['OD']}")

    n_bolts = float(params["N_BOLTS"])
    if n_bolts < 0 or abs(n_bolts - round(n_bolts)) > _TOLERANCE:
        raise ValueError(f"N_BOLTS 必须是非负整数，实际为 {params['N_BOLTS']}")
    p["N_BOLTS"] = int(round(n_bolts))

    bolt_edge = p["BCD"] / 2 + p["BOLT_D"] / 2
    if bolt_edge > p["OD"] / 2:
        raise ValueError(
            f"螺栓孔越出法兰：节圆外缘 {bolt_edge:.2f} mm > 外径半 {p['OD'] / 2:.2f} mm"
        )
    if p["BCD"] / 2 - p["BOLT_D"] / 2 < p["ID"] / 2:
        raise ValueError("螺栓孔与中心孔相交，需增大 BCD 或减小 BOLT_D")

    return p


def _ring(outer: float, inner: float, height: float) -> Part.Shape:
    outer_cyl = Part.makeCylinder(outer / 2, height)
    inner_cyl = Part.makeCylinder(inner / 2, height)
    return outer_cyl.cut(inner_cyl)
