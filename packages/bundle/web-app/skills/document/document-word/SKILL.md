---
name: document-word
description: |
  Word 交付管线：用 render_doc_template 从模板生成 .docx（Markdown 源 + 模板变量），
  需要页眉页脚、目录字段等模板不覆盖的样式时再用 officecli 技能加工。
whenToUse: 用户明确要求 .docx/Word 文件（合同、规范、报告、论文等）。
---

# Word 交付管线

需要 `.docx` 成品时，先用 `list_doc_templates` 找模板、`render_doc_template`（`format: "docx"`）生成；页眉页脚、目录字段、页码这类模板未覆盖的排版再用 officecli 技能加工。

## 流程

1. 读 brief；无则先跑 document-brief。确认 Word 特殊要求：页眉页脚、封面、
   目录字段、页码、样式名。
2. `list_doc_templates` 找到匹配模板与其变量表；无匹配模板时说明并改用通用的
   规范样式撰写（不要手工拼 .docx 字节）。
3. 撰写变量内容（正文段落、表格以 Markdown 片段传入），调用 `render_doc_template`：
   - `variables` 必须填齐模板的全部必填变量，缺失会让调用失败并指名变量；
   - 读回 `residual`（未填占位符）与 `warnings`，两者都必须清空再交付；
   - 需要时用 `title` / `author` / `date` / `filename` 覆盖元数据。
4. 落盘：`content` 是 base64 的 DOCX 包，用 shell 解码写入成品路径
   （`printf '%s' '<base64>' | base64 -d > out/report.docx`；macOS 旧版 `base64` 用 `-D`）。
   随后用 `read` 或 `ls` 复核文件存在与字节数。
5. 需要页眉页脚、目录字段、页码或命名样式套用时，交 officecli 技能继续加工同一文件。
6. 自检（document-quality-gate）后交付：`<name>.docx` 路径与摘要；登记时格式填 `docx`。

## 硬性规则

- 文档结构以模板与 Markdown 源为唯一事实来源，转换产物不同步手改。
- 事实性断言（数据、条款、版本）必须带来源；合同/法律文件加免责说明。
- 不伪造二进制产物：模板渲染不可用时改交 Markdown 并说明，绝不手工拼 .docx 字节。
