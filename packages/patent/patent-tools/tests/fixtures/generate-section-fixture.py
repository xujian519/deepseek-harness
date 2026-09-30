"""生成剖切几何真实渲染测试用的 STEP fixture（签入产物见同目录 .step）。

用法：freecadcmd generate-section-fixture.py

产出一个确定性的「带两个通孔的底板」（60×30×8 mm 的板，两个 r5 通孔位于 x = ±15），
导出为 section-holes-plate.step。测试用它验证无文档 OCCT 剖切：z = 4 的剖切面应切出
一个 60×30 外环与两个 r5 圆孔内环，环点列与面积可与解析值逐值核对。

fixture 头部签名一致性（外部审查教训）：本脚本是 fixture 的唯一来源；测试断言
签入的 .step 以 ISO-10303-21 头开始、且几何（solids=1、volume 与本脚本一致）可由
Part.read 复现 —— 生成器改动时必须同步重跑并复核测试期望值。
"""

import os

import FreeCAD as App
import Part

HERE = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.join(HERE, "section-holes-plate.step")

# 底板 60×30×8，原点居中于 xy、底面贴 z=0。
plate = Part.makeBox(60, 30, 8, App.Vector(-30, -15, 0))
# 两个 r5 通孔（沿 z 贯穿），位于 x = ±15 的对称位置。
for center_x in (-15.0, 15.0):
    plate = plate.cut(Part.makeCylinder(5, 8, App.Vector(center_x, 0, 0)))
shape = plate.removeSplitter()

shape.exportStep(OUTPUT)

check = Part.read(OUTPUT)
print("FIXTURE_SOLIDS", len(check.Solids))
print("FIXTURE_VOLUME", round(check.Volume, 3))
print("FIXTURE_PATH", OUTPUT)
