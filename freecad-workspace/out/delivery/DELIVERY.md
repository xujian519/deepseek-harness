# 交付清单

生成日期 2026-10-31，FreeCAD 0.21.2（目标版本 1.1.4，API 兼容但未在 1.1.4 实测）。

## 目录

```
plate-100x60/     model.FCStd  model.step  model.stl  model.dxf  dimensions.json  manual_review.md
flange-DN50/      同上
shaft-stepped-3/  同上
bracket-L-100/    同上
```

`model.dxf` 为工程图（A4 横放、三视图、标题栏、尺寸）；`model.FCStd` 为可编辑模型；`model.step` / `model.stl` 为交换格式，单位均为毫米。

## 各变体尺寸

| 变体 | 参数来源 | 自动标注 | 人工补标 |
|---|---|---|---|
| plate-100x60 | `params/plate-100x60.json` | 100、60、8×⌀10、厚 8 | `pitch_dia`：未声明 `BCD`，矩形孔阵无节圆 |
| flange-DN50 | `params/flange-DN50.json` | 160、160、4×⌀17.5、⌀125、厚 20 | 无 |
| shaft-stepped-3 | `params/shaft-stepped-3.json` | 总长 130、⌀40、⌀30、⌀20 | 无 |
| bracket-L-100 | `params/bracket-L100.json` | 100、80、⌀10、厚 10 | `pitch_dia`：未声明 `BCD`，无节圆 |

## 校验

四个 DXF 均通过 `ezdxf` 的 `audit()`（0 error / 0 fix），全部图元落在 297×210 图框内；STEP 重新导入后体积与包围盒与参数一致（`verify.py` 输出 `PASS 4 个变体`）。

SHA-256（前 16 位）：

| 变体 | model.dxf | model.step | model.stl | model.FCStd |
|---|---|---|---|---|
| plate-100x60 | `29a10a89229dbb8a` | `da5a4ccaae496897` | `f8a7842988823d1b` | `98bbc50e32b49fd8` |
| flange-DN50 | `51d172eafb3d88bb` | `41a44d5b8402ae45` | `f9e8025b8759d092` | `0e83bf1555c9a2bc` |
| shaft-stepped-3 | `38f5cd21c55e7006` | `11472c88fc7da4f1` | `6a36ce91d5298093` | `d9a4bbf237dd953c` |
| bracket-L-100 | `ac4eab5539cfd2bc` | `3eb440e66ddd0bae` | `eb55af52b7e408ad` | `80726f68758c3495` |

## 打开说明

- DXF 为 R12（AC1009），文字按 `$DWGCODEPAGE=ANSI_936`（简体中文 GBK）编码；直径用 AutoCAD 控制码 `%%c`，AutoCAD/LibreCAD 打开后显示为 ⌀。
- 若目标机字体缺失导致中文标题栏显示为问号，在 CAD 里指定任意中文字体（如 SimSun）即可。
- 图中尺寸为文字标注（无引线），`status=manual` 的项见各目录 `manual_review.md`，需人工补标。

## 复现

```bash
rm -rf scripts/__pycache__ parts/__pycache__ scripts/common/__pycache__
freecadcmd scripts/build.py --pass params/plate-100x60.json
freecadcmd scripts/verify.py --out out
freecadcmd scripts/sheet.py --pass params/plate-100x60.json
```

`out/delivery/` 由 `out/<part>/<variant>/` 的产物汇总而来；PDF 需 GUI（`xvfb-run -a freecad ... --pdf`），当前沙箱未安装 `xvfb-run`，未产出。
