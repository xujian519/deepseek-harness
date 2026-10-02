# Agent Note: 技能发现抵达扫描根下一层分类

Status: implemented

[English](2026-10-03-skill-category-discovery.md) | 中文

## Problem

技能库按主题组织技能包——`<root>/<category>/<skill>/SKILL.md`——部署的 `~/.agents/skills` 库正是如此：13 个分类目录下 58 个技能，根目录另有 18 个。`skill-filesystem` 只读扫描根的直接条目，于是一个自身没有 `SKILL.md` 的分类目录变成了"没有技能文件的技能目录"，整棵子树静默消失：既无目录条目，也无警告或日志。

这个缺口有三重代价。想让这些技能可见的部署，必须把每个分类目录逐个列进 `customSkillDirs`，等于为根目录已经声明的布局维护第二份副本。专利 preset 把结构缺口改写成模型的义务——"判断某个技能是否存在以文件为准，不以 `skill` 目录为准"，外加一段用 `glob` 找回目录未列出的技能的配方——而窗口内的工具调用记录显示模型并未照做。而且，一个存在于磁盘却被目录隐去的技能，在会话内部与一个从未安装的技能无法区分。

## Decision

`skill-filesystem` 在每个扫描根下发现两层技能：

- **根层**——目录 bundle `<name>/SKILL.md` 或平铺文件 `<name>.md`。
- **下一层分类**——直接子目录自身没有 `SKILL.md` 时，其下每个含 `SKILL.md` 的子目录都是技能。

直接子目录自带 `SKILL.md` 时它本身就是技能，不再同时按分类读取。分类目录自身的平铺 `.md` 是资料而非平铺技能：技能库里的 `_shared/common.md` 是共享材料，把它当作技能候选只会每次发现时以"missing YAML frontmatter"警告丢弃。隐藏目录（以 `.` 开头）是仓库或工具元数据——部署库里的 `.git` 与 `.nuo`——永不按分类读取。分类层以下不再发现。

监视管理器遵循同一深度：Chokidar 以 `depth: 2` 打开现有根；分类目录的出现、两层中 bundle 的 `SKILL.md` 添加/移除/变更、根层平铺 `.md` 的添加/移除都会使提供方失效。第一方的 `write`/`edit` 路径经 `fs/observed` 识别分类内 bundle 的 `SKILL.md`，并在四个路径段处停止。

两处要求模型绕过目录的 preset 段落已删除；preset 现在陈述按分类组织的技能根会列出其下技能。

## Alternatives considered

**把分类内技能逐个软链到根目录（部署侧修复，零代码改动）。** issue 给出的零成本方案：`<root>/<skill> -> <root>/<category>/<skill>`，即 `ego-browser` 已在用的形态。它只修一台机器，让其他部署各自去发现同一种静默；为根目录已声明的布局保留了第二份必须在每次新增技能时维护的副本；也留着 preset 里叫模型不要相信目录的文字。否决：布局由根目录自己声明，错的是提供方。

**只告警，不发现。** 保留一层契约，检测子目录含 `SKILL.md` 的分类目录并记日志。这消除了静默，但不消除缺口：部署库仍需每个分类一行 `customSkillDirs`，模型仍无法加载该技能。否决作为修复方案；它作为"超过一层分类之后"的已记录限制保留下来。

**同时发现分类目录内的平铺 `<name>.md`。** 与根层对称，但部署库的 `_shared/` 有六个平铺 Markdown 资料文件。每次发现都会解析它们、不满足 frontmatter 要求、并告警——把布局问题变成目录噪声，且没有任何场景需要该行为。否决。

**增加 `discoveryDepth` 配置项。** 深度旋钮形式上属于部署可变选择，但没有部署要求深度 3；一个仅支持 1 与 2 的字段会招来"失败表现为技能静默缺失"的配置。这两层就是技能库实际使用的布局；更深的树保持为已记录限制。否决。

## Consequences

**按分类组织的根现在无需配置即可产出其技能。** 部署库的 58 个分类技能经 `~/.agents/skills` 根进入目录；那些只为绕过旧深度而存在的 `customSkillDirs` 行成为冗余、可以删除（若部署希望该库在每个 profile 都可见，保留 `includeDefaultRoots: false`——那些行正是为此写的）。

**同名冲突仍由注册表裁决。** 一个名字同时出现在根层与分类内、或出现在两个分类内时，按注册表既有的 rank-then-order 规则解析，落败者记一条警告。根内两层的发现顺序都按字母序，因此胜者是稳定的。

**超过一层分类的深度仍然静默。** `<root>/<a>/<b>/<skill>/SKILL.md` 不被发现，也不产生任何诊断，与根层对格式错误技能的处理一致。README 陈述该限制；issue 否决"只告警"方案的论证正是它不成其为运行时诊断的原因。

**发现一个根要多列出每个非 bundle 子目录一次。** 持有分类目录的根会多读该目录一次；隐藏目录、文件、以及已自带 `SKILL.md` 的目录不额外付出。仓库自身的技能根（patent、document、agent-preset 三个 bundle 与 office 资产）都不含第二层 `SKILL.md`，因此它们的目录与回放它们的录制会话均不变。

## Testing

`packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` 直接覆盖该形态：来自两个分类的目录 bundle、分类内的平铺 `.md` 资料、第三层 bundle、隐藏分类、其子目录也持有 `SKILL.md` 的顶层 bundle，以及分类内技能的已加载 `path` 与 `resourceBase`。`fs/observed` 用例钉住：分类内 bundle 的 `SKILL.md` 使提供方失效，更深的资源文件不会。

`packages/skill/skill-filesystem/tests/skill-filesystem-watcher.spec.ts` 钉住 `depth: 2` 与事件集：分类目录的 `addDir`、分类内 bundle 的 `SKILL.md` 变更、以及该 bundle 的 `unlinkDir` 各触发一次失效，而分类内平铺 `.md` 的变更与更深资源变更不会。
