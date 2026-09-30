"""生成装配多实体真实渲染测试用的第二个 STEP fixture（签入产物见同目录 .step）。

用法：freecadcmd generate-structure-pin-fixture.py

产出一个确定性的圆柱销（r3 h40，立于 x=30 处，z 从 0 到 40），导出为
structure-pin.step。它与 structure-bracket.step（40×24×8 底板 + r6 h16 立圆柱）
一起用于 `model_paths` 装配体投影：销在底板 x 范围（±20）之外，故「两个零件一起
投影」的图面比单独投影底板明显更宽，件号归属核对也能用底板上没有的点构造反例。

fixture 头部签名一致性（外部审查教训）：本脚本是 fixture 的唯一来源；测试断言
签入的 .step 以 ISO-10303-21 头开始、且几何（solids=1、volume 与本脚本一致）
可由 Part.read 复现——生成器改动时必须同步重跑并复核测试期望值。
"""

import os

import FreeCAD as App
import Part

HERE = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.join(HERE, "structure-pin.step")

# 圆柱销 r3 h40，底面贴 z=0，轴线在 x=30（底板 x 范围 ±20 之外）。
shape = Part.makeCylinder(3, 40, App.Vector(30, 0, 0))

shape.exportStep(OUTPUT)

check = Part.read(OUTPUT)
print("FIXTURE_SOLIDS", len(check.Solids))
print("FIXTURE_VOLUME", round(check.Volume, 3))
print("FIXTURE_PATH", OUTPUT)
