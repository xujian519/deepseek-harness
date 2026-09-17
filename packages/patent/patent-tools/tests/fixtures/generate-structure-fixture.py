"""生成结构线稿真实渲染测试用的 STEP fixture（签入产物见同目录 .step）。

用法：freecadcmd generate-structure-fixture.py

产出一个确定性的「底板 + 立圆柱」组合体（box 40×24×8 mm，圆柱 r6 h16 立于
底板顶面中心），导出为 structure-bracket.step。测试用它验证 FreeCAD TechDraw
多视图投影 + 件号锚定的端到端链路；件号锚点取圆柱顶面中心与底板前上角。

fixture 头部签名一致性（外部审查教训）：本脚本是 fixture 的唯一来源；测试断言
签入的 .step 以 ISO-10303-21 头开始、且几何（solids=1、volume 与本脚本一致）
可由 Part.read 复现——生成器改动时必须同步重跑并复核测试期望值。
"""

import os

import FreeCAD as App
import Part

HERE = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.join(HERE, "structure-bracket.step")

# 底板 40×24×8，原点居中于 xy、底面贴 z=0。
plate = Part.makeBox(40, 24, 8, App.Vector(-20, -12, 0))
# 立圆柱 r6 h16，立于底板顶面（z=8）中心。
post = Part.makeCylinder(6, 16, App.Vector(0, 0, 8))
shape = plate.fuse(post)
shape = shape.removeSplitter()

shape.exportStep(OUTPUT)

check = Part.read(OUTPUT)
print("FIXTURE_SOLIDS", len(check.Solids))
print("FIXTURE_VOLUME", round(check.Volume, 3))
print("FIXTURE_PATH", OUTPUT)
