# 故障对策手册

喂给阶段 4 代理的“事实库”之一。分两部分：FreeCAD 通用故障（来自调研报告 §9）与本工作区脚本的已踩坑项（实测）。

## 1. FreeCAD 通用故障

| 现象 | 常见原因 | 对策 |
|---|---|---|
| 改参数后特征报“链接对象丢失” | 引用了生成面的拓扑名 | 引用基准草图/基准面；固定特征顺序 |
| 布尔运算失败或结果破碎 | 共面、零厚度、微小间隙 | 留 0.01–0.1 mm 余量；先 `isValid()` 检查 |
| 圆角失败 | 相邻边冲突、半径过大 | 圆角后置；拆分多次小半径；改用变半径 |
| TechDraw 视图空白/红叉 | 模板路径错误、视图未重算、无 GUI 视口 | 用绝对模板路径；`recompute()`；PDF 走 `xvfb-run` |
| 无头导出 PDF 失败 | 无头模式不创建 ViewProvider | 改用完整 GUI + `xvfb-run -a freecad` |
| 中文字段显示异常 | 模板字体缺字/未嵌入 | 改用系统可用字体，或在 SVG 内嵌字体 |
| 插件“装了但没生效” | 1.1 后目录按版本分层 | 放到 `.../FreeCAD/v1-1/Mod/`；查插件管理器日志 |
| 外部 Python `import FreeCAD` 失败 | ABI 与内置 3.11 不匹配 | 改用 `FreeCADCmd`，或同版本 Python |
| 同一 FCStd 并发写坏 | 单文档锁 + 多进程 | 一次只开一个实例；批量按文件分片 |
| 大装配卡顿 | 全量重算 + 复制实例 | Link 实例化；冻结子装配；关闭自动重算 |

## 2. 本工作区脚本的已踩坑项（实测）

| 现象 | 触发 | 修法 |
|---|---|---|
| `ezdxf` 报 `'Modelspace' object has no attribute 'width_in_mm'` | `SVGBackend.get_string(modelspace)` 传错对象 | 传 `layout.Page` 对象，按内容包围盒设置宽高；见 `scripts/import2d.py` |
| `pdftocairo` 退出码 99 | `pdftocairo -svg -singlefile ...` | `-singlefile` 仅支持 png/jpeg/tiff；SVG 直接 `pdftocairo -svg in out.svg` |
| `overall_x`/`thickness` 规则抛 `cannot unpack non-iterable NoneType` | 投影边无 `Vertexes`（圆弧/圆）时 `_endpoints` 返回 `None` | 调用处先判空再解包；已修 |
| 尺寸引用到错误边 | `EdgeN` 序号与 `getVisibleEdges()` 顺序假设未验证 | 在目标机实测；产出后核对 `dimensions.json` 的边号与数值 |
| 孔径数量前缀未显示 | `DrawViewDimension.FormatSpec` 对自定义前缀的接受度未验证 | 失败时记录 `reason`，不阻断出图；人工补前缀 |
| 清理后无实体 | `--drop-layer` 把所有图层删光 | 退出码 4，提示检查规则 |

## 3. 出口码含义

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 2 | 输入/参数不合法 |
| 3 | 几何无效或缺少上游产物 |
| 4 | 导出或转换失败 |
| 5 | 运行环境缺失（无 FreeCAD / 无转换器） |
