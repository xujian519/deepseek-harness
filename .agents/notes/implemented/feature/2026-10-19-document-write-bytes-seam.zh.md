# Agent Note：文件系统缝上的字节写入路径，让渲染出的 DOCX 能落到磁盘

Status: implemented

[English](2026-10-19-document-write-bytes-seam.md) | 中文

## 问题

文档模式承诺 Word 产物，却产不出来。`render_doc_template` 渲染出 `.docx` 包后，把它 base64 编码放进结果 `content` 字段，但工具渲染出的文本只说该字段有多少个 base64 字符，而持久事件不保留工具结果的值。模型因此从未看到它本该保存的字节，`document-word` 却教它用 `base64 -d` 解码。这个包只存在于工具结果里、不存在于任何可写路径：通向 `.docx` 文件的唯一路线，是一条输入端模型读不到的 shell 命令。

文件系统缝本身也无法补救。`FileSystem` 只有 `writeText` 与 `editText`，都是 UTF-8；DOCX 包是 zip，持有字节的消费者没有可用的服务方法来发布它们。在工具内部直接用 `node:fs/promises` 写，会绕过进程内其他所有写入都走的 `fs/write-intent` 策略与 `fs-sandbox` 工作区围栏。

## 决定

**`FileSystem` 新增 `writeBytes`。** 它与 `writeText` 同构：同一个 `FsWriteIntent` 校验、同一条原子发布路径与同一种结果、同样可选的逐次 `SandboxExecutionPolicy`；`before`/`after` 留 `null`，因为二进制文档没有文本 diff 基。三个 provider 都实现：`fs-local` 与 `writeText` 共用加锁的写入路径，`fs-sandbox` 先围栏目标再委托，`fs-ssh` 通过 SFTP 写缓冲。继承该抽象类的测试替身同样实现。

**`render_doc_template` 成为消费者。** 工具新增可选 `output_path`：给了它，Markdown/HTML 渲染经 `writeText` 落盘、DOCX 渲染经 `writeBytes` 落盘，结果在原有内容之外回报路径与字节数；不给它，结果与今天完全一致。调用不传 `sandboxPolicy`，因此写入按部署默认策略执行——工作区围栏部署会拒绝根目录之外的路径，而不是悄悄放行。该限制写在包的 Known Limitations 里，而不是逐次协商。

**打包后果是公开的。** 第三方 `FileSystem` provider 必须实现这个新抽象方法，升级指南点名了它。`doc-template` 现在显式注入 `fs`，因此只挂模板工具、不挂文件系统的组合会在装载时报错，而不是在第一次渲染时才发现。

## 备选方案

**由 `doc-template` 直接用 `node:fs/promises` 写。** 否决：绕过写意图策略与沙箱围栏，并且会让模板包成为仓库里唯一不被任何 `fs` provider 观测的写入者。

**把写入挪进 `document_deliver`。** 10-13 交付门裁决已否决：登记工具核验的是已经存在的字节，把它改成写入者会与 `doc-template` 重复，且仍覆盖不到手写路径。

**让模型自己解 base64。** 否决：base64 不在模型上下文里（工具结果的值不进持久事件），命令没有输入；而且 shell 路线同样要先让字节可见。

## 后果

DOCX 现在端到端可达：带 `output_path` 渲染，随后 `document_deliver` 读取刚写出的文件，报 `checked` 而不是 `unreadable`。其他工具的二进制写入有了可调用的服务方法，不必再伸手去拿 `node:fs`。代价是每个 provider 多实现一个方法，模板包多一个注入依赖。

## 延期

`doc-template` 写入的逐次沙箱升级。工具不为调用解析策略，因此希望它在工作区外路径上申请升级的部署，需要 `tool-fs` 那套 `sandboxPolicy` 协商。当前没有消费者需要它。
