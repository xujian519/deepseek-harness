"""标注规则库：把“语义尺寸”映射到投影视图的边引用。

本模块不导入 FreeCAD，边以鸭子类型传入（需要 Vertexes 与 Curve），便于离线测试。
所有引用均以 TechDraw 的 `EdgeN` 序号表示，序号与 `view.getVisibleEdges()` 的顺序一一对应。
"""

from __future__ import annotations

import math

TOLERANCE = 1e-4

RULES = ("overall_x", "overall_y", "hole_dia", "pitch_dia", "thickness")

# 轴类零件沿轴向分段，板类的长宽/孔径规则不适用。
SHAFT_RULES = ("shaft_length", "shaft_dia_1", "shaft_dia_2", "shaft_dia_3")

# 零件族 → 规则集。新增零件族必须在此登记，否则出图时报错而不是套用板类规则。
PART_RULES = {
    "plate": RULES,
    "flange": RULES,
    "bracket": RULES,
    "shaft": SHAFT_RULES,
}

# 规则 → 投影视图。板类件：俯视图出长宽与孔径，主视图出厚度；轴类件的主视图
# 把轴线摆成水平，长度与分段直径都标在这里。
RULE_VIEWS = {
    "overall_x": "Top",
    "overall_y": "Top",
    "hole_dia": "Top",
    "pitch_dia": "Top",
    "thickness": "Front",
    "shaft_length": "Front",
    "shaft_dia_1": "Front",
    "shaft_dia_2": "Front",
    "shaft_dia_3": "Front",
}

PARAM_KEYS = {
    "overall_x": ("L", "OD"),
    "overall_y": ("W", "OD"),
    "hole_dia": ("HOLE_D", "BOLT_D"),
    "pitch_dia": ("BCD",),
    "thickness": ("T",),
    "shaft_length": ("L",),
    "shaft_dia_1": ("D1",),
    "shaft_dia_2": ("D2",),
    "shaft_dia_3": ("D3",),
}


def rules_for(part: str) -> tuple[str, ...]:
    """返回零件族参与出图的规则集。

    @param part - 参数表的 part 字段。
    @returns 该零件族的规则元组。
    @throws ValueError - 零件族未在 PART_RULES 登记。
    """
    try:
        return PART_RULES[part]
    except KeyError:
        raise ValueError(f"零件族 {part} 未登记标注规则，请在 dim_rules.PART_RULES 中补充") from None


def expected(rule: str, params: dict) -> tuple[str, float] | None:
    """返回该规则在参数表中声明的键与值。

    规则只对参数表声明的零件生效；缺少对应参数说明该尺寸不适用于此零件
    （例如轴没有 `T`，法兰用 `OD` 而不是 `L`）。

    @param rule - RULES 之一。
    @param params - 参数表数值。
    @returns (键名, 数值)，或未声明时返回 None。
    """
    for key in PARAM_KEYS.get(rule, ()):
        value = params.get(key)
        if value is not None:
            return key, float(value)
    return None


def select(rule: str, edges: list[tuple[int, object]], params: dict) -> dict:
    """按规则挑选边引用。

    @param rule - RULES 之一。
    @param edges - (EdgeN 序号, 投影边) 列表，序号从 1 开始。
    @param params - 参数表数值。
    @returns 含 rule、status（ok / manual）、edges、value、reason 的字典。
    """
    if rule not in RULES and rule not in SHAFT_RULES:
        raise ValueError(f"未知标注规则：{rule}")
    if rule in SHAFT_RULES:
        return _manual(rule, "轴类尺寸由轴的圆柱面与轴向包围盒测量，不引用投影边")
    if rule == "overall_x":
        return _overall(edges, "x", rule, params)
    if rule == "overall_y":
        return _overall(edges, "y", rule, params)
    if rule == "hole_dia":
        return _hole_diameter(edges, params)
    if rule == "thickness":
        return _thickness(edges, params)
    return _pitch_diameter(edges, params)


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
    declared = expected(rule, params)
    if declared is None:
        return _manual(rule, f"参数表未声明 {PARAM_KEYS[rule][0]}，该零件不适用此项")
    key, expected_value = declared

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
    if abs(value - expected_value) > TOLERANCE:
        return _manual(rule, f"边长为 {value:.3f} mm，与参数 {key}={expected_value} 不符", [best[1]])
    return {"rule": rule, "status": "ok", "edges": [best[1]], "value": value, "reason": None}


def _hole_diameter(edges: list[tuple[int, object]], params: dict) -> dict:
    """取半径等于 HOLE_D/2 的圆边，返回首个引用与孔数。

    一个孔在 HLR 里常被拆成两条半圆弧，因此孔数按圆心去重计数，
    而不是按匹配到的边数。
    """
    declared = expected("hole_dia", params)
    if declared is None:
        return _manual("hole_dia", "参数表未声明 HOLE_D / BOLT_D，该零件无孔")
    key, diameter = declared
    radius = diameter / 2
    matches: list[int] = []
    centers: list[tuple[float, float]] = []
    for number, edge in edges:
        curve = getattr(edge, "Curve", None)
        actual = getattr(curve, "Radius", None)
        if actual is None:
            continue
        if abs(float(actual) - radius) <= TOLERANCE:
            matches.append(number)
            center = circle_center(edge)
            if center is not None and all(
                math.hypot(center[0] - cx, center[1] - cy) > TOLERANCE
                for cx, cy in centers
            ):
                centers.append(center)

    if not matches:
        return _manual("hole_dia", f"投影中找不到半径 {radius:.2f} mm 的圆边")
    return {
        "rule": "hole_dia",
        "status": "ok",
        "edges": [matches[0]],
        "value": diameter,
        "quantity": len(centers) if centers else len(matches),
        "reason": None,
    }


def _thickness(edges: list[tuple[int, object]], params: dict) -> dict:
    """取最短的一对平行水平边，作为板厚。"""
    declared = expected("thickness", params)
    if declared is None:
        return _manual("thickness", "参数表未声明 T，该零件不适用板厚")
    key, expected_value = declared

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

    if abs(best[0] - expected_value) > TOLERANCE:
        return _manual(
            "thickness",
            f"最短平行边间距 {best[0]:.3f} mm，与参数 {key}={expected_value} 不符",
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
    # Base.Vector 使用小写 x/y；Part.Vertex 使用大写 X/Y，此处 center 为 Vector。
    return float(center.x), float(center.y)


def _pitch_diameter(edges: list[tuple[int, object]], params: dict) -> dict:
    """把圆心共圆的孔分组，计算节圆直径。

    节圆圆心取所有孔心的质心；节圆半径取各孔心到质心的平均距离，
    若偏差超过容差则视为不共圆，转人工标注。
    """
    circles: list[tuple[int, tuple[float, float]]] = []
    for number, edge in edges:
        center = circle_center(edge)
        if center is not None:
            circles.append((number, center))

    declared = expected("pitch_dia", params)
    if declared is None:
        return _manual("pitch_dia", "参数表未声明 BCD，该零件无节圆")

    if len(circles) < 2:
        return _manual("pitch_dia", f"投影中只有 {len(circles)} 个圆，无法确定节圆")

    center_x = sum(c[1][0] for c in circles) / len(circles)
    center_y = sum(c[1][1] for c in circles) / len(circles)
    radii = [math.hypot(px - center_x, py - center_y) for _, (px, py) in circles]
    avg_radius = sum(radii) / len(radii)

    if avg_radius <= TOLERANCE:
        return _manual("pitch_dia", "所有圆心重合，无法确定节圆")

    max_dev = max(abs(r - avg_radius) for r in radii)
    if max_dev > TOLERANCE:
        return _manual(
            "pitch_dia",
            f"圆心不共圆，半径偏差最大 {max_dev:.4f} mm",
            [c[0] for c in circles],
        )

    pitch_dia = 2 * avg_radius
    key, expected_value = declared
    if abs(pitch_dia - expected_value) > TOLERANCE:
        return _manual(
            "pitch_dia",
            f"节圆直径 {pitch_dia:.3f} mm，与参数 {key}={expected_value} 不符",
            [c[0] for c in circles],
        )

    # 取圆心距最大的一对孔作为尺寸引用，其距离即节圆直径。
    best_pair: tuple[float, int, int] | None = None
    for index, (first_number, (fx, fy)) in enumerate(circles):
        for second_number, (sx, sy) in circles[index + 1:]:
            distance = math.hypot(fx - sx, fy - sy)
            if best_pair is None or distance > best_pair[0]:
                best_pair = (distance, first_number, second_number)

    return {
        "rule": "pitch_dia",
        "status": "ok",
        "edges": [best_pair[1], best_pair[2]],
        "value": pitch_dia,
        "quantity": len(circles),
        "reason": None,
    }
