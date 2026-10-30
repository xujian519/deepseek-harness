# FreeCAD 工作区

依据 `reports/freecad-implementation-plan.md` 建立。目标版本 FreeCAD 1.1.4。

## 目录

```
templates/   SVG 图框（含 freecad:editable 与 freecad:autofill 字段）
macros/      .FCMacro 与可复用辅助模块
parts/       零件族构建器（Python，调用 FreeCAD Part API）
params/      参数表（JSON，每个变体一份）
scripts/     build.py / validate.py / sheet.py / dim_rules.py / common/
incoming/    客户原始图纸，按案件分子目录，只读
out/         生成物，按 <part>/<variant>/ 分层
docs/        基线、命名规范、字段字典
```

## 运行

脚本必须在 FreeCAD 的 Python 解释器下执行，不能直接用系统 `python3`：

```bash
FreeCADCmd scripts/build.py --pass params/plate-100x60.json
FreeCADCmd scripts/validate.py --out out/plate
FreeCADCmd scripts/sheet.py --pass params/plate-100x60.json
xvfb-run -a freecad scripts/sheet.py --pass params/plate-100x60.json --pdf
```

`sheet.py` 需要先有 `out/<part>/<variant>/model.FCStd`，即先跑 `build.py`。DXF 可无头导出；PDF 需要 GUI（Linux 用 `xvfb-run`）。

macOS 的 `FreeCADCmd` 在 `FreeCAD.app/Contents/MacOS/FreeCADCmd`；Windows 为 `FreeCADCmd.exe`。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 2 | 参数表不合法 |
| 3 | 几何无效（`isValid()` 为假、体积异常、包围盒与参数不符） |
| 4 | 导出失败 |
| 5 | 运行环境缺失（未在 FreeCADCmd 下运行或缺少模块） |

## 当前状态

- 阶段 0–3 的代码已建立：目录骨架、A4 图框、板类件构建器、`build.py`、`validate.py`、`sheet.py`、`dim_rules.py`。
- 本仓库的沙箱没有 FreeCAD，脚本尚未在真实 `FreeCADCmd` 下执行；离线检查（语法、参数校验、模板 XML、标注规则）已通过。
- `scripts/import2d.py`（客户图纸接入）尚未实现，见计划阶段 5。

## 已知限制

- `dim_rules.py` 假定 `EdgeN` 序号与 `view.getVisibleEdges()` 顺序一致，需在目标机实测；不一致时尺寸会引用到错误边，必须核对 `dimensions.json`。
- `pitch_dia`（节圆直径）未实现，一律进 `manual_review.md`。
- 孔径的数量前缀依赖 `DrawViewDimension.FormatSpec`，若该属性不接受自定义前缀，会记录在 `dimensions.json` 的 `reason`。
- `sheet.py` 用 `hasattr(group, "AutoDistribute")` 判断自动布局能力，手工布局为后备路径，未在 1.1.4 上验证。
