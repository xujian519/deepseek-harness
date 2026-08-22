# OpenDesign 知识资产

[English](README.md) | 中文

一个**默认关闭的 overlay**，把 [OpenDesign](https://github.com/nexu-io/open-design) checkout 的 Agent-Skills 目录挂载进 dsh 面向模型的技能目录：`skills/`（100+ 功能设计技能）与 `design-templates/`（渲染模板目录——原型、Deck、仪表盘、图片等）。这是最轻的接入面：无 OpenDesign 守护进程、无 MCP 服务器、无网络。磁盘上已有的文件就是资产。

## DSH 做什么

DSH 扫描两个配置目录，解析每个 `SKILL.md` 的 frontmatter（`name` 与 `description` 必填；`triggers` 等未知字段被忽略），并把胜出者发布到内置技能目录。模型在 `<available_skills>` 中看到 OD 技能，用 `skill` 工具加载；设计模板技能携带资源提示，使 `assets/` 与 `references/` 相对技能目录解析。

DSH **不会**克隆 OpenDesign、安装它、运行其守护进程、启动 Agent 运行时或预览工件。`design-systems/`（`DESIGN.md` 品牌契约）不是技能根；当模板技能要求激活的设计系统时，用文件系统工具读取 `<OPEN_DESIGN_DIR>/design-systems/<brand>/DESIGN.md`。

## 前提

一个 OpenDesign checkout，并用 `OPEN_DESIGN_DIR` 指向其根目录：

```sh
git clone https://github.com/nexu-io/open-design.git
export OPEN_DESIGN_DIR="$PWD/open-design"
```

## 启用

```sh
dsh web --patch "$PWD/examples/opendesign/cordis.yml"
```

若要保持跨运行的选择，把该文件唯一的 `insert` patch 合并进用户 patch 层——单个 profile 用 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，机器级全部 profile 用 `$DSH_HOME/cordis.patch.yml`。不要直接覆盖已有文件：它可能已包含无关的用户 patch。

未设置 `OPEN_DESIGN_DIR` 时，provider 以零根注册——显式的空目录，而不是静默跳过。

## 接线方式

overlay 只新增一个隔离的 `@deepseek-ai/dsh-skill-filesystem` 实例。`providerName: open-design` 使其与 profile 默认的 filesystem provider 区分（重名 provider 会被 registry 拒绝），`includeDefaultRoots: false` 把它限制在 OpenDesign 根内。技能注册表与面向模型的目录来自内置技能能力，默认 profile 已挂载。

发现只深入一层（`<root>/<name>/SKILL.md`），直接放在根下而没有独立目录的技能不会被看到。OD 技能的交叉引用（例如 `web-prototype` 读取 `references/layouts.md`）相对技能目录解析。

## 许可证

OpenDesign 是 Apache-2.0。本 overlay 不添加任何 OpenDesign 内容——只是把 dsh 指向用户自己的 checkout。
