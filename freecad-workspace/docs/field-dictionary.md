# 字段字典

分两类：图框模板的可编辑字段（TechDraw `EditableTexts`）与零件族的参数表字段。

## 1. 图框模板字段

`templates/A4_landscape.svg` 中的可编辑字段。`freecad:editable` 为 TechDraw 读取 `EditableTexts` 的键，`freecad:autofill` 为 FreeCAD 自动填充的语义名。

| 字段键 | autofill | 含义 | 取值来源 |
|---|---|---|---|
| `FC-Title` | `title` | 图名 | `params` 之外的案件信息，或 `spec.description` |
| `FC-DrawingNumber` | — | 图号 | 外部编号 |
| `FC-Scale` | `scale` | 比例 | 出图时计算（视图比例） |
| `FC-PageNumber` | `page_number` | 当前页 | `sheet.py` 按页序写入 |
| `FC-PageCount` | `page_count` | 总页数 | `sheet.py` 按总页数写入 |
| `FC-Author` | `author` | 设计/制图 | 外部配置 |
| `FC-Date` | `date` | 日期 | 出图当天 |
| `FC-Organization` | `organization` | 单位名称 | 外部配置 |

### 使用约定

- 字段值只通过 `EditableTexts` 字典写入，不在 SVG 里硬编码业务值。
- 缺值不填空白，写 `—`，避免打印后出现空框。
- 新增字段必须同时更新本表与 `templates/` 中的 SVG；两者不一致时以本表为准并修 SVG。

## 2. 零件族参数表字段

参数表的通用结构见 `scripts/common/params.py`：`part`、`variant`、`params`（非空数值对象）、`outputs`（`step`/`stl` 数组），可选 `description`。

`params` 内部的键由各零件族的 `normalize()` 校验，显示名来自各模块的 `LABELS`。

### plate（板类件）

| 键 | 含义 | 类型 | 必填 | 约束 |
|---|---|---|---|---|
| `L` | 总长 | mm | 是 | > 0 |
| `W` | 总宽 | mm | 是 | > 0 |
| `T` | 板厚 | mm | 是 | > 0 |
| `HOLE_D` | 孔径 | mm | 是 | > 0 |
| `EDGE_M` | 边距 | mm | 是 | > 0，≥ HOLE_D/2 |
| `N_HOLES_X` | X 向孔数 | int | 是 | ≥ 0 |
| `N_HOLES_Y` | Y 向孔数 | int | 是 | ≥ 0 |
| `FILLET_R` | 外角圆角 | mm | 否 | 0 或 ≤ min(EDGE_M, T/2) |

### flange（法兰）

| 键 | 含义 | 类型 | 必填 | 约束 |
|---|---|---|---|---|
| `OD` | 外径 | mm | 是 | > 0 |
| `ID` | 中心孔径 | mm | 是 | > 0，< OD |
| `T` | 法兰厚度 | mm | 是 | > 0 |
| `BCD` | 螺栓孔节圆直径 | mm | 是 | > 0 |
| `BOLT_D` | 螺栓孔径 | mm | 是 | > 0 |
| `N_BOLTS` | 螺栓孔数 | int | 是 | ≥ 0 |

附加约束：节圆外缘不超出外径（BCD/2 + BOLT_D/2 ≤ OD/2）；螺栓孔不与中心孔相交（BCD/2 − BOLT_D/2 ≥ ID/2）。

### shaft（阶梯轴）

| 键 | 含义 | 类型 | 必填 | 约束 |
|---|---|---|---|---|
| `D1`/`L1` | 第一段直径/长度 | mm | 是 | > 0 |
| `D2`/`L2` | 第二段直径/长度 | mm | 是 | > 0 |
| `D3`/`L3` | 第三段直径/长度 | mm | 是 | > 0 |
| `D_MAX` | 最大直径 | mm | 是 | = max(D1, D2, D3) |
| `L` | 总长 | mm | 是 | = L1 + L2 + L3 |

### bracket（L 形支架）

| 键 | 含义 | 类型 | 必填 | 约束 |
|---|---|---|---|---|
| `L` | 总长 | mm | 是 | > 0 |
| `W` | 总宽 | mm | 是 | > 0 |
| `H` | 总高 | mm | 是 | > 0，> T |
| `T` | 底板厚度 | mm | 是 | > 0 |
| `TV` | 立板厚度 | mm | 是 | > 0，< W |
| `HOLE_D` | 底板孔径 | mm | 是 | ≥ 0 |
| `HOLE_X` | 孔心 X | mm | 是 | 孔不越出底板 |
| `HOLE_Y` | 孔心 Y | mm | 是 | 孔不越出底板、不与立板重叠 |

### 约定

- 数量类以 `N_` 开头，整型；尺寸类为浮点，单位毫米。
- 新增或修改参数必须同步更新对应 `parts/<name>.py` 的 `REQUIRED`、`LABELS`、`normalize()` 与本表。
