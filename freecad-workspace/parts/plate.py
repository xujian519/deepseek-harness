"""板类件：矩形板 + 矩形阵列通孔 + 可选外角圆角。

参数（毫米 / 个数）：
L、W、T、HOLE_D、EDGE_M、N_HOLES_X、N_HOLES_Y、FILLET_R（可选，缺省 0）。
"""

from __future__ import annotations

import math

import FreeCAD as App
import Part

SIZE_KEYS = {"L": 0, "W": 1, "T": 2}

LABELS = {
    "L": "总长",
    "W": "总宽",
    "T": "板厚",
    "HOLE_D": "孔径",
    "EDGE_M": "边距",
    "N_HOLES_X": "X 向孔数",
    "N_HOLES_Y": "Y 向孔数",
    "FILLET_R": "外角圆角",
}

REQUIRED = ("L", "W", "T", "HOLE_D", "EDGE_M", "N_HOLES_X", "N_HOLES_Y")

_TOLERANCE = 1e-6


def build(params: dict) -> Part.Shape:
    """按参数生成板类件几何。

    @param params - 参数名到数值的字典，键见模块文档。
    @returns 板的实体形状。
    @throws ValueError - 参数缺失、非正、孔阵装不下或圆角半径越界。
    """
    p = normalize(params)
    shape = Part.makeBox(p["L"], p["W"], p["T"])

    xs = _grid(p["L"], p["N_HOLES_X"], p["EDGE_M"], p["HOLE_D"])
    ys = _grid(p["W"], p["N_HOLES_Y"], p["EDGE_M"], p["HOLE_D"])
    if xs and ys:
        radius = p["HOLE_D"] / 2
        cutters = [
            Part.makeCylinder(radius, p["T"] + 2, App.Vector(x, y, -1))
            for x in xs
            for y in ys
        ]
        shape = shape.cut(cutters[0] if len(cutters) == 1 else Part.makeCompound(cutters))

    if p["FILLET_R"] > 0:
        edges = _outer_vertical_edges(shape, p)
        if not edges:
            raise ValueError("未找到可倒圆的外轮廓竖边，检查特征顺序")
        shape = shape.makeFillet(p["FILLET_R"], edges)

    return shape


def expected_volume(params: dict) -> float:
    """返回参数对应的解析体积，用于构建后比对。

    @param params - 参数名到数值的字典。
    @returns 体积，立方毫米。
    """
    p = normalize(params)
    base = p["L"] * p["W"] * p["T"]
    hole_count = p["N_HOLES_X"] * p["N_HOLES_Y"]
    holes = hole_count * math.pi * (p["HOLE_D"] / 2) ** 2 * p["T"]
    radius = p["FILLET_R"]
    corners = 4 * (radius ** 2 - math.pi * radius ** 2 / 4) * p["T"] if radius > 0 else 0.0
    return base - holes - corners


def normalize(params: dict) -> dict:
    """校验并规范化参数，返回纯数值字典。

    @param params - 参数名到数值的字典。
    @returns 规范化后的参数字典，数量类为整型。
    @throws ValueError - 任一约束不满足。
    """
    missing = [key for key in REQUIRED if key not in params]
    if missing:
        raise ValueError(f"板类件缺少参数：{missing}")

    p = {
        "L": float(params["L"]),
        "W": float(params["W"]),
        "T": float(params["T"]),
        "HOLE_D": float(params["HOLE_D"]),
        "EDGE_M": float(params["EDGE_M"]),
        "FILLET_R": float(params.get("FILLET_R", 0.0)),
    }
    for key in ("L", "W", "T", "HOLE_D"):
        if p[key] <= 0:
            raise ValueError(f"{key} 必须为正，实际为 {p[key]}")

    for key in ("N_HOLES_X", "N_HOLES_Y"):
        value = float(params[key])
        if value < 0 or abs(value - round(value)) > _TOLERANCE:
            raise ValueError(f"{key} 必须是非负整数，实际为 {params[key]}")
        p[key] = int(round(value))

    if p["EDGE_M"] <= 0:
        raise ValueError(f"EDGE_M 必须为正，实际为 {p['EDGE_M']}")

    needed = p["HOLE_D"] / 2
    if p["EDGE_M"] < needed:
        raise ValueError(
            f"边距 {p['EDGE_M']} mm 小于孔半径 {needed} mm，孔会越出板边"
        )

    for axis, key in (("L", "N_HOLES_X"), ("W", "N_HOLES_Y")):
        count = p[key]
        span = p[axis] - 2 * p["EDGE_M"]
        if count > 1 and span <= 0:
            raise ValueError(f"{axis} 方向边距过大，孔阵无空间")
        if count > 1:
            pitch = span / (count - 1)
            if pitch < p["HOLE_D"]:
                raise ValueError(
                    f"{key}={count} 时孔距 {pitch:.2f} mm 小于孔径 {p['HOLE_D']} mm，孔会重叠"
                )

    if p["FILLET_R"] > 0:
        limit = min(p["EDGE_M"], p["T"] / 2)
        if p["FILLET_R"] > limit:
            raise ValueError(f"FILLET_R 必须不大于 {limit:.2f} mm")

    return p


def _grid(length: float, count: int, margin: float, hole_d: float) -> list[float]:
    """返回孔心在一个方向上的坐标，单孔居中，多孔从边距起等距。"""
    if count <= 0:
        return []
    if count == 1:
        return [length / 2]
    step = (length - 2 * margin) / (count - 1)
    return [margin + index * step for index in range(count)]


def _outer_vertical_edges(shape: Part.Shape, p: dict) -> list[Part.Edge]:
    """挑出板四条外轮廓的竖边，排除孔壁与顶面的边。"""
    result = []
    for edge in shape.Edges:
        first, last = edge.Vertexes[0], edge.Vertexes[-1]
        vertical = (
            abs(first.X - last.X) < _TOLERANCE
            and abs(first.Y - last.Y) < _TOLERANCE
            and abs(abs(first.Z - last.Z) - p["T"]) < _TOLERANCE
        )
        if not vertical:
            continue
        on_x = min(abs(first.X), abs(first.X - p["L"])) < _TOLERANCE
        on_y = min(abs(first.Y), abs(first.Y - p["W"])) < _TOLERANCE
        if on_x and on_y:
            result.append(edge)
    return result
