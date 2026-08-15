# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

dsh 桌面表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-web-app`](../web-app/README.md) 之上：它为桌面 profile 复述 web 运行时配置，并插入本包提供的 `desktop-runtime` 粘合插件，后者占据桌面 shell 插件（`packages/desktop/*`）挂载的组合席位。桌面 profile（`dsh --profile desktop`）依次叠放 `dsh-base`、`dsh-web-app` 与本组合包。

## Model Experience

无，粘合插件只占据组合席位，不贡献模型可见文本；web 表层提示与 `DSH_WEB_URL` 运行时变量由 [`dsh-web-app`](../web-app/README.md) 负责，本组合包在其之上原样叠放。

#### KV Cache effect

无；本包既不组装也不发送任何 provider 请求。

## Known Limitations and Deferred Work

- **桌面 shell 服务尚未挂载** —— 菜单、托盘、对话框、全局快捷键、通知与文件拖放随 `packages/desktop/*` 插件一起落地；`desktop-runtime` 行是它们的组合席位。
