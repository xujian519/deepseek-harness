# browser/ — 浏览器自动化后端能力族

[English](README.md) | 中文

面向模型可见下载与抓取工具的浏览器自动化后端：级联抽象（ego lite → BrowserOS neo → browser-use → @playwright/mcp），含能力探测、冷决策路由，以及浏览器兜底路径的链接提取执行。自 Sati 浏览器后端层（`src/browser/backend/`）移植。

| 包 | 职责 |
|---|---|
| [`browser-backend/`](browser-backend/README.zh.md) | 后端类型/能力位、各后端探测、级联路由、browser-use 链接提取器。 |

各包契约由子 README 负责。
