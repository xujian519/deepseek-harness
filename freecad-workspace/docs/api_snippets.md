# FreeCAD API 片段库

喂给阶段 4 代理的“事实库”之一。每个片段标注来源：
- `[实现]` —— 本工作区脚本中实际使用的写法，见对应文件。
- `[文档]` —— 取自调研报告引用的 FreeCAD 官方文档，语法与对象类型可信；具体参数需在目标机复核。

## 1. 建模（Part 直接构造）

```python
# [实现] parts/plate.py：矩形板 + 孔阵 + 外角圆角
import FreeCAD as App
import Part

shape = Part.makeBox(L, W, T)
hole = Part.makeCylinder(radius, T + 2, App.Vector(x, y, -1))
shape = shape.cut(hole)                       # 单孔；多孔用 shape.cut(Part.makeCompound(cutters))
shape = shape.makeFillet(radius, edges)       # edges 为外轮廓竖边列表
```

布尔失败的前置检查：

```python
# [文档] Part API 失败时先用 isValid() 定位，再决定余量
if not shape.isValid():
    raise RuntimeError("几何无效")
if shape.Volume <= 0:
    raise RuntimeError("体积非正")
```

## 2. 文档与导出

```python
# [实现] scripts/build.py
import FreeCAD as App
import Part, MeshPart

doc = App.newDocument(f"{part}-{variant}")
obj = doc.addObject("Part::Feature", "Model")
obj.Shape = shape
doc.recompute()

Part.export([obj], str(out / "model.step"))   # STEP
mesh = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.1,
                              AngularDeflection=0.5, Relative=False)
mesh.write(str(out / "model.stl"))            # STL
doc.saveAs(str(out / "model.FCStd"))          # 工程源文件
```

包围盒比对：

```python
bbox = shape.BoundBox                     # [实现] XLength / YLength / ZLength，单位 mm
```

## 3. TechDraw 出图

### 3.1 页面与模板

```python
# [实现] scripts/sheet.py
template = doc.addObject("TechDraw::DrawSVGTemplate", "Template")
template.Template = str(template_path)      # 必须先设置模板路径
page = doc.addObject("TechDraw::DrawPage", "Sheet")
page.Template = template
doc.recompute()

texts = dict(template.EditableTexts)        # [文档] EditableTexts 是字典，重新赋值才生效
texts["FC-Title"] = title
texts["FC-Scale"] = "1:1"
template.EditableTexts = texts
```

### 3.2 投影组（顺序不可换）

```python
# [文档] 必须先 page.addView(group) 再 addProjection
group = doc.addObject("TechDraw::DrawProjGroup", "Views")
page.addView(group)                          # 先入页
group.Source = [model]
group.ProjectionType = "First Angle"
for name in ("Front", "Top", "Left"):
    group.addProjection(name)
doc.recompute()
```

取子视图：

```python
# [实现] scripts/sheet.py：优先 getProjection(name)，没有则遍历 group.Views
view = group.getProjection("Front")         # 1.1 起可用；失败时回退 group.Views
```

### 3.3 尺寸标注

```python
# [文档] 引用的是投影后边编号 EdgeN，不是模型边
dim = doc.addObject("TechDraw::DrawViewDimension", "Dim_overall_x")
dim.Type = "Distance"                        # "Distance" | "Diameter" | "Angle" 等
dim.References2D = [(view, "Edge3")]         # 一条边：直径/单边；两条边：距离
page.addView(dim)
dim.X = float(view.X) + 12
dim.Y = float(view.Y) + 12
```

反查边编号（`scripts/dim_rules.py` 的实现方式）：

```python
# [实现] scripts/sheet.py + dim_rules.py
edges = list(enumerate(view.getVisibleEdges(), start=1))  # 假设 EdgeN 顺序一致
# 按几何规则筛选后引用 f"Edge{number}"
```

### 3.4 导出

```python
# [文档] 整页 DXF 不需要 GUI
import TechDraw
TechDraw.writeDXFPage(page, str(out / "model.dxf"))

# [文档] PDF 必须在 GUI 会话中
import TechDrawGui
TechDrawGui.exportPageAsPdf(page, str(out / "model.pdf"))
```

退出前清修改标记（GUI 模式）：

```python
# [文档] 否则会弹“是否保存”对话框
import FreeCAD as App
import FreeCADGui as Gui
for opened in App.listDocuments().values():
    Gui.getDocument(opened.Name).Modified = False
Gui.getMainWindow().close()
```

## 4. 无头运行

```bash
# [文档] 控制台/脚本/内联三种调用
FreeCADCmd scripts/build.py --pass params/plate-100x60.json
FreeCADCmd "import Part; print(Part.makeBox(10,5,15).Volume)"
xvfb-run -a freecad scripts/sheet.py --pass params/plate-100x60.json --pdf
```

## 5. 客户图纸接入（ezdxf）

```python
# [实现] scripts/import2d.py
import ezdxf
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.config import ColorPolicy, Configuration
from ezdxf.addons.drawing.layout import Margins, Page, Settings
from ezdxf.addons.drawing.svg import SVGBackend
from ezdxf.bbox import extents

doc = ezdxf.readfile(path)
msp = doc.modelspace()
bounds = extents(msp)
page = Page(width=bounds.size.x + 4, height=bounds.size.y + 4,
            margins=Margins(2, 2, 2, 2))
backend = SVGBackend()
Frontend(RenderContext(doc), backend,
        config=Configuration(color_policy=ColorPolicy.BLACK)).draw_layout(msp, finalize=True)
svg = backend.get_string(page, settings=Settings(fit_page=True))  # 不是 modelspace
```

删除实体：

```python
# [实现] 按图层与实体类型清理
for entity in list(msp):
    if entity.dxf.get("layer") in drop_layers:
        msp.delete_entity(entity)
```
