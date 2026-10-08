# 申请文件模板 — 来源与去标识化

本目录的 `申请文件模板.docx` 是本包唯一的**体例真相源**：正文字体、字号、行距、首行缩进、
分节数与各节页眉全部由 `assets/engine/style.py` 从该文件反解，`assets/spec/申请文件.json`
的 `style` 块只作投影核对。

## 指纹

| 件 | md5 | sha256 | 字节 |
|---|---|---|---|
| 本目录去标识化副本 | `a6167447380030102430f10b9bd5e497` | `1cb68cbeea48f5be9a4a7bb87e4f60ca3406d38e87e9ef96de8745b6d1e6f0ed` | 28889 |

来源件是部署里的既有模板，不在本仓库内，谁也无法据本仓库复核它的指纹，故不在此登记。
去标识化会改变字节，因此以**副本的指纹**为准：`build_patent_filing` 返回的模板指纹与
`verify_patent_filing` 的体例漂移核对都取本目录这一份。

## 去标识化动作（仅 `docProps/`，正文与样式一字未动）

| 部件 | 动作 |
|---|---|
| `docProps/core.xml` | 清空 `dc:title`（来源件此处含一个真实案件的独立权利要求全文）、`dc:creator`、`cp:lastModifiedBy`（真实撰写人姓名）；`cp:revision` 归 1 |
| `docProps/app.xml` | 清空 `Company`、`Application`、`Template` |
| `docProps/custom.xml` | 清空 WPS 的 `KSOProductBuildVer` / `ICV` 属性值 |

正文、`word/styles.xml`、26 个页眉页脚部件、`theme1.xml` 与全部关系部件均未改动。
`word/document.xml` 只含空占位段落与 5 个 `sectPr`，无正文文本可泄漏。

复核方式（与去标识化同源，可重跑）：打开副本，确认 5 个 `docProps` 之外的部件逐字节等于来源件，
且 `docProps` 内不含案件文本、撰写人姓名与 WPS 构建指纹。

## 体例反解值（两件一致，证明去标识化未改体例）

```json
{"section_count": 5, "eastAsia": "宋体", "ascii": "Times New Roman", "cs": "Times New Roman",
 "size_pt": 12.0, "line_spacing": 1.5, "first_line_indent": 0.0,
 "sizes_pt": [12.0], "line_spacings": [1.5]}
```

## 结构复核

`@deepseek-ai/dsh-skill-office` 的 `check_office.py` 对该副本判 `pass`：5 个分节、
A4（11906×16838 twips）、页边距与页眉页脚距离齐全。
