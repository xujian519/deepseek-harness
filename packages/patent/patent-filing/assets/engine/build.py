#!/usr/bin/env python3
"""申请文件体例引擎：把结构化内容按 .docx 模板的体例成文。

体例真相源是**模板文件本身**（分节 / 页眉 / 页脚 PAGE 域 / 页面设置 / 段落与文字体例），
由 :mod:`style` 从模板反解。本模块只做三件事：

1. 校验 spec 与 content 的接缝（节类型、来源键、附图下标、编号口径）；
2. 按 spec 的节序，清空模板各节里的占位段落（分节符段落一律保留）；
3. 按节插入内容（正文段 / 标题 / 表格 / 图片）；
4. 套用模板反解出的体例。

用法::

    python3 build.py --spec spec/申请文件.json --content content.json \\
        --template 申请文件模板.docx --out 申请文件.docx

``content.json`` 的结构（由 ``build_patent_filing`` 工具产出，字段含义同该工具的内容模型）::

    {
      "abstract":      ["段落", ...],
      "claims":        ["1. …", ...],
      "specification": [{"kind": "h3"|"h4"|"p"|"table", "text": ..., "rows": ...}, ...],
      "figures":       ["/abs/fig1.png", ...]
    }

标准输出是一份 JSON 报告（``status``/``sections``/``numbering_total``/
``upstream_numbering_seen``/``template_style``）；失败时以非零退出码结束，错误写 stderr。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm
from docx.text.paragraph import Paragraph

from style import resolve_style, template_style

WP = qn("w:p")


# --------------------------------------------------------------------------- 体例原语

def _pPr(style: dict, align: str | None = None):
    """段落属性：对齐 + 行距 + 首行缩进，全部取自模板反解的体例。"""
    pPr = OxmlElement("w:pPr")
    if align:
        jc = OxmlElement("w:jc")
        jc.set(qn("w:val"), align)
        pPr.append(jc)
    sp = OxmlElement("w:spacing")
    sp.set(qn("w:line"), str(int(round(style["line_spacing"] * 240))))
    sp.set(qn("w:lineRule"), "auto")
    pPr.append(sp)
    ind = OxmlElement("w:ind")
    ind.set(qn("w:firstLine"), str(int(round(style["first_line_indent"] * 20))))
    ind.set(qn("w:firstLineChars"), "0")
    pPr.append(ind)
    return pPr


def _rPr(style: dict, bold: bool = False, size_pt: float | None = None):
    """文字属性：中西文字体 + 字号，全部取自模板反解的体例。"""
    rPr = OxmlElement("w:rPr")
    fonts = OxmlElement("w:rFonts")
    for attr, key in (("w:ascii", "ascii"), ("w:hAnsi", "ascii"),
                      ("w:eastAsia", "eastAsia"), ("w:cs", "cs")):
        if key in style:
            fonts.set(qn(attr), style[key])
    rPr.append(fonts)
    if bold:
        rPr.append(OxmlElement("w:b"))
    half = str(int(round((size_pt if size_pt is not None else style["size_pt"]) * 2)))
    for tag in ("w:sz", "w:szCs"):
        el = OxmlElement(tag)
        el.set(qn("w:val"), half)
        rPr.append(el)
    return rPr


def paragraph(style: dict, text: str = "", *, bold=False, align=None, size_pt=None):
    p = OxmlElement("w:p")
    p.append(_pPr(style, align))
    if text:
        run = OxmlElement("w:r")
        run.append(_rPr(style, bold, size_pt))
        t = OxmlElement("w:t")
        t.set(qn("xml:space"), "preserve")
        t.text = text
        run.append(t)
        p.append(run)
    return p


def table(style: dict, rows: list[list[str]]):
    tbl = OxmlElement("w:tbl")
    pr = OxmlElement("w:tblPr")
    borders = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), "4")
        e.set(qn("w:color"), "000000")
        borders.append(e)
    pr.append(borders)
    tbl.append(pr)
    for r_i, row in enumerate(rows):
        tr = OxmlElement("w:tr")
        for cell in row:
            tc = OxmlElement("w:tc")
            tcp = OxmlElement("w:tcPr")
            jc = OxmlElement("w:jc")
            jc.set(qn("w:val"), "center")
            tcp.append(jc)
            tc.append(tcp)
            tc.append(paragraph(style, cell, bold=(r_i == 0), align="center",
                                size_pt=style.get("table_size_pt", style["size_pt"])))
            tr.append(tc)
        tbl.append(tr)
    return tbl


def page_break(style: dict):
    p = OxmlElement("w:p")
    p.append(_pPr(style))
    run = OxmlElement("w:r")
    br = OxmlElement("w:br")
    br.set(qn("w:type"), "page")
    run.append(br)
    p.append(run)
    return p


# --------------------------------------------------------------------------- 分节机制

class Template:
    """模板的各节边界。

    一个段落若其 pPr 内含 sectPr，它就是**该节的最后一段**；文档末节由 body 级
    sectPr 结束。插入内容时必须锚定到正确的分节符，否则内容会落进前一节——
    这是本项目已记录的真实缺陷（图 1–图 5 曾落进「说明书」节）。
    """

    def __init__(self, path: Path):
        self.doc = Document(str(path))
        self.body = self.doc.element.body
        paras = [el for el in self.body if el.tag == WP]
        self.enders = [
            p for p in paras
            if p.find(qn("w:pPr")) is not None
            and p.find(qn("w:pPr")).find(qn("w:sectPr")) is not None
        ]
        bounds, prev = [], 0
        for ender in self.enders:
            idx = paras.index(ender)
            bounds.append((prev, idx))
            prev = idx + 1
        bounds.append((prev, len(paras)))
        self.paras = paras
        self.bounds = bounds
        self.body_sect = self.body.find(qn("w:sectPr"))

    def anchor(self, index: int):
        """第 index 节的插入锚点：该节分节符段落；末节返回 None（插到 body 级 sectPr 前）。"""
        return self.enders[index] if index < len(self.enders) else None

    def clear(self, index: int):
        """清空第 index 节的占位段落，保留其分节符段落。"""
        start, stop = self.bounds[index]
        ender = self.anchor(index)
        for p in self.paras[start:stop]:
            if p is ender:
                continue
            p.getparent().remove(p)
        return ender

    def insert(self, anchor, element):
        if anchor is not None:
            anchor.addprevious(element)
        elif self.body_sect is not None:
            self.body_sect.addprevious(element)
        else:
            self.body.append(element)

    def add_picture(self, anchor, image: Path, width_cm: float, style: dict):
        holder = OxmlElement("w:p")
        holder.append(_pPr(style, "center"))
        self.insert(anchor, holder)
        Paragraph(holder, self.doc).add_run().add_picture(str(image), width=Cm(width_cm))


# --------------------------------------------------------------------------- 主流程

# spec 的节类型与正文节点类别的封闭集合；未定义取值一律报错，不回落成别的类型。
SECTION_KINDS = ("text", "mixed", "figure")
NODE_KINDS = ("h3", "h4", "p", "table")
NUMBERING_POLICIES = ("none", "paragraph")


def validate_spec(spec: dict, content: dict) -> re.Pattern:
    """校验 spec 与 content 的接缝，返回段落编号的匹配式。

    spec 是随包资产、content 由模型产出，两者都在本模块的输入边界上。缺键与未定义取值
    必须在这里报错，不能回落：``sec.get("kind", "text")`` 那样写会把一个拼错的节类型变成
    一个被清空、什么都没写的节，而成文与验收都报成功——空摘要就是这样交付出去的。

    Args:
        spec: 文书 spec。
        content: 结构化内容模型。

    Returns:
        由 ``spec.assertions.numbering_pattern`` 编译的段落编号匹配式。
    """
    for key in ("sections", "style", "figure_width_cm", "heading_bold", "assertions"):
        if key not in spec:
            raise SystemExit(f"spec 缺 {key}")
    pattern = spec["assertions"]["numbering_pattern"]
    numbering = re.compile(pattern)
    if numbering.groups != 1:
        raise SystemExit(f"spec 的 numbering_pattern {pattern!r} 必须恰好含 1 个捕获组")

    for i, sec in enumerate(spec["sections"], 1):
        for key in ("key", "from", "kind"):
            if key not in sec:
                raise SystemExit(f"spec 第 {i} 节缺 {key}")
        where = f"第 {i} 节（key={sec['key']}）"
        if sec["kind"] not in SECTION_KINDS:
            raise SystemExit(f"spec {where} 的 kind {sec['kind']!r} 未定义；可用：{'、'.join(SECTION_KINDS)}")
        if sec["from"] not in content:
            raise SystemExit(f"spec {where} 的 from {sec['from']!r} 不在 content 里")
        if sec["kind"] in ("text", "mixed"):
            if sec.get("numbering") not in NUMBERING_POLICIES:
                raise SystemExit(
                    f"spec {where} 的 numbering {sec.get('numbering')!r} 未定义；可用：{'、'.join(NUMBERING_POLICIES)}"
                )
        if sec["kind"] == "figure" and not sec.get("figure_all"):
            index = sec.get("figure_index")
            if not isinstance(index, int) or not 0 <= index < len(content["figures"]):
                raise SystemExit(
                    f"spec {where} 的 figure_index {index!r} 超出 content.figures（{len(content['figures'])} 张）"
                )
        if sec["kind"] == "mixed":
            for node in content[sec["from"]]:
                if node.get("kind") not in NODE_KINDS:
                    raise SystemExit(
                        f"spec {where} 的 content 节点 kind {node.get('kind')!r} 未定义；可用：{'、'.join(NODE_KINDS)}"
                    )
    return numbering


def build(spec: dict, content: dict, template_path: Path, out_path: Path) -> dict:
    """按模板体例成文。

    Args:
        spec: 文书 spec（节序、编号口径、附图宽度、结构性断言）。
        content: 结构化内容模型。
        template_path: 模板 .docx 路径（体例真相源）。
        out_path: 产物 .docx 路径。

    Returns:
        报告：各节承载的段落/图片数、段落编号总数、从源件读到的上游编号数、模板体例。
    """
    style = resolve_style(spec, template_path)
    numbering_pattern = validate_spec(spec, content)
    tpl = Template(template_path)
    if len(tpl.bounds) != len(spec["sections"]):
        raise SystemExit(
            f"模板分节数 {len(tpl.bounds)} 与 spec 声明的节数 {len(spec['sections'])} 不一致"
        )

    report = {"sections": [], "template_style": template_style(template_path)}
    numbering = 0
    upstream_seen = 0
    upstream_mismatch: list[str] = []
    heading_bold = spec["heading_bold"]

    for i, sec in enumerate(spec["sections"]):
        anchor = tpl.clear(i)
        kind = sec["kind"]
        added = {"key": sec["key"], "paragraphs": 0, "figures": 0}

        if kind == "text":
            for text in content[sec["from"]]:
                tpl.insert(anchor, paragraph(style, text))
                added["paragraphs"] += 1

        elif kind == "mixed":
            for node in content[sec["from"]]:
                node_kind = node["kind"]
                if node_kind == "table":
                    tpl.insert(anchor, table(style, node["rows"]))
                elif node_kind in ("h3", "h4"):
                    tpl.insert(anchor, paragraph(style, node["text"], bold=heading_bold))
                else:
                    text = node["text"]
                    if sec.get("numbering") == "paragraph":
                        numbering += 1
                        expected = f"[{numbering:04d}]"
                        # 上游渲染引擎也会写编号。先剥后写，既幂等，也让本引擎保持
                        # 对 docx 的最终决定权；若上游编号与本引擎的序号不一致，
                        # 说明 HTML 与 docx 会分叉，直接报错而不是静默覆盖。
                        found = numbering_pattern.match(text)
                        if found:
                            upstream_seen += 1
                            if found.group(0).strip() != expected:
                                upstream_mismatch.append(
                                    f"第 {numbering} 段：上游为 {found.group(0).strip()}，本引擎为 {expected}"
                                )
                            text = text[found.end():].lstrip()
                        text = f"{expected} {text}"
                    tpl.insert(anchor, paragraph(style, text))
                added["paragraphs"] += 1

        elif kind == "figure":
            figures = content["figures"]
            selected = figures if sec.get("figure_all") else [figures[sec["figure_index"]]]
            for n, image in enumerate(selected):
                if n > 0 and sec.get("one_per_page"):
                    tpl.insert(None if anchor is None else anchor, page_break(style))
                tpl.add_picture(anchor, Path(image), spec["figure_width_cm"], style)
                added["figures"] += 1

        else:
            raise SystemExit(f"引擎缺节类型 {kind!r} 的处理分支（spec 第 {i + 1} 节）")

        report["sections"].append(added)

    if upstream_mismatch:
        raise SystemExit(
            "上游 HTML 的段落编号与本引擎序号不一致，HTML 与 docx 会分叉：\n  "
            + "\n  ".join(upstream_mismatch[:10])
        )
    report["numbering_total"] = numbering
    report["upstream_numbering_seen"] = upstream_seen
    write_atomically(tpl.doc, out_path)
    return report


def write_atomically(doc, out_path: Path) -> None:
    """把成品写到同目录的临时件后改名，避免交付路径上留下半写的 .docx。

    直接 ``save(out_path)`` 会在保存途中覆盖已存在的成品：失败时那里留着的是一个截断的
    zip，而文件名与成功产物无从区分。

    Args:
        doc: 待保存的 ``docx.Document``。
        out_path: 成品目标路径。
    """
    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.part")
    try:
        doc.save(str(tmp))
        os.replace(tmp, target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def main(argv=None):
    ap = argparse.ArgumentParser(description="按模板体例把结构化内容成文为 .docx")
    ap.add_argument("--spec", required=True, type=Path)
    ap.add_argument("--content", required=True, type=Path)
    ap.add_argument("--template", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args(argv)

    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    content = json.loads(args.content.read_text(encoding="utf-8"))
    report = build(spec, content, args.template, args.out)
    print(json.dumps({"status": "ok", "out": str(args.out), **report},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
