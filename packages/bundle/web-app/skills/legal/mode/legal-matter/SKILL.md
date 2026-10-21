---
name: legal-matter
description: "管理个人法律案件工作区：新建、列出、切换、查看或关闭 matters/<slug>，维护只追加的案件日志与当前案件指针。用户提到案件/案卷/事项、要求归档输出、或需要确定这次工作属于哪个案件时使用。"
---

# 案件工作区

案件是法律工作的归属单位。每个案件一个目录，所有输入、过程稿、检索证据、交付件和日志都落在里面，跨轮可追溯。

## 布局

```
matters/<slug>/
  matter.md           案件事实源（当事人、管辖、阶段、立场、期限）
  history.md          按日期的事件记录
  notes.md            自由形式的工作笔记
  input/              当事人提供的原始材料（只读，不修改）
  work/               过程稿、分析草稿、比对表
  output/             对外交付件（按日期命名）
  research/           检索证据 evidence.jsonl 与抓取原文
  audit/matter-log.md 只追加的案件日志
```

`./.legal/active-matter` 保存当前案件 slug，一行为一个 slug。这是全模式唯一的案件指针：领域技能要求"当前案件"时，读取这个文件，不另建指针。

## 命令

用户说“新建案件”“列出案件”“切换到某案”“当前案件”“关闭案件”时执行对应段，也可以直接用 `/legal-matter new|list|switch|close <slug>`。slug 用短横线小写英文或拼音，例如 `acme-nda-2026`。

下面的命令里 `<本技能 Base directory>` 要替换成本技能加载时 `<skill_resources>` 显示的绝对路径。

### 新建

```bash
slug='<slug>'
[ -e "matters/$slug" ] && { echo "matters/$slug 已存在"; exit 1; }
mkdir -p "matters/$slug"/{input,work,output,research,audit}
cp '<本技能 Base directory>/references/matter-template.md' "matters/$slug/matter.md"
printf '# %s\n\n按日期记录案件事件。\n' "$slug" > "matters/$slug/history.md"
printf '# %s\n\n' "$slug" > "matters/$slug/notes.md"
printf '%s\n' "$slug" > ./.legal/active-matter
printf '\n## %s 建立案件 %s\n\n- 承办：待确认\n' "$(date '+%Y-%m-%d %H:%M')" "$slug" >> "matters/$slug/audit/matter-log.md"
find "matters/$slug" -maxdepth 1 | sort
```

建好后向用户确认：案件名、当事人/对方、管辖或仲裁机构、当前阶段、立场、最近期限。把答案写进 `matter.md` 的对应字段。

### 列出

```bash
find matters -maxdepth 2 -name matter.md -print 2>/dev/null | sort
printf '当前：%s\n' "$(cat ./.legal/active-matter 2>/dev/null || echo '（未选择）')"
grep -H '^案件名称：' matters/*/matter.md 2>/dev/null
```

### 切换

```bash
slug='<slug>'
[ -f "matters/$slug/matter.md" ] || { echo "没有这个案件：$slug"; exit 1; }
printf '%s\n' "$slug" > ./.legal/active-matter
sed -n '1,40p' "matters/$slug/matter.md"
```

### 查看当前

```bash
slug=$(cat ./.legal/active-matter 2>/dev/null)
[ -n "$slug" ] || { echo '未选择案件'; exit 0; }
sed -n '1,80p' "matters/$slug/matter.md"
tail -n 10 "matters/$slug/audit/matter-log.md" 2>/dev/null
```

### 关闭

先确认案件已交付或终止。然后：

```bash
slug=$(cat ./.legal/active-matter 2>/dev/null)
[ -n "$slug" ] || { echo '未选择案件'; exit 0; }
printf '\n## %s 关闭案件\n\n- 结论：待补充\n- 交付件：见 output/\n' "$(date '+%Y-%m-%d %H:%M')" >> "matters/$slug/audit/matter-log.md"
rm -f ./.legal/active-matter
```

关闭只解除当前指针，不删除任何文件。

## Windows（PowerShell）

```powershell
$skillDir = '<把 Base directory 的绝对路径粘贴到这里>'
$slug = '<slug>'
New-Item -ItemType Directory -Force "matters/$slug/input","matters/$slug/work","matters/$slug/output","matters/$slug/research","matters/$slug/audit" | Out-Null
Copy-Item "$skillDir/references/matter-template.md" "matters/$slug/matter.md"
Set-Content "matters/$slug/history.md" "# $slug`n`n按日期记录案件事件。"
Set-Content "matters/$slug/notes.md" "# $slug"
Set-Content ./.legal/active-matter $slug
Get-ChildItem "matters/$slug" | Select-Object Name
```

列出与切换：

```powershell
Get-ChildItem matters -Recurse -Filter matter.md | Select-Object FullName
Set-Content ./.legal/active-matter '<slug>'
Get-Content ./.legal/active-matter
```

## 使用约束

- **先定案件再动笔。** 有活动案件时，输出写入该案件目录；没有活动案件且任务明显属于某个案件时，先问清楚或新建，不把输出写到工作区根目录。
- **input 只读。** 当事人材料不就地修改；需要标注时写到 `work/` 的副本。
- **日志只追加。** 每次实质推进（新证据、结论变化、交付、期限变化）追加一条，写明改了什么、为什么、影响哪个结论。不修改历史条目。
- **输出放 output/。** 正式交付件按 `YYYY-MM-DD-<名称>.<扩展名>` 命名；过程稿留在 `work/`。
- **跨案件隔离。** 默认不读取其他案件的文件；用户明确要求跨案比较时才读，并在日志里记录读取范围。
