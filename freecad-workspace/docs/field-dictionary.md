# 模板字段字典

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

## 使用约定

- 字段值只通过 `EditableTexts` 字典写入，不在 SVG 里硬编码业务值。
- 缺值不填空白，写 `—`，避免打印后出现空框。
- 新增字段必须同时更新本表与 `templates/` 中的 SVG；两者不一致时以本表为准并修 SVG。
