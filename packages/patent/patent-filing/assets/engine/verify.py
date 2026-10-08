#!/usr/bin/env python3
"""申请文件成品验收：对生成/交付的 .docx 跑体例断言与内容断言。

退出码：0 全部通过；1 有 error。

用法::

    python3 verify.py --spec spec/申请文件.json --docx 申请文件.docx
    python3 verify.py --spec spec/申请文件.json --docx 申请文件.docx \\
        --template 申请文件模板.docx     # 额外做"模板体例未漂移"核对

断言分三类：

* **体例**：分节数 / 各节页眉 / 行距 / 首行缩进 / 字号 / 无非黑色文字。
  这些是"静默缺陷"高发区——模型看不出来，源件的 `docs check` 也不覆盖。
* **内容**：说明书五部分齐备 / 权利要求项数 / ``[NNNN]`` 编号连续 / 附图数量 /
  每一节都承载了内容（空节是静默缺陷：成文时某一节的类型或来源键错了，成品会少一整节，
  而分节数、页眉、编号连续性全都照样通过）。
* **痕迹**：内部复核标记、待补占位、QA 注记一律不得出现。

标准输出是一份 JSON（``passed`` / ``errors`` / ``info``）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

from style import template_style

WP = qn("w:p")


def _iter_body(doc):
    """按 body 顺序产出 ('p', element) / ('tbl', element)。"""
    for el in doc.element.body:
        if el.tag == WP:
            yield "p", el
        elif el.tag == qn("w:tbl"):
            yield "tbl", el


def _text(el) -> str:
    return "".join(t.text or "" for t in el.iter(qn("w:t")))


def section_layout(doc):
    """各节的 (段落数, 图片数)，用于判断内容是否落进了正确的节。"""
    layout, current = [], 0
    layout.append([0, 0])
    for kind, el in _iter_body(doc):
        if kind == "p":
            pPr = el.find(qn("w:pPr"))
            if pPr is not None and pPr.find(qn("w:sectPr")) is not None:
                current += 1
                layout.append([0, 0])
                continue
            if el.findall(".//" + qn("w:drawing")):
                layout[current][1] += 1
            elif _text(el).strip():
                layout[current][0] += 1
        else:
            layout[current][0] += 1
    return layout


def verify(spec: dict, docx_path: Path, template_path: Path | None = None) -> dict:
    """对成品 .docx 跑断言。

    Args:
        spec: 文书 spec，读取其 ``assertions`` 与 ``style``。
        docx_path: 待验收的 .docx 路径。
        template_path: 提供时额外核对成品体例与模板反解体例是否一致（模板漂移防线）。

    Returns:
        ``errors`` 为断言失败列表（空即通过），``info`` 为实测摘要。
    """
    errors: list[str] = []
    d = Document(str(docx_path))
    a = spec["assertions"]
    style = spec["style"]
    body_text = "\n".join(_text(el) for kind, el in _iter_body(d) if kind == "p")

    # ---- 体例：分节与页眉
    headers = []
    for s in d.sections:
        paras = s.header.paragraphs
        headers.append(paras[0].text.strip() if paras else "")
    if len(d.sections) != a["section_count"]:
        errors.append(f"分节数 {len(d.sections)} ≠ 期望 {a['section_count']}")
    if headers != a["headers"]:
        errors.append(f"各节页眉不匹配：{headers} ≠ {a['headers']}")

    # ---- 体例：段落格式
    n_par = 0
    for p in d.paragraphs:
        if not p.text.strip():
            continue
        n_par += 1
        pf = p.paragraph_format
        if pf.line_spacing is not None and abs(pf.line_spacing - style["line_spacing"]) > 1e-6:
            errors.append(f"行距 {pf.line_spacing} ≠ {style['line_spacing']}：{p.text[:18]!r}")
        if pf.first_line_indent is not None and pf.first_line_indent.pt != style["first_line_indent"]:
            errors.append(f"首行缩进 {pf.first_line_indent.pt}pt ≠ 0：{p.text[:18]!r}")
        for r in p.runs:
            if r.font.size and round(r.font.size.pt, 2) not in a["max_sizes_pt"]:
                errors.append(f"字号 {r.font.size.pt}pt 不在 {a['max_sizes_pt']}：{p.text[:18]!r}")
            if a.get("forbid_colors") and r.font.color and r.font.color.rgb:
                if str(r.font.color.rgb) != "000000":
                    errors.append(f"非黑色文字 {r.font.color.rgb}（Word 内置标题体例？）：{p.text[:18]!r}")

    # ---- 内容：说明书五部分 / 权项 / 编号
    for h in a["spec_headings"]:
        if not re.search(rf"^\s*{re.escape(h)}\s*$", body_text, re.M):
            errors.append(f"说明书缺法定部分标题：{h}")

    claims = re.findall(a["claim_pattern"], body_text, re.M)
    if not claims:
        errors.append("未识别到任何权利要求项")

    numbers = [int(x) for x in re.findall(a["numbering_pattern"], body_text, re.M)]
    if a.get("continuity"):
        if not numbers:
            errors.append("说明书中没有任何 [NNNN] 段落编号")
        elif numbers != list(range(1, len(numbers) + 1)):
            errors.append(f"段落编号不连续（共 {len(numbers)} 条）")

    # ---- 痕迹
    for bad in a["forbid_text"]:
        if bad in body_text:
            errors.append(f"内部痕迹未清除：{bad!r}")

    # ---- 结构归属
    layout = section_layout(d)
    for i, sec in enumerate(spec["sections"]):
        if i >= len(layout):
            break
        paragraphs, figures = layout[i]
        if paragraphs == 0 and figures == 0:
            errors.append(f"节 {sec['key']} 未承载任何内容（段落 0，图片 0）")
    info = {
        "sections": len(d.sections),
        "headers": headers,
        "paragraphs": n_par,
        "claims": len(claims),
        "numbering": f"1..{len(numbers)}" if numbers else "无",
        "tables": len(d.tables),
        "figures": len(d.inline_shapes),
        "layout": {spec["sections"][i]["key"]: {"paragraphs": v[0], "figures": v[1]}
                   for i, v in enumerate(layout) if i < len(spec["sections"])},
        "template": None,
    }

    # ---- 模板体例未漂移（可选）
    if template_path is not None:
        derived = template_style(template_path)
        info["template"] = {"sections": derived["section_count"],
                            "sizes_pt": derived["sizes_pt"],
                            "line_spacings": derived["line_spacings"]}
        if derived["section_count"] != a["section_count"]:
            errors.append(f"模板分节数 {derived['section_count']} ≠ spec 声明 {a['section_count']}")
        if style["size_pt"] != derived["size_pt"]:
            errors.append(f"spec 字号 {style['size_pt']}pt ≠ 模板字号 {derived['size_pt']}pt")
        if style["line_spacing"] != derived["line_spacing"]:
            errors.append(f"spec 行距 {style['line_spacing']} ≠ 模板行距 {derived['line_spacing']}")

    return {"passed": not errors, "errors": errors, "info": info}


def main(argv=None):
    ap = argparse.ArgumentParser(description="申请文件成品验收")
    ap.add_argument("--spec", required=True, type=Path)
    ap.add_argument("--docx", required=True, type=Path)
    ap.add_argument("--template", type=Path)
    args = ap.parse_args(argv)

    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    result = verify(spec, args.docx, args.template)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
