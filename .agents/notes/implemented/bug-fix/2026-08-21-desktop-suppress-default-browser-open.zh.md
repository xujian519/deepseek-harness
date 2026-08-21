# Agent Note: Desktop launch suppresses the web runtime's default-browser open

Status: implemented

[English](2026-08-21-desktop-suppress-default-browser-open.md) | 中文

## 问题

桌面壳（`apps/desktop`）以 `args: ['--port', '0']` 启动 `dsh --profile desktop` 后端，并把得到的 URL 加载进 Electron 窗口。web runtime 的 `openBrowser` 配置在本地启动时默认为 `true`，而桌面 profile 的 `web-runtime` 重述没有设置 `openBrowser: false`。desktop-app 补丁层重述整行 `web-runtime` 配置，因此丢掉该键会落到 schema 默认值，而不是继承 web 层的 `ctx.webStartup.openBrowser`。

结果是：每次桌面启动，后端都会在 Electron 窗口之外，又用系统默认浏览器打开同一个 `http://127.0.0.1:PORT` URL。一个界面被呈现两次，看起来就像应用启动时冗余地带起了一个 web 服务器。

## 决策

`apps/desktop/src/main.ts` 现在在后端 spawn 参数里传 `--no-open`（`['--port', '0', '--no-open']`）。Electron 窗口就是桌面的 UI 表层，因此 web runtime 的默认浏览器交接被抑制。`--no-open`（来自 web-startup 旗标族，`packages/bundle/web-app/cordis.patch.yml`）经由 `webStartup.openBrowser` 传播，把本次调用的浏览器打开关掉。

唯一的后端仍然服务 UI 并打印 `dsh web:` 就绪行（desktop profile 中保留了 `printUrl: true`），Electron main 仍然解析绑定后的 URL 来加载窗口；只有外部浏览器打开被去掉。

## 考虑过的替代方案

- **让桌面 profile 的 `web-runtime` 设置 `openBrowser: false`。** 更防御，但这是配置层改动，会把桌面 profile 锁死为永不打开浏览器；而命令行的 `--no-open` 正是 web 表层为这类非交互启动器场景预设的开关。壳拥有该启动，所以它传递启动器的旗标。
- **什么都不做。** 冗余会持续影响每位桌面用户。

## 后果

桌面启动只在 Electron 窗口打开 Web UI。后端行为、就绪信号与 `dsh web:` URL 行不变。web 表层的 `openBrowser` 默认值对 `dsh --profile web` 仍为 `true`，对该浏览器表层而言是正确的。

## 测试

桌面包测试（`apps/desktop/tests`）覆盖 `startDshBackend` 行为；spawn 参数是 `main.ts` 中调用方的决定，不由单元测试断言。
