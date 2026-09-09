# Agent Note: 桌面桥接 seam 与 seam 包改名

Status: implemented

[English](2026-09-09-desktop-bridge-seam.md) | 中文

## 问题

桌面组合要从后端插件触达壳侧的 OS 能力——对话框、通知、应用菜单项、全局快捷键与托盘定制——而 desktop-patent 壳已经验证过一套 JSON-RPC 桥设计。把该桥收敛进官方壳时遇到阻断：`ctx.desktop` 的 Service Definition 包名为 `@deepseek-ai/dsh-desktop`，与上游 v0.1.5 官方 Electron 壳的名字完全相同，工作区解析把壳的 `main.js` 交给了后端，其中的 Electron 导入直接炸掉 host 进程。

## 决策

Service Definition 包改名 `@deepseek-ai/dsh-desktop-seam`；官方壳保留 `@deepseek-ai/dsh-desktop`。桥服务器运行在 Electron Main，持有 OS 临时目录下按 pid 命名的 Unix socket（或 Windows 命名管道）——仓库内的 userData 深路径在开发态会超过 Unix socket 约 104 字节的路径上限，死进程残留的 socket 在启动时清理。host 子进程只在启动时通过其经过净化之外加注一条 `DSH_DESKTOP_BRIDGE_PATH` 的环境拿到路径。socket 只接受一条后端连接：第二条立即关闭，这让 host 重启与客户端的断线重连重放天然安全。桥不做鉴权：对端是壳自己的子进程，单连接规则就是边界。托盘实例归壳所有——桥只接收实例做 tooltip、上下文菜单与点击通知的定制。后端注册的菜单组在壳提供的基础应用菜单模板之后重建。桌面组合经 host overlay 增加 `desktop-shell` 行；Electron 对话框版目录选择不进缺省组合，保持原生选择器。

## 已否决的替代方案

**用生命周期 IPC 或分帧字节管道承载桥流量。** 两条通道各自有版本与专用用途（子进程生命周期、Fetch 传输）；把 OS 控制流量混入会耦合无关协议并扩大管道信任面。

**让桥自建托盘。** 两个托盘实例会争抢状态项；壳必须在后端连接之前显示托盘，所以所有权归壳，桥接收实例。

**保留 Service Definition 旧名、改官方壳的名字。** 上游的名字归官方壳所有；每次同步都会与改名冲突。

## 后果

后端插件调用 `ctx.desktop` 方法并接收 `desktop/*` 事件；缺失桥路径时降级为仅告警，headless 组合仍可启动。seam 改名对跟随该包的消费者源码兼容，channel 测试与桥测试套件覆盖聚合表、方法允许清单、托盘移交与菜单基线。
