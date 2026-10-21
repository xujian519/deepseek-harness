# 法律模式 preset

[English](legal.md) | 中文

`legal` agent preset 在 DeepSeek Harness 上组合一个面向个人中国法律实务的 Agent。本 bundle 在 `presets/legal.patch.yml` 中声明它，内容随附在 `skills/legal/` 下。

## 挂载内容

除标准工作行（shell、文件、jobs、提醒、skills、goal 命令与工具、计划模式、压缩、委托、web，以及告诉模型今天日期的时钟行）外，本 preset 另挂载两个交付行：`@deepseek-ai/dsh-doc-template` 按受审模板渲染 Markdown/DOCX/PDF，`@deepseek-ai/dsh-document-deliver` 登记交付件并运行确定性文档检查。人设补上法律身份、引用纪律与交付门禁。

`tool-web` 配置为 `search: false`、`fetch: true`。检索统一走 ego lite：模型在 `tool-bash` 中运行 `ego-browser nodejs`，按 `legal-research` 技能操作，因此搜索摘要不能代替已打开的原文。`web_fetch` 只在浏览器不可用时作为公开静态页面的兜底。不挂载任何法律 MCP。

## 状态布局

所有可写路径都在会话工作区内，因此每次写入都落在 `workspace-write` 沙箱允许的范围内：

- `./.legal/company-profile.md` — 个人/执业层面的共享事实。
- `./.legal/practice/<domain>.md` — 四个领域的实务画像。
- `./.legal/references/` — 共享参考与领域法条基线。
- `./.legal/research/evidence.jsonl` — 检索证据。
- `./matters/<slug>/` — 案件工作区：`matter.md`、`input/`、`work/`、`output/`、`research/`、`audit/matter-log.md`。

请把法律工作根目录（例如 `~/legal-workspace`）作为会话工作区打开。`legal-setup` 只补缺失模板，不覆盖已编辑的画像。

## 技能

四个导入的领域库，统一命名空间，扁平目录也不会重名：

- `legal-commercial-*` — 11 个：保密协议、供应商协议、SaaS/MSA、建设工程合同审查、续约跟踪、上报路由、冷启动访谈。
- `legal-litigation-*` — 19 个：接案、时间线、要件分析表、律师函、证据保全、特权清单、庭前准备、中立主持人庭审提纲、冷启动访谈。
- `legal-employment-*` — 19 个：录用审查、解除审查、用工分类、工时工资问答、制度起草、内部调查、假期跟踪、冷启动访谈。
- `legal-research-*` — 5 个：法源核验、类案比较、争点备忘录、讲座来源包、冷启动访谈。

五个手写模式技能：

- `legal-setup` — 初始化工作区布局。
- `legal-matter` — 新建、列出、切换与关闭案件。
- `legal-research` — ego lite 检索与证据记录。
- `legal-citation-check` — 核验法条、司法解释与案例。
- `legal-quality-gate` — P0/P1 交付门禁与免责声明。

## 有意省略

`tool-plugin-market`、`present`、`tool-plugin-manager` 不挂载：这是个人组合，安装或编辑插件通过 `dsh plugin` CLI 完成。源仓库的定时 agent 与 cookbook 本阶段不移植，因为它们依赖 Slack、邮件与商用 MCP。对应的人工技能仍然可用，`tool-schedule` 可以建立提醒；watcher agent 本身没有运行载体。

## 来源与许可证

导入内容来自 [claude-for-legal-ZH](https://github.com/CSlawyer1985/claude-for-legal-ZH) 1.1.0，版权人为陈石律师 / CSlawyer1985，采用 Apache License 2.0。`skills/legal/LICENSE` 与 `skills/legal/NOTICE` 保存许可证与署名，`skills/legal/SOURCES.md` 记录源版本与提交号。修改内容列在 NOTICE 中：技能命名空间、路径与命令重写、单一案件指针、ego lite 检索。外围 bundle 仍为 MIT。

## Windows

模式技能包含工作区初始化与案件管理的 PowerShell 等价命令；`legal-research` 记录了 Windows 下 `ego-browser` 使用 `%TEMP%` 请求路径的写法。

## 前置条件

- `ego-browser` 在 `PATH` 中；每个安装版本运行一次 `ego-browser skill`。
- 一个由用户掌控的会话工作区；画像仍含 `[PLACEHOLDER]` 时，先跑对应的 `legal-<领域>-cold-start-interview`。
- 模型需要 DeepSeek API key。会话为个人使用，日志上传与遥测按需开启。
