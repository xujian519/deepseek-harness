---
kind: upgrade-guide
description: "`FileSystem` 新增抽象 `writeBytes` 变更原语，`FsWriteOutcome.after` 变为可空，`render_doc_template` 可把结果写入 `output_path`。"
---

# 文件系统提供方获得字节写入

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-fs` 新增抽象方法 `FileSystem.writeBytes(target, bytes, expected?, signal?, sandboxPolicy?)`，它是 `readBytes` 的变更对应项。它与 `writeText` 共享 `FsWriteIntent`（`createIfAbsent` / `replaceIfVersion`）与每个目标的原子发布路径，因此消费方可以把渲染出的文档包、图像或归档经提供方写入，而不是走宿主路径。字节写入时 `FsWriteOutcome.before` 与 `FsWriteOutcome.after` 为 `null`：字节没有文本投影。因此 `FsWriteOutcome.after` 由 `string` 变为 `string | null`。`writeText` 返回新增的 `FsTextWriteOutcome`（`after` 非空的 `FsWriteOutcome`），只处理文本的调用方无需收窄即可继续使用非空的 `after`。

`LocalFileSystem` 与 `SandboxedFileSystem` 在既有的原子暂存路径上实现该方法；沙箱后端对它的围栏与 `writeText` 完全相同。`SshFileSystem` 以类型化的 `FS_IO_ERROR` 拒绝调用，因为私有 SSH helper 协议还没有字节写入操作。其他继承 `FileSystem` 的提供方必须实现 `writeBytes`；缺少该方法后子类不再满足抽象约定，挂载它的部署无法通过编译。

`render_doc_template`（`@deepseek-ai/dsh-doc-template`）新增可选参数 `output_path`。提供时，工具按调用会话的工作区解析该路径并写入渲染结果——`markdown`/`html` 写 UTF-8 文本，`docx` 写原始包——并在既有结果字段之外返回 `path` 与 `bytes`。写入按部署解析出的文件策略执行，不做逐次升级协商。省略 `output_path` 时保持原行为：结果只带 `content`，不写文件。插件现在注入 `fs`，因此挂载 `doc-template` 的组合必须挂载文件系统后端。

## 迁移

1. 为本仓库之外的每个 `FileSystem` 子类实现 `writeBytes`。无法写原始字节的提供方应以类型化 `FsError`（`FS_IO_ERROR` 或专门的能力错误码）拒绝，而不是把字节编码后交给 `writeText`。
2. 在把写入结果当作文本处理的地方，按 `FsWriteOutcome.after` 可空处理；`before === null` 仍表示「没有差异基准」。
3. 所有挂载 `doc-template` 的部署都要挂载文件系统后端；该插件现在要求 `ctx.fs`。
4. 改用 `render_doc_template` 的 `output_path` 落盘，而不是让模型把 base64 的 `content` 解码成文件；SSH 文件系统后端目前还不能写这些字节。
5. 确认：`pnpm exec vitest run packages/fs/ packages/ssh/fs-ssh/ packages/document/doc-template/` 通过，且 `format: "docx", output_path: "out/report.docx"` 的 `render_doc_template` 产出文件后，`extractDocxText` 读取时不报 `not-a-zip`。
