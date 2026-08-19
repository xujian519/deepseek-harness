# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

dsh 桌面表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-web-app`](../web-app/README.md) 之上：它为桌面 profile 复述 web 运行时配置、插入本包提供的 `desktop-runtime` 粘合插件、挂载桌面 shell 服务（`@deepseek-ai/dsh-desktop-shell`），并把 web 运行时的目录选择器替换为 Electron 对话框 provider（`@deepseek-ai/dsh-desktop-directory-picker`）。桌面 profile（`dsh --profile desktop`）依次叠放 `dsh-base`、`dsh-web-app` 与本组合包。

## Model Experience

无，粘合插件只占据组合席位，不贡献模型可见文本；web 表层提示与 `DSH_WEB_URL` 运行时变量由 [`dsh-web-app`](../web-app/README.md) 负责，本组合包在其之上原样叠放。

#### KV Cache effect

无；本包既不组装也不发送任何 provider 请求。

## Known Limitations and Deferred Work

- **桌面桥接表层不完整** —— shell 服务（`ctx.desktop`）与 Electron 目录选择器已落地；Main 进程桥接方法中的菜单、托盘、全局快捷键与通知仍是 stub，推事件链（`desktop/menu-activated`、`desktop/tray-clicked` 等）尚无调用方。其余 `packages/desktop/*` 插件将填补这些席位。
