# FreeCAD 工作区

依据 `reports/freecad-implementation-plan.md` 建立。目标版本 FreeCAD 1.1.4。

## 目录

```
templates/   SVG 图框（含 freecad:editable 与 freecad:autofill 字段）
macros/      .FCMacro 与可复用辅助模块
parts/       零件族构建器（Python，调用 FreeCAD Part API）
params/      参数表（JSON，每个变体一份）
scripts/     build.py / validate.py / sheet.py（后续）/ common/
incoming/    客户原始图纸，按案件分子目录，只读
out/         生成物，按 <part>/<variant>/ 分层
docs/        基线、命名规范、字段字典
```

## 运行

脚本必须在 FreeCAD 的 Python 解释器下执行，不能直接用系统 `python3`：

```bash
FreeCADCmd scripts/build.py --pass params/plate-100x60.json
FreeCADCmd scripts/validate.py --out out/plate
```

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

- 目录骨架、A4 图框、板类件构建器、`build.py`、`validate.py` 已建立。
- 本仓库的沙箱没有 FreeCAD，脚本尚未在真实 `FreeCADCmd` 下执行；离线检查（语法、参数校验、模板 XML）已通过。
- `scripts/sheet.py`（TechDraw 出图）与 `scripts/import2d.py`（客户图纸接入）尚未实现，见计划阶段 3、7。
