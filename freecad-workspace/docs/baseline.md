# 基线记录

目标版本：FreeCAD 1.1.4（稳定版）。26.3 正式发布后做一次全量回归。

## 本仓库沙箱的检查结果

执行时间：2026-10-30。

| 项目 | 结果 |
|---|---|
| Python | 3.14.8（仅用于离线检查与 DXF 校验，不加载 FreeCAD） |
| `freecadcmd` | 0.21.2（R33771），Linux 小写；无 GUI，TechDraw HLR 不可用 |
| `xvfb-run` | 未安装 |
| `inkscape` | 未安装 |
| `ezdxf` | 1.4.3（系统 Python，用于 DXF 解析与 audit） |

结论：沙箱只有 FreeCAD 0.21.2 控制台，可真实执行 `build.py` / `verify.py` / `sheet.py` 并产出 DXF；PDF 与 TechDraw HLR 路径需在装有 GUI 的目标机（1.1.4）复核。

## 目标机需要执行的校验

```bash
FreeCADCmd --version                 # 期望 1.1.4
FreeCADCmd "import Part; print(Part.makeBox(10,5,15).Volume)"   # 期望 750.0
FreeCADCmd -c "import TechDraw; print('techdraw ok')"           # 控制台可用
xvfb-run --help >/dev/null && echo xvfb-ok                      # 仅 Linux 出 PDF 需要
```

Windows 用 `FreeCADCmd.exe`，macOS 用 `FreeCAD.app/Contents/MacOS/FreeCADCmd`。外部 Python 执行 `import FreeCAD` 时必须是 3.11 ABI。

## 结果记录（待目标机填写）

| 项目 | 实测值 | 日期 | 执行人 |
|---|---|---|---|
| FreeCAD 版本 | | | |
| `makeBox` 体积 | | | |
| TechDraw 控制台 | | | |
| `xvfb-run` | | | |
| 首个冒烟构建 | | | |
