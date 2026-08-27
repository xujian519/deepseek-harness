# Agent Note: 附图与化学索引写入-检索接线补全

Status: implemented

[English](2026-08-27-figure-chemistry-index-write-read-wiring.md) | 中文

## 问题

Sati 移植的 `analyze_patent_figure`、`search_patent_figure` 与 `recognize_chemical_structure` 只注册了工具，背后没有接线持久化层。`search_patent_figure` 明确声明「无索引写入方接线」，调用即 `setup_required` fail-loud；`analyze_patent_figure` 的分析结果也从不落盘。其核心场景——权利要求撰写、OA 答复与无效比对时确认「技术特征 ↔ 附图标记」——因此在组装好的宿主里完全不可用。

## 决定

`packages/patent/patent-tools` 现在提供共享的单文件索引存储，并为附图与化学两类分析接线了写入 + 读取。

`src/internal/index-store.ts` 的通用工厂 `createIndexStore` 拥有全部公共持久化语义：`load` 在文件缺失时返回空条目，版本不匹配、结构异常、含无效条目或 JSON 损坏时返回空 + warning，只有真正的非 ENOENT 读失败才重抛；`save` 经 `atomicWriteJson` 原子写；`upsert` 在进程内按文件路径串行化，使读-改-写竞态无法丢条目，重写前先备份损坏索引，按 entryKey 去重并按比较器排序。附图存储（`src/figure/index-store.ts`）与化学存储（`src/chemistry/index-store.ts`）仅条目形状、键、比较器与版本不同，因此都构建在该工厂之上。

`patent-tools` 的 `apply()` 解析 `Config.figureIndexFile` 与 `Config.chemistryIndexFile`（默认 `<cwd>/.sati/figures-index.json` 与 `<cwd>/.sati/chemistry-index.json`）并接线工具：`analyze_patent_figure` 把结果 upsert 进附图索引，`search_patent_figure` 读取该索引做关键词检索，`recognize_chemical_structure` 接受注入的 `upsertIndex` 持久化可用结果。索引 upsert 是尽力而为的增强——写失败被静默吞掉，分析结果照常返回。`search_patent_figure` 不再报 `setup_required`：索引缺失或为空时返回零命中并附引导提示。

化学引擎仍未可用（RDKit 未随包），因此本构建中 recognize 的写入闭包不可达，带理由加 v8 ignore；引擎产出可用结果后该闭包自动生效。

## 曾考虑的替代方案

- **移植 Sati 的向量/混合检索路径。** Sati 用 embedding 检索附图。dsh 无向量基建，`patent_case_search` 也因同一原因移除了语义召回，因此附图检索保持基于索引的关键词检索。
- **附图与化学各自实现专属索引。** 两个存储仅在条目形状、键、比较器与版本标签上不同。共享工厂在保持每个存储契约显式的同时消除了重复。
- **在工具内同步直写分析结果到磁盘。** 朴素直写在并发 analyze 下会丢更新，并静默覆盖损坏索引。工厂的按路径串行化、原子写与损坏备份同时保护了这两点。

## 影响

- `search_patent_figure` 在组装好的宿主里开箱即用：索引为空或缺失时返回提示，而非硬失败。
- 已分析附图跨会话持久化在工作区索引文件中；同一图片的重复分析覆盖旧条目而非重复累积。
- 附图索引大小有界（每个图片路径一条），且原子写保证中断的写入不会损坏已提交文件。
- 化学索引存储与写入接线先于 RDKit 引擎落地；届时之前该写入闭包以 v8 ignore 标记为不可达。
- 接线引入的加载失败、排序、校验与 Config 解析分支均有覆盖测试钉住。

## 测试

`packages/patent/patent-tools` 测试覆盖工厂的 load/upsert 契约（ENOENT、版本不匹配、结构异常、无效条目剔除、JSON 损坏、非 ENOENT 重抛、并发 upsert 串行化、损坏备份）、两个存储的键与排序，以及组装后插件的接线：analyze 持久化进 `Config.figureIndexFile`、search 从缺省的缺失索引无错服务、`Config.chemistryIndexFile` 为 recognize 接线解析。patent-tools 全部 348 个测试通过，包内 src 文件语句覆盖率 100%。
