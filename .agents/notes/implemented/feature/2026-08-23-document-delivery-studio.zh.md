# Agent Note：文档交付工作室

Status: implemented

[English](2026-08-23-document-delivery-studio.md) | 中文

## 问题

文档智能体工作线（P1 已落地 `document` agent preset）需要交付界面：当会话运行文档智能体时，中心列应显示专属的交付工作室——会话已交付文件、HTML/文本预览、打开 / 在文件夹中显示 / 打印动作——而非普通聊天。前端是承载 Web UI 的现有桌面 App。

## 决策

**工作室是一个会话视图，经控制器切换。** `'conversation.view'` 环形槽（id `document`，order 20）是平台的增量视图面，因此工作室只是一个新标签，现有标签环免费提供手动切换。编程式自动跳转此前没有受认可的跨包通道——按设计，per-session chat store 句柄仅限 apply 局部，且对等视图只含内容。缺口以最小服务扩展补齐：`ctx.conversation.setActiveView(sessionId, view)`。会话主体把 store 支持的 setter 注册到控制器；该方法返回 setter 是否已挂载，以便调用方跨会话 seat 竞态重试。这是唯一不导出 store 句柄的通道（插槽组合标准：[2026-07-22-slot-type-chain-implementation](../architecture/2026-07-22-slot-type-chain-implementation.zh.md)）。

**工作室自持产物词汇。** `ui-deliverables` 经其私有 module augmentation 在自有 `deliverables` turn 数据键下发布逐轮产物——不导出则无法跨包访问，而导出被客户端导出纪律禁止。因此工作室自持一个并行的 turn 级定义（`documentDeliverables`），使用同一 `locations` 词汇，外加一个会话级视图目标，把窗口内所有 turn 折叠为一份按首次出现排序的去重列表。无论是否组合 `ui-deliverables`，工作室都能工作。

**预览字节来自新增的有界宿主 RPC。** 浏览器无法读取工作区文件；`host.readFileText` 加入 `HostApi`，作为有上限的 UTF-8 读取（调用方预算、绝对 4 MiB 上限、严格解码、`file-unreadable`/`cancelled` 错误），镜像 `openPath` 的信任模型。客户端 `api.host.readFileText` 随 RpcMethodMap 自动生效。

## 备选方案

- **视图环之外的中心列接管**——替换 `conversation` 槽会与常驻壳冲突，并重复承担该 seat 拥有的草稿镜像与视图环职责；因对抗插槽系统而否决。
- **为对等插件导出 chat store 句柄**——store 契约禁止模块级句柄（跨插件重载的伪单例）；以控制器通道替代。
- **跨包读取 `ui-deliverables` 的 turn 数据**——其私有增强不导出类型则不可达；以并行词汇替代。

## 后果

- 本迭代 PDF 导出走浏览器打印（"另存为 PDF"对话框）；静默 `webContents.printToPDF` 是 P3 桌面桥后续。
- HTML 预览为沙箱（`sandbox=""`，不执行脚本）：预览而非执行；交互式工件只显示首帧。
- 工作室的自动跳转仅在进入会话时触发；手动切回聊天标签后，离开并重新进入会话前不会被覆盖。
- 覆盖率：`packages/client/ui-document-studio/src/*` 加入客户端车道覆盖率豁免（jsdom 车道无法把 eval 后的 bundle 产物映射回 src），与 ui-trajectory 一致；该包以 21 个 jsdom 与真实注册表 spec 替代。
