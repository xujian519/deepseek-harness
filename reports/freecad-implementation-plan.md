# FreeCAD 辅助作图落地实施计划

> 依据：《本地 FreeCAD 辅助作图能力调研报告》（`reports/freecad-assist-drawing-research.md`）
> 目标版本：FreeCAD 1.1.4（稳定版）；26.3 发布后再做一次兼容性回归。

## 1. 目标与范围

**总目标**：在本地建立一条“参数表 → 三维模型 → 工程图纸 → 交付文件”的可重复流水线，使改参数即可改模型、改模型即可出图，且全过程可批量执行、可校验、可回滚。

**范围内**

- 机械零件与小型装配的参数化建模、批量生成、TechDraw 出图。
- `FreeCADCmd` 无头批处理与 Linux 下 `xvfb-run` 出 PDF。
- 客户既有二维图纸（DWG/DXF）的接入：格式转出、图层清理、专利附图线稿化，并接回既有标号与核验链。
- 以脚本资产为中心的 AI/MCP 辅助（生成脚本、执行、校验、修复）。
- 模板、宏、插件、参数表的版本化管理。

**范围外（本期不做）**

- 复杂自由曲面、逆向工程、CAM 刀路与 FEM 仿真（保留接口，不纳入验收）。
- 由二维图纸反求三维模型（DWG 路径只做转出与清理，不做几何重建）。
- BIM 全流程出图（仅保留 SectionPlane → TechDraw 的验证用例）。
- 企业 PDM/PLM 集成、多人并发编辑同一 FCStd。

**成功判据（整体）**

1. 新增一个零件族，只需提供 FCStd 模板 + 参数 JSON，不写新代码即可产出 STEP/STL/DXF/PDF。
2. 批量执行 10 个变体零失败，重复执行结果在容差内一致。
3. 图纸标题栏自动填充，视图、尺寸、图框符合内部制图规范。
4. AI 代理的每次改动都经过断言校验，失败可定位到脚本行。
5. 一份客户 DWG 经转换与清理后，无需重绘即可产出合规线稿 SVG，并进入标号与核验链；无法自动判定的部分进入人工清单。

---

## 2. 阶段 0：基线与工作区（先做，阻塞后续）

### 2.1 环境校验

```bash
FreeCADCmd --version                 # 期望 1.1.4
FreeCADCmd "import Part; print(Part.makeBox(10,5,15).Volume)"   # 期望 750.0
FreeCADCmd -c "import TechDraw; print('techdraw ok')"           # 控制台可用
xvfb-run --help >/dev/null && echo xvfb-ok                      # 仅 Linux 出 PDF 需要
```

Windows 用 `FreeCADCmd.exe`，macOS 用 `FreeCAD.app/Contents/MacOS/FreeCADCmd`；若外部 Python 需 `import FreeCAD`，必须是 3.11 ABI。

### 2.2 目录结构（固定下来，后续阶段只往里填）

```
freecad-workspace/
├── templates/        # SVG 图框：A4/A3，含 freecad:editable 与 freecad:autofill 字段
├── macros/           # .FCMacro 与可复用辅助模块
├── parts/            # 零件族 FCStd 源文件（每个族一个）
├── params/           # JSON 参数表（每个变体一个）
├── incoming/         # 客户原始图纸（DWG/DXF/PDF），按案件分子目录，只读
├── scripts/          # build.py / sheet.py / validate.py / import2d.py / common/
├── out/              # 生成物，按 <part>/<variant>/ 分层
├── docs/             # 命名规范、字段字典、标注规则、评审记录
└── README.md
```

### 2.3 关键配置

| 项 | 设置 | 验收 |
|---|---|---|
| 用户目录 | 用 `App.getUserAppDataDir()` / `ApplicationDirectories` 解析，不硬编码家目录 | 脚本在 1.1 的 `v1-1` 目录下能找到模板与宏 |
| 插件 | 安装到版本化 `Mod/` 目录；记录版本清单 | 启动后插件可用，清单入库 |
| 单位 | 毫米、度；小数位与图纸一致 | 参数表与图纸数值一致 |
| 线型组 | TechDraw 线型组固定为 ISO 或企业标准 | 新页面默认线宽正确 |
| 模板 | 企业图框转成 SVG，字段命名统一 | 插入模板后 `EditableTexts` 可枚举 |

### 2.4 阶段 0 交付

- 可运行的 `FreeCADCmd` 环境与 `xvfb`（Linux）。
- 目录骨架、模板库首个图框、插件清单、`docs/命名规范.md`。
- 一条冒烟脚本：建盒 → 导出 STEP → 重新导入 → 校验体积。

---

## 3. 阶段 1：参数化零件族

### 3.1 选型（建议 3–5 个，覆盖典型特征）

| 类型 | 关键特征 | 用途 |
|---|---|---|
| 板类件 | 外形、孔阵、倒角 | 验证草图 + 孔 + 圆角 |
| 法兰 | 回转体、螺栓孔圆周阵列、密封面 | 验证旋转 + 阵列 + 装配 |
| 轴类 | 多段回转、键槽、倒角 | 验证尺寸链与公差标注 |
| 支架 | 拉伸、筋、切除 | 验证多特征顺序稳定性 |

### 3.2 参数源与命名

- 每个零件族一个 FCStd，内部一个 VarSet（或一张 Spreadsheet）作为**唯一参数源**，禁止参数散落在特征属性里。
- 参数名用英文短名（`L`、`W`、`T`、`D`、`N_HOLES`），显示名用中文。
- 参数表用 JSON，字段固定：`part`、`template`、`variant`、`params`、`outputs`。

```json
{
  "part": "flange",
  "template": "parts/flange.FCStd",
  "variant": "DN50-PN16",
  "params": { "D": 50.0, "OD": 165.0, "T": 20.0, "N_HOLES": 4, "HOLE_D": 18.0 },
  "outputs": ["step", "stl", "dxf"]
}
```

### 3.3 建模纪律（写进 `docs/` 并作为评审项）

1. 主草图/骨架驱动整体，跨体引用走 `SubShapeBinder`。
2. 不引用生成面/生成边做下游特征；必须引用时改用基准草图或命名基准。
3. 特征顺序固定：主体 → 孔/切除 → 倒角 → 圆角。
4. 圆角、抽壳、拔模后置；失败时降半径或拆分。
5. 装配用 `App::Link` 实例化，不复制实体。

### 3.4 阶段 1 验收

- 每个零件族改任一关键参数后 `recompute()` 成功、`Shape.isValid()` 为真。
- 包围盒尺寸与参数表一致（容差 0.1 mm）。
- 同一零件族的 2 个变体可通过参数表切换，不需要手工改模型。
- 评审记录归档：参数表、特征截图、已知限制。

---

## 4. 阶段 2：脚本化生成与导出

### 4.1 `scripts/build.py` 接口契约

| 项 | 约定 |
|---|---|
| 入参 | `--params <json>`、`--out <dir>`、`--formats step,stl` |
| 幂等 | 每次新建文档或清空目标对象，不在旧文档上追加 |
| 输出 | `out/<part>/<variant>/model.FCStd`、`model.step`、`model.stl`、`manifest.json` |
| 退出码 | 0 成功；2 参数错误；3 几何无效；4 导出失败 |
| 日志 | `FreeCAD.Console.PrintMessage/PrintError`，同时写 `build.log` |
| 清单 | `manifest.json` 记录 `App.Version()`、参数哈希、包围盒、体积、时间戳 |

```bash
FreeCADCmd scripts/build.py --pass params/flange-DN50.json
```

Windows 下同样通过 `--pass` 传递参数；脚本从 `sys.argv` 取路径，不依赖当前工作目录。

### 4.2 校验脚本 `scripts/validate.py`

对每个产物断言：

1. `Shape.isValid()` 为真，体积 > 0。
2. 包围盒三向尺寸与参数表一致（容差 0.1 mm）。
3. STEP 重新导入成功，体积与源模型误差 < 0.1%。
4. STL 三角面数 > 0，无非流形警告（允许打印级容差）。
5. 同一输入连续执行两次，包围盒与体积一致（不比较文件哈希，STEP 含时间戳）。

### 4.3 批处理

```bash
#!/usr/bin/env bash
set -euo pipefail
FREECAD=${FREECAD:-FreeCADCmd}
for p in params/*.json; do
  timeout 300 "$FREECAD" scripts/build.py --pass "$p" || { echo "FAIL $p"; exit 1; }
done
timeout 300 "$FREECAD" scripts/validate.py --pass out/ || exit 1
```

### 4.4 阶段 2 验收

- 全部参数文件批量执行零失败，总耗时记录在案（用于后续性能基线）。
- 任一参数改动后，`manifest.json` 中的包围盒随之变化。
- 故意注入错误参数（负值、零孔距）时，脚本以非零码退出并给出可读错误。

---

## 5. 阶段 3：TechDraw 出图自动化

### 5.1 模板准备

- 图框 SVG 必须包含 `freecad:editable` 字段；标题栏字段使用 `freecad:autofill` 语义名：`title`、`scale`、`sheet`、`page_number`、`page_count`、`author`、`date`、`organization`。
- 建立字段字典 `docs/字段字典.md`，脚本按字典填值，不在代码里散落字符串。

### 5.2 出图脚本 `scripts/sheet.py`

固定执行顺序：

1. 打开零件 FCStd（只读副本）。
2. 新建 `TechDraw::DrawPage` + `DrawSVGTemplate`，设置 `page.Template`。
3. 填 `EditableTexts`（标题、比例、图号、页码）。
4. 建 `DrawProjGroup`，**先 `page.addView(group)` 再 `addProjection`**；设置 `ProjectionType`、锚点方向。
5. 按需加剖视图、局部放大图；视图位置由页面尺寸计算，不手填坐标。
6. 尺寸标注走规则库（见 5.3）。
7. 导出：`TechDraw.writeDXFPage(page, path)`；GUI 模式下追加 `TechDrawGui.exportPageAsPdf`。

### 5.3 标注规则库 `scripts/dim_rules.py`

尺寸引用的是投影后的 `EdgeN`，不是模型边。规则库负责“语义 → 引用”的映射：

| 规则名 | 选取逻辑 | 输出 |
|---|---|---|
| `overall_x` | `getVisibleEdges()` 中 x 跨度最大的水平边 | 总长尺寸 |
| `overall_y` | y 跨度最大的竖直边 | 总宽/总高 |
| `hole_dia` | 直径等于参数 `HOLE_D` 的圆边 | 孔径 + 数量前缀 |
| `pitch_dia` | 圆心落在同一圆周上的边组 | 节圆直径 |
| `thickness` | 最短平行边对的间距 | 板厚 |

每条规则产出一个 `TechDraw::DrawViewDimension`，并记录“规则名 → 引用边 → 数值”三元组到 `dimensions.json`，便于比对与回归。

无法自动判定的尺寸进入 `manual_review.md`，由人工补标；**不允许**让脚本随机挑边。

### 5.4 PDF 导出（唯一需要 GUI 的环节）

```bash
xvfb-run -a freecad scripts/sheet.py --pass params/flange-DN50.json
```

脚本末尾必须清修改标记再关闭主窗口，否则会挂在“是否保存”对话框：

```python
for doc in App.listDocuments().values():
    Gui.getDocument(doc.Name).Modified = False
Gui.getMainWindow().close()
```

若仅需 DXF/SVG，可直接用 `FreeCADCmd`，但需实测线宽、图框与标注是否完整；不完整则统一走 `xvfb-run`。

### 5.5 阶段 3 验收

- 每个变体产出 1 个 DXF 与 1 个 PDF；页面视图数 ≥ 3（主视、俯视、侧视）。
- 标题栏 8 个字段全部非空，图号与参数表一致。
- DXF 能被下游 CAD 打开，图层与线宽符合约定。
- PDF 打印预览无裁切、无空白页；文字不溢出图框。
- 尺寸数值与模型参数一致（按 `dimensions.json` 抽查 ≥ 5 处）。

---

## 6. 阶段 4：AI / MCP 辅助接入

### 6.1 形态选择

| 方案 | 适用 | 取舍 |
|---|---|---|
| A. 无头脚本闭环（推荐） | 批量改参、批量出图、CI | 无 GUI 依赖，可断言，可回滚 |
| B. `freecad-mcp` 会话内 | 交互式探索、临时建模、看截图 | 依赖 GUI 会话，结果需复核 |
| C. 混合 | 日常交互用 B，交付用 A | 需要两套权限策略 |

### 6.2 方案 A 的代理契约

代理只允许做三件事：读仓库、写 `scripts/` 与 `params/`、执行 `FreeCADCmd`/`xvfb-run`。

强制执行顺序：

```
读需求 → 改参数或脚本 → 运行 build.py → 读 stderr/退出码
      → 运行 validate.py → 失败则修正 → 通过后交人工评审 diff
```

硬性护栏：

- 源文件目录只读，代理只写 `out/` 与 `params/`（或独立 worktree）。
- 单次执行超时 300 s；连续失败 3 次即停，输出诊断。
- 禁止访问网络；MCP 服务仅绑定 `127.0.0.1`。
- 所有产物进 `out/<run-id>/`，保留 `manifest.json` 与日志。

### 6.3 上下文资产（喂给代理的“事实库”）

1. `docs/api_snippets.md`：已验证的 `addObject`、`setExpression`、`References2D`、`writeDXFPage` 片段。
2. `docs/field_dictionary.md`：模板字段与参数名映射。
3. `docs/failure_playbook.md`：常见错误 → 原因 → 修法（取自报告第 9 节）。
4. `params/*.json` 示例作为输出格式的少样本。

### 6.4 阶段 4 验收

- 三个代表性任务（改一个尺寸、加一个孔、生成一套图纸）由代理完成并通过全部断言。
- 代理至少一次从失败中自我修复成功，日志可追溯。
- 人为破坏参数后，代理报告可读错误而不是产出坏文件。
- 全部改动可 `git diff` 评审，可一键回滚。

---

## 7. 阶段 5：客户既有图纸接入（DWG/DXF → 专利附图）

> 与阶段 1–3 独立：客户不提供参数化模型时，这条路径直接从二维图产线稿。可与阶段 1–3 并行推进；正式交付前必须通过本阶段门禁。

### 7.1 输入判定（先做，决定是否进入本阶段）

| 客户能提供 | 走哪条路径 | 理由 |
|---|---|---|
| STEP / IGES / BREP（同源三维） | 阶段 1–3 或 `generate_structure_figure` | 真实投影，件号可锚定到 3D 顶点，无需清理 |
| 仅 DWG / DXF / PDF | 本阶段 | 工程图自带尺寸、图框、工艺注释，必须清理 |
| 只有纸质扫描件 | 先矢量化（人工描图或外包），再进本阶段 | 位图不能直接进入线稿链 |

判定结果写入案件目录的 `docs/source.md`：来源、格式、版本、单位、图幅、是否可提供三维源。

### 7.2 原始文件留痕（只读）

```
incoming/<case-id>/
├── source/            # 客户原图，只读，不改不删
├── meta.json          # 来源、收到日期、md5、图幅、单位、图层清单、转换器版本
└── notes.md           # 客户说明、缺件、待确认项
```

原始文件永不进入 `out/`；转换产物写到 `out/<case-id>/converted/`。来源与公开状态（图纸是否已构成现有技术公开）由案件程序判断，本流水线只记录、不判定。

### 7.3 格式转出：两条路线

DWG 不是 FreeCAD 内置格式，必须先经外部转换器；报告已把“转换器版本未实测”列为未验证项。FreeCAD 自身的 DXF 导入（`importDXF`）属于 Draft 底图用途，不能直接产生 TechDraw 视图，因此不作为本阶段主线。

| 路线 | 工具链 | 保留 | 丢失 | 适用 |
|---|---|---|---|---|
| A 版面优先 | DWG → PDF（ODA File Converter 或 CAD 打印）→ SVG（`pdftocairo -svg` / Inkscape） | 版面、视图位置、观感线宽 | 图层、可编辑实体；文字变路径 | 一次性案件，只需成品图 |
| B 清理优先 | DWG → DXF（ODA File Converter / LibreDWG `dwg2dxf`）→ `ezdxf` 按图层生成 SVG | 图层、实体类型，可精确剔除 | 需写转换脚本 | 图纸含大量标注、构造线，需要批量清理 |

转换验收：实体数、图层数、文字数、图幅尺寸与源文件一致；差异逐项记录，不静默丢弃。转换失败即停，不产出“近似”图。

### 7.4 清理规则（工程图 → 专利附图）

本节产出面向专利附图。需要带图框与尺寸的工程图时走阶段 3，不复用本节规则。

| 类别 | 处理 |
|---|---|
| 必删 | 尺寸、公差、表面粗糙度、技术要求、比例、材料表、标题栏、图框、指北针、客户图号、公司名与 logo、审签栏 |
| 保留 | 视图布局、结构轮廓、必要的内部结构虚线、剖面线（方向或间距按相邻件区分） |
| 线宽 | GB/T 4457.4 系列；可见线与隐藏线取值对齐既有 `STRUCTURE_LINE_WIDTH_SERIES` |
| 颜色 | 全图单色黑 |
| 文字 | 只保留必要词语；全部转曲 |
| 件号 | 重排为 1..N 阿拉伯数字，跨图同件同号 |
| 图号 | 不写入图形内部；两幅以上时由落版步骤写在图形正下方 |

清理逻辑写入 `scripts/import2d.py`，规则表放 `docs/import2d-rules.json`。与阶段 3 的 `dim_rules.py` 分开：前者删注释，后者加尺寸，不合并成一份规则文件。

### 7.5 接回既有标号与核验链

清理后的 SVG 交给 `@deepseek-ai/dsh-patent-tools` 已有工具，不另建一套：

| 步骤 | 现有工具 | 作用 |
|---|---|---|
| 补/改标号 | `add_patent_figure_references` | 文本匹配或引线模式，不改原图 |
| 渲染合规 | `verify_patent_figure` | 线宽、线向、1.5 mm 文字间距、最小字号、越界 |
| 视觉回读 | 栅格化 PNG → `analyze_patent_figure` | 产出件号表，写入 `figureIndexFile` |
| 跨图一致 | `check_patent_figure_consistency` | 同号同件、图号连续、权利要求标号全覆盖 |
| 期望比对 | `compare_patent_figure_analysis` | 清理结果与回读结果比对 |

输入格式边界：`generate_structure_figure` 只收 STEP/IGES/BREP，`generate_patent_figure` 不收外部 CAD，`analyze_patent_figure` 只收 jpg/png/gif/webp；`verify_patent_figure` 与 `add_patent_figure_references` 收 SVG。这条链中唯一缺失的环节是“DWG/DXF → SVG”，即本阶段新建的部分，其余全部复用。

### 7.6 阶段 5 验收

- 一份真实客户 DWG 全流程跑通，产出线稿 SVG 与 PDF，经人工确认无需重绘。
- 删除项可审计：每类被删元素（尺寸、图框、文字）有计数与坐标记录。
- `verify_patent_figure` findings 为空，或剩余项已列入人工复核清单。
- `check_patent_figure_consistency` 无同号异件、无图号断号。
- 同一 DWG 重复转换两次，SVG 实体数与坐标在容差内一致。

### 7.7 尚未验证

- ODA File Converter、LibreDWG、`ezdxf` 具体版本在本机的可用性与输出保真度，报告未实测。
- 客户 DWG 常见的多布局（Layout）、外部参照（XREF）、图层冻结与 `AC1032` 文件版本如何映射，需在首个真实案件上标定。
- `ezdxf` 对中文文字样式（SHX 大字体）的解析完整度。

---

## 8. 工程化与质量控制

| 主题 | 做法 |
|---|---|
| 版本控制 | 脚本、参数、模板、文档入库；`out/` 与临时文件不入库；`.FCStd` 标记为二进制，必要时解压 XML 做 diff |
| 客户原图 | `incoming/` 只读；`meta.json` 记录 md5、转换器版本与参数，使任一张图都能追溯到原文件与转换批次 |
| 版本兼容 | 记录 `App.Version()`；26.3 发布后跑一遍全量回归，重点看 TechDraw 与目录结构 |
| 性能基线 | 记录单件生成耗时、批量总耗时；超过基线 2 倍即排查 |
| 命名 | 对象名英文、显示名中文；参数名大写短名；图号规则固定 |
| 评审 | 每个新零件族需过“参数完整性、特征顺序、图纸字段”三项检查 |
| 备份 | `out/` 按 run-id 保留最近 N 次；源文件进 git tag |

---

## 9. 风险与应对

| 风险 | 触发信号 | 应对 |
|---|---|---|
| TechDraw 无头导出不完整 | DXF 缺图框/缺标注 | 统一改走 `xvfb-run` 全 GUI；DXF 仅作辅助产物 |
| 拓扑命名导致引用失效 | 改参后特征报“链接丢失” | 改引基准草图/基准面；固定特征顺序；必要时重建特征 |
| 插件路径随版本变化 | 升级后插件“消失” | 用 `ApplicationDirectories` 解析；维护插件清单与安装脚本 |
| Python ABI 不匹配 | 外部解释器 `import FreeCAD` 失败 | 一律用 `FreeCADCmd`；或安装 3.11 并指向同一 lib |
| DWG 输入不保真 | 转换后实体数、图层数、文字数与源文件对不上 | 转换独立成步骤，记录转换器版本与差异清单；失败即停，不产出近似图 |
| DWG 输出 | 下游只要 DWG | 计划内只有 TechDraw 的 DXF 整页导出；DWG 输出仍需外部转换器，作为独立可替换环节 |
| 大批量内存/超时 | 批处理中途被杀 | 分片执行；每片新进程；记录失败分片重跑 |
| AI 产出不可信 | 校验通过但图纸不合规 | 规则库 + 人工抽检；代理不得直接覆盖源文件 |

---

## 10. 交付物清单

| 交付物 | 位置 | 完成标志 |
|---|---|---|
| 环境与基线记录 | `docs/baseline.md` | 版本、路径、冒烟结果齐备 |
| 目录骨架与模板库 | `templates/`、`macros/` | 至少 1 套 ISO 图框可用 |
| 零件族 | `parts/`、`params/` | 3–5 个族，每族 ≥ 2 变体 |
| 构建与校验脚本 | `scripts/build.py`、`validate.py` | 批量零失败，错误可读 |
| 出图脚本与规则库 | `scripts/sheet.py`、`dim_rules.py` | DXF/PDF 产出且字段完整 |
| 客户图纸接入 | `scripts/import2d.py`、`docs/import2d-rules.json` | 真实 DWG 跑通，删除项可审计 |
| 代理资产 | `docs/api_snippets.md` 等 | 三个任务验收通过 |
| 运行记录 | `out/<run-id>/manifest.json` | 可复现、可追溯 |

---

## 11. 执行顺序与门禁

按顺序推进，每一阶段通过门禁后再进入下一阶段：

1. **阶段 0 门禁**：`FreeCADCmd --version` 正确；冒烟脚本可导出并回读 STEP；目录与模板就位。
2. **阶段 1 门禁**：任一参数改动可重算；包围盒与参数一致；评审记录归档。
3. **阶段 2 门禁**：批量零失败；重复执行一致；错误注入返回非零码。
4. **阶段 3 门禁**：图纸字段完整、视图齐全、PDF 可打印、DXF 可打开。
5. **阶段 4 门禁**：三个代理任务全过；一次自修复成功；改动可回滚。
6. **阶段 5 门禁**（与阶段 1–3 并行，交付前必须通过）：真实客户 DWG 全流程跑通；删除项可审计；核验链 findings 为空或已列人工项。

**第一批动作（按序执行）**

1. 安装并校验 1.1.4，确认 `xvfb` 可用。
2. 建目录骨架，放入第一套企业图框 SVG 与字段字典。
3. 选“板类件”做第一个零件族，参数表 + 冒烟构建。
4. 写 `build.py` 与 `validate.py`，跑通 STEP/STL 批量。
5. 写 `sheet.py`，先出 DXF，再补 PDF（`xvfb-run`）。
6. （有真实客户 DWG 时）先只跑路线 A 拿到一版可读图，再判断是否需要投入路线 B。

完成前四项即可形成可用的最小闭环；第五项是出图交付的关键增量；第六项只在有客户二维图纸时执行。
