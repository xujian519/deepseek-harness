# TRIZ 数据资产

[English](README.md) | 中文

`triz-matrix.json` 与 `triz-principles.json` 的来源、许可状态、已知偏差与校验方法。

## 数据来源

### 矛盾矩阵

`triz-matrix.json` 是经典 Altshuller 矛盾矩阵的 39×39 转录。本次评审确认的链条如下：

| 步骤 | 来源 | 作用 |
| --- | --- | --- |
| 1 | Genrich Altshuller《Creativity as an Exact Science》（1985）及经典 TRIZ 文献 | 39 个工程参数、40 条发明原理与矛盾矩阵的原始出处 |
| 2 | Casey Perno（2007），`triz_matrix.xls`，工作表 `CM4` | 经典矩阵的电子表格转录 |
| 3 | [`kamil-szczepanik/TRIZ-Agents`](https://github.com/kamil-szczepanik/TRIZ-Agents)，`data/tools_sources/triz_matrix.xls` | 2026-10-17 修正所使用的 Perno 电子表格副本 |
| 4 | [`mmysior/pytriz`](https://github.com/mmysior/pytriz)，`src/pytriz/resources/matrix_values.csv` | 用于逐格交叉校验的独立第二转录 |
| 5 | [`Antropocosmist/triz-engineering-solver`](https://github.com/Antropocosmist/triz-engineering-solver) | 同一谱系中较早的中间 JSON；本次修正未将其作为事实基准 |
| 6 | 本包 `assets/triz-matrix.json` | 随包资产，索引方式为 `matrix[worsening - 1][improving - 1]` |

步骤 3 与步骤 4 在全部 1521 个单元格上一致：1248 个非空格、39 个对角空格、234 个非对角空格。电子表格以行为改善参数、列为恶化参数；随包 JSON 将其转置为 `lookupMatrixCell(improving, worsening)` 使用的 `[worsening][improving]` 顺序。

没有记录 Perno 2007 页面的稳定规范 URL。本次评审的电子表格带有文档元数据作者 `Jim Pinto`；Perno 归属来自围绕这份广泛流传转录的二手文献。转录链条有记录，但未能在原始页面独立鉴权。

### 发明原理

`triz-principles.json` 包含 40 条经典原理名称与中文说明。英文名称与原理集合属于经典 TRIZ 材料。**本仓库没有记录中文名称与说明文本的来源或翻译过程；其出处尚未确认。** 在补齐记录前，不得宣称该译文已完成许可清理。

### 分离原理

`triz-separations.json` 描述五条经典分离维度——空间、时间、条件、方向与系统层级。英文说明与适用信号是依据经典 TRIZ 分离原理为本包撰写的，没有复制第三方文本。该资产不是任何源文件的译文，其许可沿用本包的 MIT 许可。

## 许可状态

| 来源 | 声明的许可 | 状态 |
| --- | --- | --- |
| Altshuller 的经典 TRIZ 矩阵与原理 | 公共经典材料；底层事实不适用开源许可 | 多数司法辖区不保护事实本身；具体转录与译文仍需审查 |
| Casey Perno，`triz_matrix.xls` | 文件未附带许可 | 未知 |
| `kamil-szczepanik/TRIZ-Agents` | README 声明 MIT；GitHub 未检测到 LICENSE 文件 | 仓库层面未确认 |
| `mmysior/pytriz` | MIT | 已确认 |
| `Antropocosmist/triz-engineering-solver` | MIT | 已确认 |
| 本包的中文原理文本 | 未记录 | 未确认 |

矩阵是事实表格；版权风险集中在中文说明文本以及任何被复制的电子表格格式。在取得中文文本与 Perno 转录的书面确认前，不要把本包视为已完成许可清理。

## 已知偏差

- **转录空缺**：两个独立转录在非对角线位置都有 234 个单元格不含推荐。它们是矩阵空缺，不是物理矛盾。不要把它们描述为分离场景。
- **源数据重复格**：`(改善 19, 恶化 9)` 在 Perno 电子表格与 pytriz CSV 中都是 `[8, 35, 35]`。原始资产保留源值；`lookupMatrixCell` 去重后返回 `[8, 35]`。没有猜测替代集合。
- **单原理格**：较早的中间数据集丢弃了 58 个只含一条推荐原理的单元格。2026-10-17 的修正已全部补回；矩阵现在有 1248 个非空格。
- **仅经典矩阵**：不包含任何更新、派生或领域专用矩阵。
- **非对角空格的含义并不对称**：修正后的空格不表示 TRIZ 没有答案，只表示这份转录没有记录。

## 校验

运行包检查：

```sh
pnpm exec vitest run packages/patent/methodology/tests
```

测试套件断言：

- 39×39 维度，原理编号在 1–40 之间。
- `filled = 1248`、`diagonalEmpty = 39`、`offDiagonalEmpty = 234`。
- 锚点格：`(改善 14, 恶化 1) = [1, 8, 40, 15]`、`(9, 10) = [13, 28, 15, 19]`、`(3, 15) = [19]`、`(6, 14) = [40]`、`(14, 20) = [35]`。
- 原始数据恰有一个重复格 `(19, 9) = [8, 35, 35]`；查询返回 `[8, 35]`。

临时计数检查：

```sh
node -e "const M=require('./packages/patent/methodology/assets/triz-matrix.json');const f=M.flat();console.log(JSON.stringify({rows:M.length,cols:M[0].length,filled:f.filter(c=>c.length).length,empty:f.filter(c=>!c.length).length,diagonalEmpty:M.filter((r,i)=>r[i].length===0).length,offDiagonalEmpty:f.filter(c=>!c.length&&Math.floor(i/39)!==i%39).length,duplicates:f.filter(c=>new Set(c).size!==c.length).length}))"
```

期望值：`{"rows":39,"cols":39,"filled":1248,"empty":273,"diagonalEmpty":39,"offDiagonalEmpty":234,"duplicates":1}`。

## 重新生成步骤

1. 读取 `triz_matrix.xls` 的 `CM4` 工作表。数据行 3–41、列 C–AQ 分别对应改善参数 1–39 与恶化参数 1–39；`+`、`-` 与空单元格都表示无推荐。
2. 用 `\d+` 解析所有剩余非空单元格；不要只按逗号切分，因为至少一个源单元格用空格分隔原理编号。
3. 转置为 `matrix[worsening - 1][improving - 1]`。
4. 与 pytriz 的 `matrix_values.csv` 逐格对拍；两个来源完全一致后才能替换资产。
5. 保留源数据异常；只在 `lookupMatrixCell` 中去重。
6. 重新运行包测试与上面的计数命令。
