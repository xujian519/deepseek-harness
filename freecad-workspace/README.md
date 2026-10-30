# FreeCAD 工作区

依据 `reports/freecad-implementation-plan.md` 建立。目标版本 FreeCAD 1.1.4。

## 目录

```
templates/   SVG 图框（含 freecad:editable 与 freecad:autofill 字段）
parts/       零件族构建器（Python，调用 FreeCAD Part API）
params/      参数表（JSON，每个变体一份）
scripts/     build.py / verify.py / sheet.py / dim_rules.py / import2d.py / common/
out/         生成物，按 <part>/<variant>/ 分层
docs/        基线、命名规范、字段字典、API 片段、故障对策
```

接入客户图纸时按案件新建 `incoming/<案件>/`，原始图纸只读。

## 运行

脚本必须在 FreeCAD 的 Python 解释器下执行，不能直接用系统 `python3`：

```bash
freecadcmd scripts/build.py --pass params/plate-100x60.json
freecadcmd scripts/verify.py --out out/plate/100x60
freecadcmd scripts/sheet.py --pass params/plate-100x60.json
xvfb-run -a freecad scripts/sheet.py --pass params/plate-100x60.json --pdf
```

`sheet.py` 需要先有 `out/<part>/<variant>/model.FCStd`，即先跑 `build.py`。DXF 可无头导出（用 `Part.HLRBRep` 直接投影 + 手写 DXF 实体，不依赖 TechDraw HLR）；PDF 需要 GUI（Linux 用 `xvfb-run`）。

macOS 的可执行文件在 `FreeCAD.app/Contents/MacOS/FreeCADCmd`；Windows 为 `FreeCADCmd.exe`；Linux 发行版通常为小写 `freecadcmd`。

客户图纸接入用系统 Python，不进 FreeCAD：

```bash
pip install ezdxf
python3 scripts/import2d.py --input incoming/JWZF20K/source/JWZF20K带支架.DWG --case JWZF20K
python3 scripts/import2d.py --input drawing.dxf --drop-layer TITLE --drop-pattern '^标注'
```

| 输入 | 依赖 |
|---|---|
| `.dxf` | `ezdxf` |
| `.dwg` | LibreDWG 的 `dwg2dxf`（或先手动转 DXF） |
| `.pdf` | `pdftocairo`（poppler-utils） |

输出到 `out/<case>/converted/`：`model.svg`、`layers.json`（图层清单）、`convert.json`（来源哈希、转换器、删除计数）。默认删除尺寸实体、`TEXT`/`MTEXT`，并按 `--drop-layer` / `--drop-pattern` 删图层；PDF 路径没有图层信息，清理需人工，`convert.json` 会记 `cleaning: manual`。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 2 | 参数表不合法 |
| 3 | 几何无效（`isValid()` 为假、体积异常、包围盒与参数不符） |
| 4 | 导出失败 |
| 5 | 运行环境缺失（未在 FreeCADCmd 下运行或缺少模块） |

## 当前状态

- 阶段 0–3 的代码已建立：目录骨架、A4 图框、板/法兰/阶梯轴/L 形支架四类构建器，`build.py`、`verify.py`、`sheet.py`、`dim_rules.py`。
- 阶段 5 的 `import2d.py` 已实现，DXF 路径在沙箱用合成图实测通过；DWG/PDF 路径依赖本机转换器，未实测。
- 阶段 4 的上下文资产已建立：`docs/api_snippets.md`、`docs/field-dictionary.md`（含模板字段与四类零件参数表）、`docs/failure_playbook.md`、`docs/agent-contract.md`（代理权限与护栏）、四份 `params/*.json` 样例。
- 四份参数样例已通过 `scripts/common/params.py` 校验，并与各零件族的 `REQUIRED` 字段及数值约束一致。
- `build.py` / `verify.py` / `sheet.py` 已在 FreeCAD 0.21.2 下跑通四类零件：`build.py` 产出 FCStd/STEP/STL/manifest；`verify.py` 体积与包围盒校验通过；`sheet.py` 产出 DXF（含图框、标题栏、三视图、尺寸文字）、`dimensions.json` 与 `manual_review.md`。四份 DXF 均通过 `ezdxf` 的 `audit()`（0 error），图形全部落在 A4 图框内。

## 已知限制

- DXF 导出用 `Part.HLRBRep.Algo` 直接做三视图投影（无头模式下 TechDraw HLR 不运行），再手写 R12 DXF 实体（LINE/CIRCLE/TEXT）；不支持圆弧等其它曲线类型，遇到时会跳过。
- DXF 为 R12（AC1009），没有 Unicode：文字按 `$DWGCODEPAGE=ANSI_936` 以 cp936 编码写入；直径符号用 AutoCAD 控制码 `%%c`（打开后显示为 ⌀），因为 U+2300 不在 GB2312/936 内。
- 尺寸值取自投影边匹配或 3D 包围盒/圆柱面回退测量；标注规则只对参数表声明了对应参数的零件生效，未声明的规则直接转人工。`dimensions.json` 中 `status=manual` 的项需人工核对（例如矩形孔阵无节圆、轴类零件的轴向长度）；`stepped-3` 轴因无轴类专用规则，5 项全部转人工，DXF 目前只有图框和三视图、没有尺寸文字。
- `shape.scale()` 在 FreeCAD 0.21 中会使 `edge.Curve` 无法读取，故视图缩放通过对坐标手动乘系数实现。
- `import2d.py` 的 DWG 路径依赖 `dwg2dxf`，沙箱没有该工具，未实测；多页 PDF 会产出 `model-2.svg` 等文件，`convert.json` 的 `outputs` 会列出全部 SVG。
- PDF 导出仍走 TechDraw 模板路径，需要 GUI（`xvfb-run`），未在无头环境实测。
