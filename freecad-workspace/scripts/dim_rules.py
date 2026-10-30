"""标注规则库：把“语义尺寸”映射到投影视图的边引用。

本模块不导入 FreeCAD，边以鸭子类型传入（需要 Vertexes 与 Curve），便于离线测试。
所有引用均以 TechDraw 的 `EdgeN` 序号表示，序号与 `view.getVisibleEdges()` 的顺序一一对应。
"""

from __future__ import annotations

import math

TOLERANCE = 1e-4

RULES = ("overall_x", "overall_y", "hole_dia", "pitch_dia", "thickness")

# 规则 → 投影视图。板类件：俯视图出长宽与孔径，主视图出厚度。
RULE_VIEWS = {
    "overall_x": "Top",
    "overall_y": "Top",
    "hole_dia": "Top",
    "pitch_dia": "Top",
    "thickness": "Front",
}

PARAM_KEYS = {
    "overall_x": "L",
    "overall_y": "W",
    "hole_dia": "HOLE_D",
    "thickness": "T",
}


def select(rule: str, edges: list[tuple[int, object]], params: dict) -> dict:
    """按规则挑选边引用。

    @param rule - RULES 之一。
    @param edges - (EdgeN 序号, 投影边) 列表，序号从 1 开始。
    @param params - 参数表数值。
    @returns 含 rule、status（ok / manual）、edges、value、reason 的字典。
    """
    if rule not in RULES:
        raise ValueError(f"未知标注规则：{rule}")
    if rule == "overall_x":
        return _overall(edges, "x", rule, params)
    if rule == "overall_y":
        return _overall(edges, "y", rule, params)
    if rule == "hole_dia":
        return _hole_diameter(edges, params)
    if rule == "thickness":
        return _thickness(edges, params)
    return {
        "rule": rule,
        "status": "manual",
        "edges": [],
        "value": None,
        "reason": "节圆直径尚未实现：需要按圆心共圆分组后再生成尺寸",
    }


def _manual(rule: str, reason: str, edges: list[int] | None = None) -> dict:
    return {
        "rule": rule,
        "status": "manual",
        "edges": edges or [],
        "value": None,
        "reason": reason,
    }


def _overall(edges: list[tuple[int, object]], axis: str, rule: str, params: dict) -> dict:
    """取沿指定轴跨度最大、且另一轴无偏移的边。"""
    best: tuple[float, int] | None = None
    for number, edge in edges:
        points = _endpoints(edge)
        if points is None:
            continue
        first, last = points
        dx = abs(first[0] - last[0])
        dy = abs(first[1] - last[1])
        span, offset = (dx, dy) if axis == "x" else (dy, dx)
        if offset > TOLERANCE:
            continue
        if best is None or span > best[0]:
            best = (span, number)

    if best is None:
        return _manual(rule, f"投影中找不到沿 {axis} 轴的直线边")
    value = best[0]
    expected = params.get(PARAM_KEYS[rule])
    if expected is not None and abs(value - float(expected)) > TOLERANCE:
        return _manual(rule, f"边长为 {value:.3f} mm，与参数 {PARAM_KEYS[rule]}={expected} 不符", [best[1]])
    return {"rule": rule, "status": "ok", "edges": [best[1]], "value": value, "reason": None}


def _hole_diameter(edges: list[tuple[int, object]], params: dict) -> dict:
    """取半径等于 HOLE_D/2 的圆边，返回首个引用与匹配数量。"""
    expected = params.get("HOLE_D")
    if expected is None:
        return _manual("hole_dia", "参数表缺少 HOLE_D")
    radius = float(expected) / 2
    matches: list[int] = []
    for number, edge in edges:
        curve = getattr(edge, "Curve", None)
        actual = getattr(curve, "Radius", None)
        if actual is None:
            continue
        if abs(float(actual) - radius) <= TOLERANCE:
            matches.append(number)

    if not matches:
        return _manual("hole_dia", f"投影中找不到半径 {radius:.2f} mm 的圆边")
    return {
        "rule": "hole_dia",
        "status": "ok",
        "edges": [matches[0]],
        "value": float(expected),
        "quantity": len(matches),
        "reason": None,
    }


def _thickness(edges: list[tuple[int, object]], params: dict) -> dict:
    """取最短的一对平行水平边，作为板厚。"""
    horizontals: list[tuple[int, float, float]] = []
    for number, edge in edges:
        points = _endpoints(edge)
        if points is None:
            continue
        first, last = points
        if abs(first[1] - last[1]) > TOLERANCE:
            continue
        horizontals.append((number, first[1], last[1]))

    if len(horizontals) < 2:
        return _manual("thickness", "投影中不到两条水平边，无法定位板厚")

    best: tuple[float, int, int] | None = None
    y_values = [(number, first_y) for number, first_y, _ in horizontals]
    for index, (first_number, first_y) in enumerate(y_values):
        for second_number, second_y in y_values[index + 1:]:
            distance = abs(first_y - second_y)
            if distance <= TOLERANCE:
                continue
            if best is None or distance < best[0]:
                best = (distance, first_number, second_number)

    if best is None:
        return _manual("thickness", "水平边之间没有非零距离")

    expected = params.get("T")
    if expected is not None and abs(best[0] - float(expected)) > TOLERANCE:
        return _manual(
            "thickness",
            f"最短平行边间距 {best[0]:.3f} mm，与参数 T={expected} 不符",
            [best[1], best[2]],
        )
    return {
        "rule": "thickness",
        "status": "ok",
        "edges": [best[1], best[2]],
        "value": best[0],
        "reason": None,
    }


def _endpoints(edge: object) -> tuple[tuple[float, float], tuple[float, float]] | None:
    vertices = getattr(edge, "Vertexes", None)
    if not vertices or len(vertices) < 2:
        return None
    first, last = vertices[0], vertices[-1]
    return (float(first.X), float(first.Y)), (float(last.X), float(last.Y))


def circle_center(edge: object) -> tuple[float, float] | None:
    """返回圆边的圆心；非圆边返回 None。

    @param edge - 投影边。
    @returns (x, y) 或 None。
    """
    curve = getattr(edge, "Curve", None)
    center = getattr(curve, "Center", None)
    if center is None or getattr(curve, "Radius", None) is None:
        return None
    return float(center.X), float(center.Y)
