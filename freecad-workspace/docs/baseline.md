# 基线记录

目标版本：FreeCAD 1.1.4（稳定版）。26.3 正式发布后做一次全量回归。

## 本仓库沙箱的检查结果

执行时间：2026-10-30。

| 项目 | 结果 |
|---|---|
| Python | 3.14.8（仅用于离线检查，不加载 FreeCAD） |
| `freecadcmd` / `FreeCADCmd` | 未安装 |
| `xvfb-run` | 未安装 |
| `inkscape` | 未安装 |

结论：沙箱不具备 FreeCAD 运行环境，`build.py` / `validate.py` 的真实执行必须在目标机完成。

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
