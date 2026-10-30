# 交付清单

生成日期 2026-10-31，FreeCAD 0.21.2（目标版本 1.1.4，API 兼容但未在 1.1.4 实测）。

## 目录

```
plate-100x60/     model.FCStd  model.step  model.stl  model.dxf  model.pdf  dimensions.json  manual_review.md
flange-DN50/      同上
shaft-stepped-3/  同上
bracket-L-100/    同上
```

`model.dxf` 为工程图（A4 横放、三视图、标题栏、尺寸文字）；`model.pdf` 由该 DXF 渲染，几何与 DXF 一致；`model.FCStd` 为可编辑模型；`model.step` / `model.stl` 为交换格式，单位均为毫米。

## 工程图布局

第一角法三视图：主视图在上，俯视图在主视图正下方，左视图在主视图右侧；标题栏在右下角，视图区整体位于其上方。投影朝向得到的是右视图，左视图由其在水平方向镜像得到。视图按图框可用区域自动缩放（不超过 1:1）并居中；同一视图内数值相同的尺寸文字只保留一条。

## 各变体尺寸

| 变体 | 参数来源 | 自动标注 | 人工补标 |
|---|---|---|---|
| plate-100x60 | `params/plate-100x60.json` | 100、60、8×⌀10、厚 8 | `pitch_dia`：未声明 `BCD`，矩形孔阵无节圆 |
| flange-DN50 | `params/flange-DN50.json` | 160、4×⌀17.5、⌀125、厚 20 | 无 |
| shaft-stepped-3 | `params/shaft-stepped-3.json` | 总长 130、⌀40、⌀30、⌀20 | 无 |
| bracket-L-100 | `params/bracket-L100.json` | 100、80、⌀10、厚 10 | `pitch_dia`：未声明 `BCD`，无节圆 |

## 校验

四个 DXF 均通过 `ezdxf` 的 `audit()`（0 error / 0 fix），全部图元落在 297×210 图框内；四个 PDF 为单页 A4 横放（841.89 × 595.28 pt）；STEP 重新导入后体积与包围盒与参数一致（`verify.py` 输出 `PASS 4 个变体`）。

| 变体 | DXF 图元 |
|---|---|
| plate-100x60 | LINE 68 / CIRCLE 8 / ARC 4 / TEXT 9 |
| flange-DN50 | LINE 72 / CIRCLE 6 / TEXT 9 |
| shaft-stepped-3 | LINE 48 / CIRCLE 3 / TEXT 9 |
| bracket-L-100 | LINE 48 / CIRCLE 1 / TEXT 9 |

SHA-256（前 16 位）：

| 变体 | model.dxf | model.pdf | model.step | model.stl | model.FCStd |
|---|---|---|---|---|---|
| plate-100x60 | `c153e13519d0d370` | `26d7e1c0715f8a78` | `e8dae36ab3b05297` | `f8a7842988823d1b` | `806f3d18a40ece67` |
| flange-DN50 | `73da2994442e5a26` | `554e3ba65d25610d` | `0b9d19faeb944d40` | `f9e8025b8759d092` | `a113c85de4ba071e` |
| shaft-stepped-3 | `51f5de273f199868` | `d427cefc08b6aa86` | `c016ac0301ae633a` | `6a36ce91d5298093` | `c23dd6adda2b8987` |
| bracket-L-100 | `3ff34c302d4cedd7` | `d93b830c434d8461` | `fb15c69e68084e1d` | `eb55af52b7e408ad` | `9d9e46b27bba6482` |

DXF 与 STL 逐字节稳定；STEP、FCStd、PDF 含生成时间戳，重建或重渲染后哈希会变，几何内容不变。

## 打开说明

- DXF 为 R12（AC1009），文字按 `$DWGCODEPAGE=ANSI_936`（简体中文 GBK）编码；直径用 AutoCAD 控制码 `%%c`，AutoCAD/LibreCAD 打开后显示为 ⌀。PDF 预览里同一处显示为 `Ø`（内置中文字体没有 U+2300 字形），几何与尺寸值不变。
- 若目标机字体缺失导致中文标题栏显示为问号，在 CAD 里指定任意中文字体（如 SimSun）即可。
- 图元支持直线、整圆、圆弧（圆角）与非圆曲线（细化成短直线段），不写 DIMENSION 实体；尺寸为文字标注（无引线），`status=manual` 的项见各目录 `manual_review.md`，需人工补标。
- 投影未做消隐：孔与相切过渡边按可见线绘制，视图内可能出现阶梯状切线，不影响轮廓与尺寸。

## 复现

```bash
rm -rf scripts/__pycache__ parts/__pycache__ scripts/common/__pycache__
freecadcmd scripts/build.py --pass params/plate-100x60.json
freecadcmd scripts/verify.py --out out
freecadcmd scripts/sheet.py --pass params/plate-100x60.json
python3 scripts/render_pdf.py --dxf out/plate/100x60/model.dxf
```

`out/delivery/` 由 `out/<part>/<variant>/` 的产物汇总而来。PDF 用系统 Python 的 `render_pdf.py` 从 DXF 渲染（依赖 `ezdxf` 与 `reportlab`），不需要 FreeCAD GUI。
