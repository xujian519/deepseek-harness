# 内置 LLM wiki 卡片插件 —— 可行性与生态调研（2026-09-23）

调研问题：按 Karpathy 的 LLM Wiki 思路，在 deepseek-harness 内置一个「生成、管理 LLM wiki 卡片」的插件，是否对本项目有益。

结论先行：**方向有价值，但"内置一个插件"这个形态不成立**。社区已经把这件事做了几十遍（GitHub 上 `llm-wiki` 命名仓库 **3,767** 个；DSH 生态内记忆类插件 195 个，其中至少 3 个直接声明按 Karpathy 范式 / LLM Wiki 结构实现，另有一批同类知识中心与知识库插件），官方再内置一份的实现价值接近零；真正的空白是**卡片接缝与确定性质量工具**，以及对**专利域既有 1235 张卡片**的写入闭环。建议先走 out-of-tree 插件 + skill 验证，内置只保留"接缝 + lint"这一最小面，且默认关闭。另有一条成本硬约束：预注册对照实验显示 wiki 查询约花 21 倍 token 且**不存在盈亏平衡点**，因此它只能定位为综合层，不能替代既有检索。

- 证据基线：本机 `master` 工作树（2026-09-23）；外部事实经 `api.github.com` / `raw.githubusercontent.com` / 公开文章，取值日期见各条。
- 方法：两路独立调研（通用开源生态、DSH 插件生态）+ 仓库内接缝盘点；外部数据一律标注来源性质（自报/核实）。
- 局限：`github.com` 主域在本环境不可达，仓库页面事实经 GitHub API 与 raw 内容核实；Karpathy 一手文档（GitHub 上的 LLM Wiki 文档）未取到原文，范式细节依据其二手解读与社区复刻实现交叉印证。

## 1. 判据：什么才算"对本项目有益"

判断一个新插件是否该进仓库，先过 [packages/AGENTS.md](../../packages/AGENTS.md) 的三条现行规则，再谈设计：

| 规则 | 对本次议题的含义 |
|---|---|
| **Require a current owner and need** | 没有当前消费者（工具、预设、专利域流程）的能力不进仓库；"未来可能有人用"不是理由 |
| **Prefer maintained dependencies over hand-rolling** | 社区已有 195 个记忆类插件与完整参考实现时，自研必须说明为什么不能接入 |
| **Design Service Definitions for all current Consumers** | 若要做，做的是供多方消费的接缝，而不是一个自成体系的产品插件 |

另有两条硬约束决定实现形态：模型可见即必须可从会话日志重建（根 [AGENTS.md](../../AGENTS.md) "Model-visible ⟺ logged"）；记忆类插件是 **opt-in**，不进 shipped defaults（[memory 组](../../packages/memory/README.md)）。

## 2. Karpathy LLM Wiki 范式（可核实的要点）

范式由 Karpathy 于 2026 年 4 月在 GitHub 发布，社区解读与复刻众多（[deephub 解读](https://cloud.tencent.com.cn/developer/article/2655117)）。要点：

- **三层**：`raw/`（原始素材，不可变，LLM 只读）；`wiki/`（LLM 创建与维护的 Markdown 页面：sources / entities / concepts / comparisons / overview）；schema（`CLAUDE.md` 或 `AGENTS.md`，约束命名、frontmatter、交叉引用、日志格式）。索引 `index.md` 充当符号表，`log.md` 充当构建日志。
- **三个操作**：ingest（读一份新素材，一次更新 10–15 个既有页面：摘要页、实体页、概念页、矛盾标记、索引、日志）；query（先读索引定位，再综合回答，好答案回写成新页面）；lint（矛盾、孤立页、缺失交叉引用、过时内容、被提及却没有独立页面的概念）。
- **编译器 vs 解释器**：传统 RAG 每次查询重新发现知识；LLM Wiki 预先把素材编译成结构化中间表示，后续推理基于产物。
- **作者自陈的硬限制**（这部分比范式本身更值得引用）：维护成本随语料规模增长；LLM 传播的不只是事实错误还有**结构性错误**（错误关联会被编织进多页并在后续摄入中被强化，事后审计困难）；**质量上限由 schema 决定**；索引优先法在约 100 个来源后失效，需要本地检索基建（作者提到 `qmd`）；这是**个人工具**，团队化需要独立治理设计（来源质量、schema 归属、矛盾裁决、关系审计）。
- 作者建议的采用方式：小步起步（先 5–10 个来源，逐页读、按不一致改 schema），而非一次性批量导入。

## 3. 社区生态一：通用开源（邻近与基础设施）

### 3.1 通用"LLM 维护 Markdown 知识库"实现

| 项目 | 形态 | 关键机制 | 可复用点 |
|---|---|---|---|
| [obsidian-llm-wiki-local](https://github.com/kytmanov/obsidian-llm-wiki-local) 827★ MIT，2026-05 起维护模式 | CLI 操作 vault | `raw/` 不可变；fast 模型抽概念 + heavy 模型写文章；草稿必须人工 review，驳回理由回灌下次 prompt，同概念被驳 5 次自动 block；检测人工手改并跳过；`lint` 报 orphan/stale、`maintain --fix` 修断链建 stub；`index.md` 作路由层（无 embedding）；每步 git commit + undo | 目前最完整的 LLM 维护 Markdown 知识库参考实现；模式可信、依赖不可信（已转维护模式） |
| [synto](https://github.com/kytmanov/synto) 256★ MIT | 同上后继 | 同一作者接续 | 仍在迭代但极年轻 |
| [basic-memory](https://github.com/basicmachines-co/basic-memory) 4,029★ AGPL-3.0 | Markdown + SQLite + MCP | 实体页 = Observations（`[类别]` 事实）+ Relations（wikilink）；`schema_infer/validate/diff`；FTS + 向量混合 | 最贴近"卡片文件 + 索引 + MCP 工具面"的既有形态 |
| [qmd](https://github.com/tobi/qmd) 29,979★ MIT，TS，2026-09-09 | CLI + MCP server | `search`(FTS5 BM25) / `vsearch`(向量 + sqlite-vec) / `query`(扩展 + RRF k=60 + 本地重排)；单文件索引；输出 `--json/--files/--md` | 检索基建的形态参考：无服务端、单文件索引、工具面清晰 |
| [mem0](https://github.com/mem0ai/mem0) 65,885★ / [Graphiti](https://github.com/getzep/graphiti) 31,097★ / [cognee](https://github.com/topoteretes/cognee) 30,941★ / [LightRAG](https://github.com/HKUDS/LightRAG) 39,832★ / [khoj](https://github.com/khoj-ai/khoj) 37,476★ / [Letta Code](https://github.com/letta-ai/letta-code) 3,412★ | 库 / 服务 / harness | mem0 于 2026-04 改为 **ADD-only**（不再 UPDATE/DELETE）；Graphiti 用 validity window 让旧事实**失效而不删除**并保留 episode 溯源；cognee 提供 remember/recall/improve/forget；Letta 的 MemFS 用 git 跟踪全部上下文 | 冲突处理与去重的成熟答案：**追加 + 时效失效 + 溯源** |

**按 Karpathy 范式直接实现的通用项目**（星标/许可/活跃经 GitHub API 于 2026-09-23 读取；按热度降序）：

| 项目 | 热度 | 形态与机制 |
|---|---|---|
| [SamurAIGPT/llm-wiki-agent](https://github.com/SamurAIGPT/llm-wiki-agent) | 3,567★ MIT，2026-09-21 活跃 | 编码 agent skill：`ingest raw/…` → `wiki/{index,log,overview,sources…}`，每次写入同步更新索引并追加日志 |
| [Astro-Han/karpathy-llm-wiki](https://github.com/Astro-Han/karpathy-llm-wiki) | 2,347★ MIT，2026-07-23 更新 | 把范式打包成可装的单一 Agent Skill（Claude Code / Cursor / Codex） |
| [atomicstrata/llm-wiki-compiler](https://github.com/atomicstrata/llm-wiki-compiler) | 2,098★ MIT，2026-09-23 活跃 | CLI（npm）+ MCP server："知识编译器"，raw in → 互链 wiki out |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | 1,640★ Apache-2.0 | 剪藏入 raw，夜间例行任务自动合成；MCP 接入 |
| [nvk/llm-wiki](https://github.com/nvk/llm-wiki) | 1,336★ MIT | skill + Python CLI：**`lint --fail-on critical\|warning\|suggestion` 退出码门禁** |
| [GD4AI/obsidian-llm-wiki](https://github.com/GD4AI/obsidian-llm-wiki) | 650★ Apache-2.0，2026-09-23 活跃 | Obsidian 插件：实体/概念页 + 图谱问答；**重写被 token 上限截断时不再整页覆盖** |
| [nanzhipro/Karpathy-llm-wiki-bootstrap-skill](https://github.com/nanzhipro/Karpathy-llm-wiki-bootstrap-skill) | 164★ | 可安装 skill + 可运行示例 |
| [cablate/llm-atomic-wiki](https://github.com/cablate/llm-atomic-wiki) | 149★，无 license，2026-04-20 停更 | raw → atoms（一原子 = 一主张 + 类型化 frontmatter）→ wiki；**atom 是唯一真相、wiki 是派生缓存**，双层 lint |
| [yugasun/llm-wiki-skills](https://github.com/yugasun/llm-wiki-skills) | 7★ MIT | 跨平台 skill 仓库 |
| [HAL-9909/llm-wikimind](https://github.com/HAL-9909/llm-wikimind) | 2★ MIT | Markdown + BM25 + MCP，**无 embedding、无向量库** |
| [elliott-json-park/obsidian-llm-wiki-review](https://github.com/elliott-json-park/obsidian-llm-wiki-review) | 未核实 | 把一次 ingest 改动的 10–15 页做成 **PR 式 diff 审阅 + 回滚**，标记坏链/无来源页 |

生态规模信号：GitHub 仓库搜索 `llm-wiki in:name` 命中 **3,767** 个、`karpathy wiki in:description` 命中 **1,339** 个；社区索引 [awesome-llm-wiki](https://github.com/gavischneider/awesome-llm-wiki)（含 r/LLM_Wiki）。MCP 形态另有 npm `llm-wiki-mcp`、`portable-llm-wiki-mcp`、`@opencode-llm-wiki/mcp-server`；代码库 wiki 方向有 [langchain-ai/openwiki](https://github.com/langchain-ai/openwiki)（自带评测基准）。另有 [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki)（19,898★ 桌面应用，是否自称遵循该范式**未核实**）。

对照可见：通用侧的实现几乎全部选择 **skill / CLI / MCP** 形态，而不是宿主内建插件——这与"schema 文件 + 工作流"是范式核心的判断一致。

### 3.2 PKM 侧插件（成熟度参差）

[Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) 5,468★（语义只做建议、落链需人工拖拽）、[Copilot for Obsidian](https://github.com/logancyang/obsidian-copilot) 7,754★ AGPL-3.0、[Smart Composer](https://github.com/glowingjade/obsidian-smart-composer) 2,330★（README 声明停更）、[obsidian-mcp-tools](https://github.com/jacksteamdev/obsidian-mcp-tools)（已归档）、[reor](https://github.com/reorproject/reor)（已归档）。真正"自动生成 + 自动维护交叉链接 + 一致性检查"的比例很低，且集中在单人项目；把 PKM 插件当基础设施等于承接他人的维护风险。

### 3.3 卡片数据结构的历史答案

- [Anki](https://docs.ankiweb.net/getting-started.html)：**Notes（字段）与 Cards 分离**，卡片是"笔记 + 模板"的投影，改字段同步所有卡；成熟二十年的"卡片 ≠ 页面"模型。
- [A-MEM](https://arxiv.org/abs/2502.12110)（NeurIPS 2025）：新记忆触发既有记忆的属性更新（memory evolution），与"卡片 + 自动交叉链接 + 反向更新"同构且有评测。
- [Evergreen notes should be atomic](https://notes.andymatuschak.org/Evergreen_notes_should_be_atomic)：粒度只有权衡，没有标准答案。
- 未发现公开项目使用 `card-index.json` 这一命名；社区等价物是**生成的 `index.md`**（olw）或 **SQLite 索引**（qmd、basic-memory、Anki）。成熟做法都把索引当作**可重建的派生物**。

### 3.4 实证与批评（决定"值不值得做"的一条硬证据）

[Single-Round Vector RAG vs an LLM-Compiled Wiki: A Preregistered Comparison](https://arxiv.org/abs/2605.18490)（arXiv:2605.18490，2026-05 首版 / 2026-08 v2，预注册对照实验，24 篇论文 / 13 个问题 / 同一答题模型 / 两位盲评评审）的结论值得直接引用：

- **综合能力**：wiki 在"跨论文连接发现"上明显更好，但预注册的"组织优势"在两位评审合并后**低于阈值**；单事实查找上 RAG 守住阵地（第二位评审单独看会推翻这两个判断）。
- **成本反转**：构建侧 wiki 贵约**两个数量级**（符合预期），但查询侧完全反转——**wiki 每次查询约花 21 倍 token，"不存在盈亏平衡点"**。
- **基线敏感性**：RAG 的"分解-检索"变体几乎抹平 wiki 的综合优势且 token 更低，仅在"逐条声明的引用支持"上仍落后。
- **评分不稳**：整体 groundedness 与原子化引用检查**方向相反**，评审间排序一致性 near-zero（rho=0.04），而最具体定义的准则 rho=0.81。
- 论文自己的结论：这不是单一能力之争，"哪个赢取决于检索基线、评分粒度与评审"。

社区与企业侧的批评与实测按证据强度排列：

1. **LangChain WikiBench 实测（最强）**：[Evaluating OpenWiki with WikiBench](https://www.langchain.com/blog/evaluating-openwiki-with-wikibench)——读者 agent **只读 wiki 的得分远低于只读源码**；"wiki + 源码"组合最好且更便宜，结论是"wiki 是索引/向导，不是源码替代品"。
2. **预注册对照**（上段 arXiv:2605.18490）：21 倍查询 token、不存在盈亏平衡点。
3. [arXiv 2608.21829](https://arxiv.org/abs/2608.21829)：agent 策展知识库的增益随与训练问题的**键重叠度**变化，完全不共享 key 时仅为 parity——编译增益不是普遍泛化。
4. **方法论批评**：[Andrej Karpathy's LLM Wiki is a Bad Idea](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618)列出错误永久化、可追溯性丧失、成本从查询转移到摄入、规模化后的重复页与概念重叠。
5. **聚合信号（证据强度低）**：《[The LLM-Wiki Disaster](https://gist.github.com/gnusupport/3eea61c329b26400607e8b4ed6bc2208)》汇集 15+ 条批评，但属二手聚合、无讨论、语气夸张，只作为"存在成规模批评"的信号。
6. **停更信号**：4 月热潮的多份产物已停更（obsidian-llm-wiki-local 2026-05-26 后无更新、[NicholasSpisak/second-brain](https://github.com/NicholasSpisak/second-brain) 2026-04-07、jason-effi-lab/karpathy-llm-wiki-vault 2026-04-13、lewislulu/llm-wiki-skill 2026-04-16 自述 Experimental）。

企业/生产侧讨论另见 [Managed Memory Is Still Not Governed State: Production Lessons from LLM Wiki v2](https://zenodo.org/records/19545947)、[Compiled Memory vs Governed State](https://zenodo.org/records/19507593) 与 AWS 中国博客《[当知识可以被"编译"——LLM Wiki 企业级实践的三道坎](https://aws.amazon.com/cn/blogs/china/llm-wiki-enterprise-practice/)》（这三篇本轮只核实到存在与标题主张，未读全文，作为待读线索列出）。

**对本项目的直接含义**：不要用 wiki 卡片替代现有检索路径或源码/原始判例（`patent_wiki_search` 的关键词/FTS 应保留，与 §3.5 第 7 条一致）；wiki 的定位是**索引与向导**，增量价值在跨源综合与引用支持，且必须按"构建贵、查询更贵"做预算。

### 3.5 从通用生态提炼的结构性结论

1. **追加优先于就地改写**（mem0 ADD-only、Graphiti validity window、olw 的 `raw/` 不可变三者一致）：卡片写入应是 append-only 或草稿态，索引另存且可重建。
2. **一致性检查交给确定性代码，LLM 只提案**（olw 的 lint 可复算；Smart Connections 的语义相似度必须由人变成链接）。
3. **lint 要分等级并给退出码**，而不是只出报告：[nvk/llm-wiki](https://github.com/nvk/llm-wiki) 用 `lint --fail-on critical|warning|suggestion` 把它接成 CI 门禁，kytmanov 另配 `maintain --fix`。
4. **人工闸门是共同点**（olw 强制草稿审核、驳回理由回灌、5 次驳回自动停编）；进一步的做法是把一次 ingest 的多页改动做成**可回滚的 PR 式 diff**（[obsidian-llm-wiki-review](https://github.com/elliott-json-park/obsidian-llm-wiki-review)）。
5. **必须显式防"重编译覆盖人工修订"**：olw 检测手改并跳过；[GD4AI/obsidian-llm-wiki](https://github.com/GD4AI/obsidian-llm-wiki) 修过"重写被 token 上限截断时整页覆盖"。对已有 `card-index.json` 的既有库，这是首要风险。
6. **真相层次要显式**：[cablate/llm-atomic-wiki](https://github.com/cablate/llm-atomic-wiki) 用 atom 层（一原子 = 一主张 + 类型化 frontmatter）作为唯一真相、wiki 作为派生缓存，专为消除"wiki 被误当作真相来源"；schema 因此是**编译器规范**而非自由提示。
7. **检索形态比检索精度更重要**：把命中正文随结果一起返回，胜过只返回路径；关键词检索应保留为原生路径（一份厂商小样本试点报告称，简单定位任务中模型仅 0–6% 会选语义工具，且语义优先反而降低成功率——自报数据，仅作方向参考）。要不要向量层**尚无定论**：qmd 走 BM25 + 向量 + 重排 + RRF，olw 则完全不上向量库。
8. **规模化后索引确实优先失效**：Karpathy 点名的 `qmd` 与本轮多个实现都印证这一点，但那是"素材规模上千"之后的问题，不是立项前的理由。

## 4. 社区生态二：DSH 自己的插件生态（本轮最关键发现）

`awesome-dsh-plugin` 精选列表在 2026-09-23 抓到 **4,186 个插件条目**，分类分布中 **🧠 记忆 195 条**（第 8 大类），"wiki / Obsidian / 知识库 / 知识卡 / 笔记"相关条目 **95 条**。这不是蓝海，是红海。

**已经实现 LLM Wiki / 知识中心形态的 DSH 插件**（前两行在描述里直接声明 Karpathy 范式）：

| 插件 | 热度/活跃（2026-09-23） | 机制 |
|---|---|---|
| [iwtown/dsh-llm-wiki](https://github.com/iwtown/dsh-llm-wiki) | 5★ MIT，2026-08-26 建，2026-09-05 更新 | "Karpathy LLM Wiki 模式的 DSH 知识库系统：wiki-write/wiki-search 技能引导模型写读 Obsidian wiki，零依赖管线（lint/索引/记忆体同步/质量闭环），极简生命周期插件注入守则与知识预览" |
| [weibaohui/dsh-kb](https://github.com/weibaohui/dsh-kb) | 1★，2026-09-05 建，2026-09-23 更新 | 团队知识库：raw 入料自动入队、bot 会话串行蒸馏成文（raw 不可变 / 两步加工 / log 流水 / **月度 lint**） |
| [LittleBlackTong/dsh-plugin-memory](https://github.com/LittleBlackTong/dsh-plugin-memory) | — | "带 LLM Wiki 结构的长期 markdown 记忆库" + SOUL 人格文件 |
| [D2Moqi/dsh-openwiki](https://github.com/D2Moqi/dsh-openwiki) | 1★ MIT，2026-08-29 建 | 移植 [langchain-ai/openwiki](https://github.com/langchain-ai/openwiki)：生成/阅读/更新仓库 Wiki 与 **Grounded Claims（溯源知识卡片）**，复用 DSH 已配置模型；Host 托管 CLI 引擎 + Client 提供目录树与阅读界面 |
| [myYangyunfan/dsh_cardian](https://github.com/myYangyunfan/dsh_cardian) | 1★ MIT，2026-09-01 建 | 知识中心三支柱：RepoWiki / **Knowledge Cards** / Memory，全部落本地 Obsidian vault（Markdown + YAML frontmatter）；`cardian.card.*`、`recall`、`search`、`backlinks`、`related`、`doctor`、`reindex`；监听 `session/event` 做活动驱动自动刷新 |
| [Dayi-Z/dsh-learn-wiki](https://github.com/Dayi-Z/dsh-learn-wiki) | — | 纠错式补料知识库：撞墙时后台抓取蒸馏，结果先落暂存区，**两段式 commit 才能进入召回，无来源页面一律拒绝** |
| [EternalNight996/dsh-memory-eternal](https://github.com/EternalNight996/dsh-memory-eternal) | — | 对话结束自动沉淀本地 Markdown 知识卡（自研去重、CJK 检索、可 git 管理），设置页图形化知识库 + 知识图谱 |
| [agentscope-ai/ReMe#dsh](https://github.com/agentscope-ai/ReMe/tree/main/integrations/dsh) | 官方级项目（AgentScope） | 自动把已完成主对话沉淀为 Markdown 记忆，`reme_search` 结合 BM25 / 可选向量 / wikilink 展开，按日整理长期记忆 |
| [bbqisbbq/dsh-tiddlywiki](https://github.com/bbqisbbq/dsh-tiddlywiki) | — | TiddlyWiki 5 作为持久知识库：10 个工具 + 内嵌编辑器 + git 同步与冲突解决 |

另有若干把 Obsidian vault 直接当知识库的桥接插件（`dsh-obsidian`、`obsidian-dsh-acp`、`runtime36`、`dsh-client-ui-obsidian-memory`）、通用知识库（`htcqp802/dsh-knowledge-base`：md/txt/json/docx/pdf 导入 + 目录化 + FTS5 BM25 + Web 管理界面）、以及"第二大脑/负面知识账本/记忆分诊"等变体。

同时要注意生态风险信号：官方 discussion 有[社区插件市场一周观察](https://github.com/deepseek-ai/deepseek-harness/discussions/3395)（标题所述为 82 个项目与"四起启动事故"，未读全文）；精选列表自身也警示"安装插件等于跑第三方代码，权限与你本人相同，收录不等于安全审查"。

**对本次议题的直接含义**：如果内置，官方将在一个已有 195 个同类、3 个直接声明同范式的赛道里再放一份，既不能吸收社区已解决的边界情况，又会造成"官方选定一种卡片格式"的锁定效应。

## 5. 本项目现状基线（仓库内已经有什么）

| 能力 | 现状 | 对卡片读写的含义 |
|---|---|---|
| [`dsh-patent-knowledge`](../../packages/patent/patent-knowledge/README.md) | `ctx.patentKnowledge`：判例/法规/wiki 卡片/IPC/知识图谱**只读**查询 | `wikiCards(query, limit)` 关键词检索（标题/概念/领域）；README 明示 P1 无向量检索、**无写 API**、源库不随包分发 |
| `WikiCardLoader` | 扫描 Markdown 卡片目录（本机 1,235 张）、合并 `patent-cards/card-index.json`、`.wiki-meta.json` 扫描缓存、惰性读正文 | 只有读路径与索引缓存；卡片生成、更新、去重、lint 均无实现 |
| [`knowledge_note_save`](../../packages/patent/patent-tools/src/tool/knowledge-note-save.ts) | 模型工具：`sha1(project|title|content)` 幂等，落 `<noteDir>/<id>.json` | 当前唯一的"写入"路径，注释明写 knowledge.db 写 API **deferred**；产出是 JSON 笔记，不是 wiki 卡片 |
| [`dsh-openviking`](../../packages/memory/openviking/README.md) | 外部上下文数据库集成：auto-recall、session capture/auto-commit、工具面、runtime skill | **既有先例**：记忆类插件以 Consumer 身份挂在 prompt/生命周期扩展点上，"no `agent-loop` code changes here" |
| skill 族（[`skill/`](../../packages/skill/README.md)） | `skill-filesystem` 从项目/用户目录发现技能；`tool-skill` 暴露目录与加载工具；插件可注册 runtime skill（openviking 即如此） | Karpathy 范式的"schema 文件 + 工作流"在 DSH 里已有载体，**不必新增插件即可先落地** |
| 分发面（[`bundle/`](../../packages/bundle/README.md)） | in-box bundle 随安装解析；第三方走 `dsh plugin --profile web add <pkg>` | "内置"意味着进 bundle 默认层；社区插件已有几十个可直接装 |
| 内置插件目录（builtin-deepseek） | 当前离线快照仅 5 条（bash/web/skill-filesystem/session-persistence-jsonl/plan-mode），`wiki`/`knowledge`/`memory` 检索均空 | 官方目录本身不承载这类能力 |
| 其它既有记忆/知识机制 | `.agents/notes/`（人工决策记录 + 归档规则）、`self-evolve`（自我评估）、专利预设的 `99-知识库/` 约定 | 与"自动编译知识"职责不同、但会被用户混同，需要在设计里显式划界 |

## 6. 评估：收益与代价

### 6.1 确有价值的部分

1. **专利域的写入闭环是真实缺口**。现有 1,235 张卡片只能读；`knowledge_note_save` 写的是 JSON 笔记而非卡片；`WikiCardLoader` 无生成/更新/去重/lint。若要让"raw 素材（判决书、审查指南、OA）→ 结构化卡片"成为可重复流程，今天没有承载它的接缝。
2. **确定性 lint 有独立价值**，且与社区结论一致：孤立卡、断链、索引与卡片不一致、重复卡片——这些都能用代码算出来，不需要 LLM 判定。当前 `card-index.json` 与磁盘卡片的一致性只靠人工维护。
3. **卡片接缝（Service Definition）能消除重复**：`patent-knowledge` 的只读查询、未来写入、外部知识库（Obsidian vault / OpenViking / ReMe）目前各有一套路径；一个"卡片目录"接缝可以让它们互为 Provider。

### 6.2 明确不划算的部分

1. **"又一个生成器"没有价值**：社区 195 个记忆类插件，其中至少 3 个已直接声明按 Karpathy 范式实现，且已处理草稿审核、去重、衰减、冲突标记、索引重建等细节。自研等于从零重踩同一批坑。
2. **官方内置会造成锁定**：卡片格式（`card-index.json` vs `index.md` vs SQLite）一旦进 bundle 默认层，就会成为事实标准，压缩社区方案的生存空间，与"一切皆插件、用户自由组合"的定位冲突。
3. **违反三条现行规则**：无当前消费者（无工具/预设依赖它）、可维护依赖已存在、需要的是接缝而不是产品插件。
4. **范式自身的成本被低估**：Karpathy 自己列出的四条硬限制（规模、结构性错误扩散、schema 决定上限、约 100 来源后需要检索基建）在仓库里都会变成长期维护面；schema 一旦随包分发，就等于官方承诺了一种知识组织方式。
5. **与既有机制重叠**：Agent Notes 管决策记录、skills 管可复用流程、openviking 管跨会话记忆、专利预设管项目知识沉淀；再多一个"卡片库"会让模型与用户都难以判断该往哪里写。
6. **成本已被量化，不能凭直觉立项**：预注册对照显示 wiki 查询约 21 倍 token 且无盈亏平衡点（§3.4）；在没有"必须跨源综合"的真实任务前，投入产出比无法证明。

### 6.3 若要内置：最小且站得住的形态

只有在"出现当前消费者"后才成立。届时按接缝做，而不是按产品做：

- **Service Definition**：`ctx.knowledgeCards`（暂名）——`scan()` / `search()` / `read()` / `writeDraft()` / `lint()`，权限与失败语义显式（只读 Provider 与可写 Provider 分开声明）；`dsh-patent-knowledge` 退化为其中一个只读 Provider，`WikiCardLoader` 成为其实现细节。
- **确定性工具**：`knowledge_cards_lint`（孤立卡、断链、索引漂移、重复正文哈希、frontmatter 缺失）与 `knowledge_cards_ingest`（把一份 raw 素材编译成**草稿**卡 + 索引更新 + 日志追加）。lint 用代码算，按 critical/warning/suggestion **分档给退出码**接进门禁（对齐 `nvk/llm-wiki` 的 `--fail-on` 实践）；ingest 只产草稿、带截断保护（防 token 上限截断即整页覆盖），经人工或审批闸门后才成为正式卡。
- **模型面约定**：卡片正文进入上下文必须可从会话日志重建（沿用 `systemPrompt.context()` 或 `agent.inject()`，如 openviking）；写入是 effect，卸载即回收。
- **分发**：默认 **opt-in**，不进 base bundle；优先 out-of-tree 包（`dsh plugin add`），与 memory 组惯例一致。
- **不做**：不做向量库（除非有明确召回失败证据）、不做 Obsidian/vault UI、不做团队治理、不搬 `patent-knowledge` 的私有数据。

## 7. 建议路线

**P0（零代码，先验证）**：装 1–2 个社区同类插件（`iwtown/dsh-llm-wiki` 或 `myYangyunfan/dsh_cardian`），按 Karpathy 的"小步起步"用 5–10 份真实素材（如 5 篇判决 + 2 份审查指南章节）跑 ingest/lint，记录四件事：卡片是否比现在的关键词检索更可用、lint 是否抓到真问题、schema 需要改几轮、**同等任务的 token 成本对比（对照 §3.4 的 21 倍查询成本，确认本域是否也不同）**。结论落在这份验证上，而不是落在直觉上。

**P1（若 P0 通过，且出现内部消费者）**：做接缝与 lint，不做生成器产品——`ctx.knowledgeCards` 定义 + `patent-knowledge` 转型为 Provider + 确定性 lint 工具 + 专利预设消费。范围限定在"让既有 1,235 张卡片可写、可校验、可互操作"。

**P2（可选差异化）**：若要内置插件，差异化应落在社区没做好的地方：**溯源门禁**（无来源不入正式卡，参考 `dsh-learn-wiki` 的两段式 commit）、**专利域 schema**（权利要求/说明书/审查标准分类与 `card-index.json` 兼容）、**人工修订保护**（防重编译覆盖手改）。

**不建议**：为"通用 LLM wiki 卡片"新增 shipped 默认插件、新开包组、或在 base bundle 里加行。

## 8. 风险与验收

| 风险 | 缓解 |
|---|---|
| 生成卡片质量不稳，污染既有 1,235 张卡片 | 只写草稿 + 人工闸门；写入路径幂等（沿用 `sha1` 键）；raw 层不可变 |
| 结构性错误扩散（错误关联被多页强化） | lint 作为合并前门禁；矛盾显式标记而非静默覆盖；git 可回滚 |
| 索引与卡片漂移 | `card-index.json` / `.wiki-meta.json` 视为可重建派生物，加"索引一致"断言 |
| 与 Agent Notes / skills / openviking 职责混淆 | 在设计文档里显式划界：卡片 = 领域事实，Notes = 决策，skills = 流程，openviking = 跨会话记忆 |
| 维护面膨胀 | P1 只做接缝 + lint；任何向量/UI 需求先有证据再立项 |

验收（若走到 P1）：`knowledge_cards_lint` 对注入的孤立卡/断链/索引漂移各有一条失败用例；`ingest` 产出的草稿在未经确认前对模型不可见；既有 1,235 张卡片扫描数量与 `card-index.json` 一致；卸载插件后无残留 effect。

## 附录 A：证据来源

- 仓库：`packages/patent/patent-knowledge/README.md`、`packages/patent/patent-tools/src/tool/knowledge-note-save.ts`、`packages/memory/README.md`、`packages/memory/openviking/README.md`、`packages/skill/README.md`、`packages/bundle/README.md`、`packages/README.md`、`docs/architecture.md`、根 `AGENTS.md`、`packages/AGENTS.md`。
- 本机数据：`~/.dsh/knowledge/wiki/` 1,235 张 `.md`（`.wiki-meta.json` 记录 files=1235、dirs=88；`patent-cards/card-index.json` total_cards=130）。
- 通用生态：见 §3 各条链接（星标/许可/末次提交于 2026-09-23 经 GitHub API 读取）。
- DSH 生态：`awesome-dsh-plugin` README（2026-09-23 抓取，4,186 条目）；各插件仓库经 GitHub API 核实；内置目录查询经 `market_plugin_search`（`wiki`/`knowledge`/`memory` 均为空，目录共 5 条）。
- 范式源头：Karpathy 的 LLM Wiki 文档发布在 gist（https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f）；本轮未能直接打开（API 限流 / 连接超时），其存在由 ≥3 个独立项目 README 引用同一 URL 交叉印证；范式要点另见 [deephub 解读](https://cloud.tencent.com.cn/developer/article/2655117)。
- 实证与批评：[arXiv:2605.18490](https://arxiv.org/abs/2605.18490)（预注册 RAG vs LLM-compiled wiki 对照，v2 摘要 2026-09-23 读取）、[LangChain WikiBench](https://www.langchain.com/blog/evaluating-openwiki-with-wikibench)、[arXiv 2608.21829](https://arxiv.org/abs/2608.21829)、[Medium 批评文](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618)。

## 附录 B：方法说明

两路调研并行：通用开源生态（PKM 插件、记忆框架、本地混合检索、卡片数据结构）与 DSH 插件生态（精选列表普查 + 目标仓库 API 核实）。仓库侧结论均以本机代码/文档/数据实测为准。凡未取到一手证据者已在该条目标注"未核实"或来源性质（自报数据），未使用推测填补数字。

过程说明：两路调研均已返回并整合；通用一路的最后一批结果（GitHub 生态规模、LangChain WikiBench 实测、停更信号、Karpathy gist 线索）在原稿完成后并入，正文与附录已同步更新。
