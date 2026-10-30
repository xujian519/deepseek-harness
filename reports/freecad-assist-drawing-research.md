# 本地 FreeCAD 辅助作图能力调研报告

## 摘要

本报告基于 FreeCAD 官方发布说明、官方 Wiki API 文档、官方博客与插件生态页面，梳理本地 FreeCAD 在“辅助作图”场景下可被调用的全部关键能力，并给出可执行的落地路径。核心结论如下。

1. 当前稳定版为 **FreeCAD 1.1.4**，下一代 **26.3** 已进入 RC 阶段并启用 CalVer（YY.N）版本号；版本策略从“两年一大版”改为“一年三次稳定版”，意味着自动化脚本需要按版本做兼容，而不是按年份做兼容。[cite:2][cite:21][cite:22]
2. 本地能力分为四层：交互参数化建模、宏/Python 控制台、无头 CLI 批处理、MCP/AI 代理。决定效率上限的不是界面操作技巧，而是后两层——即“模型与图纸能否被程序生成并校验”。[cite:5]
3. “辅助作图”必须拆成两条链路：**实体/装配建模**（Sketcher、PartDesign、Part、Assembly、BIM）与**工程出图**（TechDraw）。前者可以完全无头脚本化；后者受 GUI 视口限制，无头模式可稳定产出 DXF/SVG 线稿，但 **PDF 导出需要完整 GUI 会话（Linux 下用 `xvfb-run`）**。[cite:5][cite:27]
4. 参数化落地的最小闭环是：VarSet/Spreadsheet 作为唯一参数源 → 特征树或 Part 脚本生成几何 → `FreeCADCmd` 批量出 STEP/STL → TechDraw 模板 + 视图 + 尺寸 → DXF/PDF + BOM。这条链路可以在本地或 CI 中重复执行。[cite:5][cite:11][cite:30]
5. AI 的合理定位是“会写脚本、能自查错误的实习生”：通过 MCP 接入现有会话，或由代理循环执行“写脚本 → `FreeCADCmd` 运行 → 读错误 → 修正”。让它直接点击 UI 的收益远低于让它维护脚本资产。[cite:23][cite:24][cite:25]

---

## 1. 版本基线与生态现状

| 版本 | 时间/状态 | 对“作图”最关键的变化 |
|---|---|---|
| 1.0 | 2024-11 发布 | 集成 Realthunder 拓扑命名缓解算法；内置 Assembly 工作台（Ondsel 求解器）；新增 `App::VarSet` 与表达式向量支持；Arch 并入 BIM；TechDraw 与草绘体验改进 [cite:3][cite:4][cite:26] |
| 1.1 | 2026-03 发布，当前稳定 1.1.4 | PartDesign 透明预览与交互拖拽手柄；孔工具支持锥度与螺纹；Assembly 增加运动仿真与 **BOM**；Sketcher 增加投影/相交/外部几何；TechDraw 改进吸附、图框开关、注释与尺寸工具；CAM 新刀库系统；BIM 增加视图面板与图层管理；拓扑命名缓解继续改进 [cite:1][cite:2] |
| 26.3 | 2026-10 处于 RC | 首个 CalVer 版本，官方节奏改为每年 3 个稳定版；具体增量以正式发布说明为准 [cite:21][cite:22] |

两个与自动化直接相关的工程事实：

- **内置 Python 为 3.11**（官方各平台安装包均标注 `py311`）。用外部解释器 `import FreeCAD` 时必须匹配 3.11 ABI，否则只能通过 `FreeCADCmd` 执行脚本。[cite:2][cite:5]
- **1.1 起用户配置与数据目录按版本分层**（如 `.../FreeCAD/v1-1/Mod/...`），并支持从旧版本迁移。插件、模板、宏的路径不能再按旧版固定路径硬编码；1.1 新增 `FreeCAD.ApplicationDirectories` 类用于解析这些目录。[cite:1][cite:28]

**对作图的含义**：模板、宏、插件、后处理器都应视为“随版本迁移的资产”，用脚本通过 `App.getUserAppDataDir()` / `ApplicationDirectories` 解析路径，而不是写死家目录。

---

## 2. 能力地图：四层调用方式

| 层次 | 入口 | 典型用途 | 自动化程度 | 关键限制 |
|---|---|---|---|---|
| L1 交互建模 | Sketcher、PartDesign、Part、Surface、Assembly、BIM、Draft | 探索式设计、复杂曲面、装配约束调参 | 低 | 依赖人工操作与视觉反馈 |
| L2 宏与 Python 控制台 | Python Console、宏编辑器、`.FCMacro`、宏仓库 | 重复操作封装、批量改参、定制命令 | 中高 | 仍在 GUI 进程内，受视口与对话框影响 |
| L3 无头 CLI | `FreeCADCmd`、`FreeCAD -c`、`import FreeCAD` 嵌入、`xvfb-run` | 批量生成、CI、服务端出图 | 高 | 无 ViewProvider，TechDraw PDF 受限 [cite:5] |
| L4 服务化/AI | `freecad-mcp`、MCP Bridge 插件、VibeCAD、自建脚本代理 | 自然语言建模、会话内辅助、自动修复 | 中（需校验闭环） | 模型幻觉、API 细节错误、安全边界 [cite:23][cite:24][cite:25] |

L2 与 L3 是效率核心：L2 适合“人在环中”的快速迭代，L3 适合“无人值守”的批量与回归。两者共用同一套 Python API，因此投入应集中在脚本资产，而不是两套独立工作流。

---

## 3. 参数化：把“改图”变成“改数”

### 3.1 单一参数源

FreeCAD 提供三种可组合的参数入口：

- **VarSet**（1.0 引入）：文档内的属性容器，适合放长度、角度、布尔开关等设计变量，表达式编辑器可直接引用，1.1 的表达式编辑器还增强了 VarSet 输入补全。[cite:1][cite:3][cite:4]
- **Spreadsheet**：单元格别名可作为全局变量，适合参数表、系列化规格、配置表（Configuration Tables），并可通过 `Link CopyOnChange` 生成变体实例。[cite:16]
- **表达式**：任意对象属性都可用 `setExpression` 绑定，支持向量运算（1.0 起）。[cite:4]

```python
import FreeCAD as App

doc = App.newDocument("bracket")
params = doc.addObject("App::VarSet", "Params")
params.addProperty("App::PropertyLength", "L", "Base", "总长")
params.addProperty("App::PropertyLength", "W", "Base", "总宽")
params.addProperty("App::PropertyLength", "T", "Base", "板厚")
params.L, params.W, params.T = 120.0, 60.0, 8.0

box = doc.addObject("Part::Box", "Base")
box.setExpression("Length", "Params.L")
box.setExpression("Width",  "Params.W")
box.setExpression("Height", "Params.T")
doc.recompute()
```

### 3.2 用脚本化对象沉淀“零件族”

当同一类零件需要反复生成（法兰、支架、型材、标准件）时，把参数和建模逻辑封装成 FeaturePython 对象，比复制 FCStd 更可持续：属性即接口，改属性触发 `execute()` 重建几何。[cite:15][cite:28]

```python
class Plate:
    def __init__(self, obj):
        obj.addProperty("App::PropertyLength", "Length", "Plate", "长度")
        obj.addProperty("App::PropertyLength", "Width",  "Plate", "宽度")
        obj.Proxy = self

    def execute(self, obj):
        import Part
        obj.Shape = Part.makeBox(obj.Length, obj.Width, 5.0)

# 注册与使用略，完整模板见官方 Manual:Creating parametric objects
```

这类对象的价值在于：装配里放的是“参数化构件”，出图脚本只需遍历对象、读取属性、生成标题栏与 BOM，而不必理解每个零件的内部特征。

### 3.3 建模纪律（直接影响脚本稳定性）

| 纪律 | 原因 | 落地方式 |
|---|---|---|
| 先用主草图/骨架驱动整体 | 减少跨特征引用数量 | Master Sketch + `SubShapeBinder` |
| 不引用“生成出来的面/边”做下游特征 | 拓扑命名变化会导致引用失效 | 引用基准草图、基准面或命名边 |
| 圆角、抽壳、拔模尽量后置 | 布尔与圆角在复杂拓扑上更易失败 | 特征顺序固定为“主体→孔→倒角→圆角” |
| 装配用 `App::Link` 复用而非复制 | 内存与更新成本更低 | 标准件以 Link 实例化 |
| 对象与容器命名稳定 | 脚本与 BOM 依赖名称 | `Std_Part` 分组 + 前缀规范 |

即使 1.0 已集成拓扑命名缓解算法，并解释为“对参数链中的拓扑变化更具韧性”，它也不是无条件免疫；把引用放在稳定基准上仍是成本最低的防御。[cite:3]

---

## 4. 脚本化建模：Part 与 PartDesign 的选择

| 维度 | Part（直接构造 B-Rep） | PartDesign（特征树） |
|---|---|---|
| 适合 | 生成式、批量、参数组合、临时几何 | 需要人工继续编辑、需要特征历史 |
| 脚本难度 | 低，函数式 | 中，需要管理 Body/Sketch/Feature |
| 可维护性 | 逻辑清晰，但“历史”在代码里 | 特征树可视，但脚本重建成本高 |
| 出图友好度 | 生成实体后同样可投影 | 特征树便于局部修改 |

经验规则：**用 Part 生成，用 PartDesign 打磨**。批量件、标准件、变体件用 Part 脚本；需要长期人工维护的主动件用 PartDesign。

### 4.1 Part 脚本示例

```python
import Part
from FreeCAD import Vector

plate = Part.makeBox(120, 60, 8)
hole  = Part.makeCylinder(6, 8, Vector(20, 30, 0))
plate = plate.cut(hole)
plate = plate.fillet(0.5, [e for e in plate.Edges if e.Curve.TypeId == "Part::GeomLine"])

obj = Part.show(plate, "Plate")
Part.export([obj], "plate.step")
```

### 4.2 Sketcher 脚本示例

约束脚本的关键是“几何索引 + 约束类型 + 参数顺序”，官方文档给出了完整约束表；建议先录制宏，再把宏里的调用固化为函数。[cite:14]

```python
import FreeCAD as App, Part, Sketcher

doc = App.newDocument("sk")
sk = doc.addObject("Sketcher::SketchObject", "Sketch")
sk.addGeometry(Part.LineSegment(App.Vector(0, 0, 0), App.Vector(100, 0, 0)), False)
sk.addGeometry(Part.LineSegment(App.Vector(100, 0, 0), App.Vector(100, 50, 0)), False)
sk.addConstraint(Sketcher.Constraint("Coincident", 0, 2, 1, 1))
sk.addConstraint(Sketcher.Constraint("Horizontal", 0))
sk.addConstraint(Sketcher.Constraint("Vertical", 1))
doc.recompute()
```

### 4.3 导出矩阵

| 目标 | 调用 | 说明 |
|---|---|---|
| STEP / IGES | `Part.export([obj], path)` 或 `Import.export(...)` | 交换制造与装配的首选格式 |
| STL / 3MF / OBJ | Mesh 模块导出 | 3D 打印与轻量化预览 |
| DXF | `importDXF.export(objectslist, filename, nospline=False, lwPoly=False)` | 2D 图纸与下游 CAD 交换 [cite:17] |
| IFC | `exportIFC.export(...)` | BIM 交付；PartDesign Body、Std Part、Link 支持度需实测 [cite:19] |
| SVG / PDF | TechDraw 页面导出 | 见第 5 节 |
| G-code | CAM 后处理器 `export(objects, filename, argstring)` | 1.1 已更新刀库与后处理器体系 [cite:1][cite:18] |

---

## 5. 工程出图：TechDraw 全链路

### 5.1 对象模型

TechDraw 的脚本模型是“页面—模板—视图—标注”四层：

- 页面：`TechDraw::DrawPage`
- 模板：`TechDraw::DrawSVGTemplate`，挂到 `page.Template`
- 视图：`TechDraw::DrawViewPart`（单视图）、`TechDraw::DrawProjGroup`（多视图投影组）、`DrawViewSection`、`DrawViewDetail` 等
- 标注：`TechDraw::DrawViewDimension`、`DrawViewBalloon`、`DrawViewAnnotation`、`DrawViewSymbol` 等 [cite:6][cite:10][cite:12][cite:31]

### 5.2 模板：把标题栏变成“可填充表单”

SVG 模板中的文本若带 `freecad:editable`，即成为可编辑字段；1.0 起还支持 `freecad:autofill`，插入模板时按 `author`、`date`、`organization`、`scale`、`sheet`、`title`、`page_number`、`page_count` 等语义字段自动填充。模板对象同时暴露 `EditableTexts` 字典与 `setEditFieldContent()` 方法，适合脚本批量写标题栏。 [cite:8][cite:9][cite:11]

```python
page = doc.addObject("TechDraw::DrawPage", "Sheet")
tpl  = doc.addObject("TechDraw::DrawSVGTemplate", "Tpl")
tpl.Template = App.getResourceDir() + "Mod/TechDraw/Templates/A4_LandscapeTD.svg"
page.Template = tpl

texts = page.Template.EditableTexts
texts["FC-Title"] = "支架总图"
texts["FC-Scale"] = "1:2"
page.Template.EditableTexts = texts
# 或逐个字段：page.Template.setEditFieldContent("FC-Title", "支架总图")
```

实践建议：把企业图框做成“一个 SVG 模板 + 一组语义字段”，脚本只负责填值，不负责画图框；线型组（Line Groups）按 ISO/ANSI 选好，保证线宽与字体一致。

### 5.3 多视图投影组的脚本顺序

官方示例明确：**必须先把投影组加入页面，再添加投影**，这样投影组才能继承页面默认参数。[cite:10]

```python
group = doc.addObject("TechDraw::DrawProjGroup", "Views")
page.addView(group)                 # 先入页
group.Source = [body]
group.ProjectionType = "First Angle"
group.addProjection("Front")        # 第一个成为锚点
group.Anchor.Direction = (0, 1, 0)
group.Anchor.RotationVector = (1, 0, 0)
group.addProjection("Left")
group.addProjection("Top")
group.X, group.Y = page.PageWidth / 2, page.PageHeight / 2
doc.recompute()
```

### 5.4 尺寸标注：可脚本化，但需要反查引用

尺寸对象的 API 形态是“类型 + 二维引用”：

```python
# view：页面上已有的 TechDraw::DrawViewPart（已设置 Source 并 recompute）
dim = doc.addObject("TechDraw::DrawViewDimension", "Dim")
dim.Type = "Distance"
dim.References2D = [(view, "Edge1")]
page.addView(dim)
dim.X, dim.Y = 120, 60
```

难点在于 `"Edge1"` 是投影后的边编号，并非模型里的边。可靠做法是：先 `view.getVisibleEdges()` 取投影边，按几何规则（最长水平边、圆柱轮廓边、槽口边）筛选，再用 `view.getEdgeByIndex(i)` 校验，最后映射为 `Edge{i+1}`。这套反查逻辑应封装成项目内的“标注规则库”，而不是每次让模型自由发挥。[cite:6][cite:12]

尺寸、注释、中心线、螺纹装饰、焊接符号、表面粗糙度、孔轴配合等都有对应的脚本接口或扩展工具；社区宏 `TechDrawTools` 还把 38 个绘图修饰操作封装成可复用命令，适合直接改造。[cite:6]

### 5.5 导出：无头与 GUI 的硬边界

| 输出 | 推荐调用 | 是否需要 GUI | 适用场景 |
|---|---|---|---|
| 单视图 DXF | `TechDraw.viewPartAsDxf(view)` / `TechDraw.writeDXFView()` | 否 | 下游 CAD 继续编辑 |
| 整页 DXF | `TechDraw.writeDXFPage(page, path)` | 否（仍需先重算视图） | 车间/供应商交换 [cite:30] |
| 单视图 SVG 线段 | `TechDraw.viewPartAsSvg(view)` | 否 | 网页预览、嵌入文档 [cite:6] |
| 整页 SVG / PDF | `TechDrawGui.exportPageAsPdf(page, path)` 等 | **是** | 正式图纸交付 [cite:7] |

原因不是“导出函数坏了”，而是无头模式根本不创建 ViewProvider：`page.ViewObject` 不存在，依赖视口的渲染与打印路径无法执行。[cite:5] 社区长期反馈也指向同一结论：TechDraw 页面导出依赖 GUI 会话。[cite:27]

因此，Linux 下的可靠方案是完整 GUI + 虚拟显示：

```bash
xvfb-run -a FreeCAD /path/to/make_drawings.py
```

脚本结束时要主动退出，否则会挂在 Qt 事件循环里；退出前清除文档修改标记，避免“是否保存”对话框阻塞：

```python
import FreeCAD as App
import FreeCADGui as Gui

for doc in App.listDocuments().values():
    Gui.getDocument(doc.Name).Modified = False
Gui.getMainWindow().close()
```

若仍有模态对话框导致无法退出，才使用 `os._exit(0)` 作为兜底；它会跳过正常清理，可能残留锁文件。[cite:5]

### 5.6 2D 制图与 BIM 出图

- **Draft**：用于 2D 绘图、描图、导入 DXF 作为底图再建模；`importDXF.export` 可把 Draft 对象直接导出为 DXF。[cite:17]
- **BIM**：1.0 起 Arch 并入 BIM；典型出图流程是“剖面平面（SectionPlane）→ 2D 视图 → TechDraw 页面”，适合建筑平立剖。[cite:4]
- **IFC**：BIM 对象与 IFC 双向交换是官方能力，但 PartDesign Body、Std Part、Link 等结构在 IFC 中的表达并非完全等价，交付前需要抽查。[cite:19]

### 5.7 能力边界：GD&T

官方文档明确说明 TechDraw 对 GD&T（ISO 1101 / ASME Y14.5）的支持“有限”，已有部分实现，其余需要借助符号、注释与技巧补齐。[cite:13] 这意味着：

- 常规尺寸、公差文字、基准符号、表面粗糙度、焊接符号可以覆盖多数机械图；
- 完整的形位公差框格、复合公差、基准体系需要模板化 SVG 符号 + 注释拼装，或引入 GD&T 类插件；
- 若企业标准要求严格 GD&T，建议把“符号库 + 检查清单”作为独立资产维护，而不是期待一键生成。

---

## 6. 无头流水线：把作图变成可重复构建

### 6.1 执行方式

| 方式 | 命令 | 适用 |
|---|---|---|
| 控制台交互 | `FreeCADCmd` 或 `FreeCAD -c` | 调试 API |
| 执行脚本文件 | `FreeCADCmd build.py` | 推荐的非平凡任务 [cite:5] |
| 执行内联代码 | `FreeCADCmd "import Part; print(Part.makeBox(10,5,15).Volume)"` | 单行检查 |
| 嵌入外部 Python | `sys.path.append(.../lib); import FreeCAD` | 与既有 Python 工具链集成 |
| 完整 GUI 虚拟显示 | `xvfb-run -a FreeCAD script.py` | TechDraw 页面/PDF |

脚本模式下 FreeCAD 环境已初始化，不需要 `sys.path.append`；但工作台模块（`Mod/` 下的 PartDesign 等）可能不在搜索路径中，导致对象被反序列化为通用类型或导入失败，此时需显式追加 `Mod` 路径。[cite:5]

### 6.2 流水线形态

```
params/*.json ──► scripts/build.py ──► out/<part>.FCStd
                                   ├─► out/<part>.step
                                   ├─► out/<part>.stl
                                   └─► out/<part>.dxf
                                   └─► sheets/<part>.pdf   (xvfb)
```

```bash
#!/usr/bin/env bash
set -euo pipefail
FREECAD=${FREECAD:-FreeCADCmd}
for p in params/*.json; do
  "$FREECAD" scripts/build.py --pass "$p"
done
```

脚本内的工程要点：

| 要点 | 做法 |
|---|---|
| 参数解析 | 读 `sys.argv` 中的 JSON/CSV 路径；避免依赖工作目录 |
| 幂等 | 每次新建文档或清空目标文档，不追加到旧文档 |
| 失败可见 | 捕获异常后 `print` 到 stderr 并以非零码退出；CI 依赖退出码 |
| 日志 | `FreeCAD.Console.PrintMessage/PrintError`，或用 `--log-file` |
| 超时 | 外部 `timeout` 包裹，防止布尔/网格运算卡死 |
| 版本 | 记录 `App.Version()` 与脚本提交号，便于复现 |

### 6.3 平台差异

| 平台 | 可执行文件 | 注意 |
|---|---|---|
| Windows | `FreeCADCmd.exe`、`bin\python.exe` | 路径分隔符用 `/` 或转义；插件装在版本化 `Mod` 目录 |
| macOS | `FreeCAD.app/Contents/MacOS/FreeCADCmd` | 嵌入库路径为 `Contents/Resources/lib` [cite:5] |
| Linux | `FreeCADCmd`、AppImage | AppImage 需解包或直接以 AppImage 调用；虚拟显示用 `xvfb-run` |

---

## 7. AI 代理接入：MCP 与自然语言建模

### 7.1 三种主流形态

| 形态 | 架构 | 优点 | 风险/限制 |
|---|---|---|---|
| `freecad-mcp`（neka-nat） | FreeCAD 插件内启动 RPC 服务 + MCP 服务器（`uvx freecad-mcp`）+ MCP 客户端 | 工具集完整，可建模、执行脚本、检查文档、跑 FEM；社区活跃 [cite:23] | 需要保持 GUI 会话；模型对 API 细节易出错 |
| MCP Bridge 插件 | FreeCAD 内提供 XML-RPC/JSON-RPC 桥，供本地 MCP 客户端连接 | 直接复用已打开的会话与现有模型；官方插件目录可见 [cite:24][cite:29] | 端口与权限需自行管控；仍是“会话内操作” |
| VibeCAD 类代理 | 宿主模型负责推理，代理负责 CAD 契约、隔离执行、确定性校验 | 把“生成—校验—修复”做成产品化闭环 [cite:25] | 依赖宿主模型额度；需信任其执行沙箱 |

另有一类工作台直接在 FreeCAD 内用 `exec()` 执行模型生成的 Python。这类方案便利与风险并存：生成代码可能读写任意文件或访问网络，部署时应限定网络出口、文件权限与可写目录，并保留执行日志以便回溯。

### 7.2 更稳的代理形态：脚本闭环，而非 UI 操作

对比“让 AI 点界面”，以下闭环的可验证性高一个数量级：

```
需求/参数表 → 代理生成 build.py → FreeCADCmd 执行 → 读 stderr/几何校验
          → 修正脚本 → 重新执行 → 产出 STEP + 图纸
```

校验点建议固化为断言：

- `Shape.isValid()`、`Shape.Volume > 0`、包围盒尺寸与参数表一致；
- 特征数、孔位坐标、孔径与 BOM 行数一致；
- 图纸页存在、视图数 ≥ 3、标题栏字段非空、DXF 行数非零；
- 同一输入重复执行两次，输出 STEP 的包围盒与体积在容差内一致。

这比“看截图判断像不像”可靠，也便于回归。

### 7.3 提示与安全边界

- **给约束，不给散文**：把需求转成“参数表 + 特征顺序 + 验收标准”，模型才有稳定输出。
- **提供 API 样例**：把本项目已验证的 `addObject`/`setExpression`/`References2D` 片段作为上下文，显著降低属性名臆造。
- **只读优先**：先让代理读文档、量尺寸、列对象；写操作限定在副本目录。
- **禁网与限权**：MCP 服务默认绑定 localhost；执行环境用容器或受限用户；生产文件只读挂载。
- **版本控制**：`.FCStd` 本质是 zip 包，可解压后对 XML 做 diff；配合 `git` 管理脚本、模板、参数表，而不是只存二进制。

---

## 8. 工程化实践清单

| 主题 | 建议 |
|---|---|
| 目录 | `templates/`（SVG 图框）、`macros/`、`parts/`（零件族 FCStd）、`params/`（参数表）、`scripts/`、`out/` |
| 命名 | 对象名用英文短横线/下划线，显示名用中文；BOM 与脚本按对象名取数 |
| 参数 | 一个文档一个 VarSet 或一张 Spreadsheet；禁止参数散落在各特征里 |
| 模板 | 图框、标题栏、线型组、字体统一；字段用 `freecad:autofill` 语义命名 |
| 出图 | 尺寸规则库 + 视图模板；标注位置由规则计算，不手填坐标 |
| 性能 | 批量时集中 `recompute()`；大装配用 Link；避免深度布尔链 |
| 稳定 | 固定特征顺序；圆角后置；关键尺寸用基准草图承载 |
| 交付 | STEP（制造）、DXF（二维）、PDF（签审）、BOM（采购）、FCStd（源文件） |

---

## 9. 常见故障与对策

| 现象 | 常见原因 | 对策 |
|---|---|---|
| 参数一改，特征报“链接对象丢失” | 引用了生成面的拓扑名 | 改引基准草图/基准面；固定特征顺序 [cite:3] |
| 布尔运算失败或结果破碎 | 共面、零厚度、微小间隙 | 留 0.01–0.1 mm 余量；先 `isValid()` 检查 |
| 圆角失败 | 相邻边冲突、半径过大 | 圆角后置；拆分为多次小半径；改用变半径 |
| TechDraw 视图空白/红叉 | 模板路径错误、视图未重算、无 GUI 视口 | 用 `getResourceDir()` 拼模板路径；`recompute()`；PDF 走 `xvfb-run` [cite:5][cite:27] |
| 无头导出 PDF 失败 | 无 ViewProvider | 改用完整 GUI + 虚拟显示 [cite:5] |
| 中文字段显示异常 | 模板字体缺字/字体未嵌入 | 图框 SVG 内嵌字体或改用系统可用字体 |
| 插件“装了但没生效” | 1.1 后目录按版本分层 | 放到 `.../FreeCAD/v1-1/Mod/`；检查插件管理器日志 [cite:1][cite:28] |
| 外部 Python `import FreeCAD` 失败 | ABI 与内置 3.11 不匹配 | 改用 `FreeCADCmd`，或用同版本 Python [cite:2] |
| 同一 FCStd 并发写坏 | 单文档锁与多进程 | 一次只开一个实例；批量任务串行或按文件分片 |
| 大装配卡顿 | 全量重算 + 复制实例 | Link 实例化；冻结子装配；关闭自动重算 |

---

## 10. 分阶段落地路线

| 阶段 | 目标 | 交付物 | 验收 |
|---|---|---|---|
| 0 基线 | 统一版本与目录 | 1.1.4 安装、版本化 Mod 路径、模板/宏仓库 | `FreeCADCmd --version`、模板可插入、宏可运行 |
| 1 参数化模板库 | 把常用件变成“改数即改图” | 3–5 个零件族（FCStd + VarSet/FeaturePython） | 改参数后几何有效、尺寸一致 |
| 2 脚本流水线 | 无人值守生成 | `scripts/build.py` + `params/` + STEP/STL 输出 | 批量执行零失败，重复执行结果一致 |
| 3 出图自动化 | 图纸随模型更新 | SVG 图框 + 投影组 + 尺寸规则 + DXF/PDF | 标题栏自动填充、视图齐全、PDF 可打印 |
| 4 AI 代理 | 自然语言驱动与自修复 | MCP 接入 + 校验断言 + 只读/副本策略 | 代理改动可回滚，校验全通过 |

顺序不应颠倒：没有阶段 2 的脚本资产，阶段 4 的代理只是在放大不确定性；没有阶段 1 的参数源，阶段 3 的图纸无法随模型自动更新。

---

## 11. 结论与未验证项

**结论**：本地 FreeCAD 的“辅助作图”能力已经足以支撑一条完整的工程链路——参数化建模、脚本化生成、工程图输出、批量交付——前提是把资产组织成“参数表 + 脚本 + 模板 + 校验”，并把 TechDraw 的 GUI 依赖显式纳入流水线设计。真正稀缺的不是功能，而是**可复用的脚本与模板资产**。

**未验证/需实测项**（不在本报告结论强度内）：

- 1.1.4 下 `TechDraw.writeDXFPage` 与 `viewPartAsSvg` 在纯 `FreeCADCmd` 环境中的完整度（线宽、标注、图框是否保留）需以本机实测为准；保守方案仍是 `xvfb-run` 全 GUI。
- 26.3 尚处 RC，其 API 增量与行为变化以正式发布说明为准。
- DWG 读写依赖外部转换器，非 FreeCAD 内置能力；本报告未对具体转换器版本做验证。
- 各平台打包差异（AppImage、Snap、便携版）对字体、插件路径、虚拟显示的影响需按实际安装方式验证。

---

## 资料来源

[cite:1] FreeCAD 1.1 Notes — https://freecad.github.io/Website/releases/1-1/
[cite:2] FreeCAD 下载页（当前稳定版 1.1.4，安装包标注 py311） — https://www.freecad.org/downloads.php?lang=zh_CN
[cite:3] FreeCAD Version 1.0 Released — https://blog.freecad.org/2024/11/19/freecad-version-1-0-released/
[cite:4] Release notes 1.0 — https://wiki.freecad.org/Release_notes_1.0
[cite:5] Headless FreeCAD — https://wiki.freecad.org/Headless_FreeCAD
[cite:6] TechDraw API — https://wiki.freecad.org/TechDraw_API
[cite:7] TechDrawGui API — https://wiki.freecad.org/TechDrawGui_API
[cite:8] Svg Namespace（`freecad:editable` / `freecad:autofill`） — https://wiki.freecad.org/Svg_Namespace
[cite:9] TechDraw Templates — https://wiki.freecad.org/TechDraw_Templates/en
[cite:10] TechDraw ProjectionGroup — https://wiki.freecad.org/TechDraw_ProjectionGroup
[cite:11] TechDraw PageTemplate（EditableTexts / setEditFieldContent） — https://wiki.freecad.org/TechDraw_PageTemplate
[cite:12] TechDraw Dimension Length（References2D 脚本） — https://wiki.freecad.org/TechDraw_Dimension_Length
[cite:13] TechDraw Geometric dimensioning and tolerancing — https://wiki.freecad.org/TechDraw_Geometric_dimensioning_and_tolerancing
[cite:14] Sketcher scripting — https://wiki.freecad.org/Sketcher_scripting
[cite:15] Manual:Creating parametric objects — https://wiki.freecad.org/Manual:Creating_parametric_objects/en
[cite:16] Spreadsheet Workbench（别名、配置表、CopyOnChange） — https://wiki.freecad.org/Spreadsheet_Workbench
[cite:17] Draft DXF（`importDXF.export`） — https://wiki.freecad.org/Draft_DXF
[cite:18] CAM scripting — https://wiki.freecad.org/CAM_scripting
[cite:19] Arch IFC — https://wiki.freecad.org/Arch_IFC/en
[cite:21] New FreeCAD versioning scheme and development cycle（CalVer YY.N） — https://blog.freecad.org/2026/06/26/new-freecad-versioning-scheme-and-development-cycle/
[cite:22] FreeCAD News（26.3 RC 进展） — https://blog.freecad.org/?query-8-page=5
[cite:23] freecad-mcp（PyPI） — https://pypi.org/project/freecad-mcp/
[cite:24] MCP Bridge 插件 — https://github.com/CREATeNG/freecad-mcp-bridge
[cite:25] VibeCAD — https://pypi.org/project/vibecad/
[cite:26] FreeCAD Features（内置 Assembly / Ondsel 求解器） — https://www.freecad.org/features.php
[cite:27] FreeCAD Forum：Headless export of Drawing to svg/pdf — https://forum.freecad.org/viewtopic.php?t=21384
[cite:28] FreeCAD Addon Academy：Custom document objects — https://freecad.github.io/Addon-Academy/Guides/Code/Document-Objects/
[cite:29] FreeCAD Addons 目录（MCP Bridge、CadQuery 等） — https://freecad.github.io/Website/download/addons/
[cite:30] TechDraw ExportPageDXF（`writeDXFPage`） — https://wiki.freecad.org/TechDraw_SaveDXF
[cite:31] TechDraw SectionView — https://wiki.freecad.org/TechDraw_NewSection
