# Agent Note: 桌面发布品牌参数

Status: implemented

[English](2026-09-09-desktop-release-branding-parameters.md) | 中文

## 问题

桌面壳把 `DeepSeek Harness` 产品名写死在源码中，且不带应用图标，部署方无法在不改源码的前提下以其他产品身份打包同一个壳。应用 ID 此前已是环境参数。

## 决策

`DSH_DESKTOP_PRODUCT_NAME` 为安装包指定品牌名称，缺省 `DeepSeek Harness`；超过 64 字符、包含控制字符或路径分隔符的值会让打包失败。`DSH_DESKTOP_ICON_DIR` 指向包含 `icon.icns` 与 `icon.ico` 的目录；设置后各平台目标要求各自的文件，缺失即打包失败，未设置时发布保留 Electron 默认图标。更新产物名称保持固定的 `deepseek-harness-` 模板，因为品牌名可能包含空格，而更新元数据与上传路径都以该稳定模板为准。仓库 `apps/desktop/assets/` 下的资产承载应用与托盘图标集；icon 文件是通过环境变量选择的打包输入，托盘图标是壳侧托盘 UI 的运行时资产。

## 已否决的替代方案

**由产品名派生产物名称。** 为纯外观收益，把空格与改名波动推进更新元数据和存储路径。

**硬编码第二个应用目标。** 第二个目标会复制整条发布流水线；环境参数让一个壳以任意身份打包。

## 后果

品牌化发布在签名输入之外设置三个环境变量（`DSH_DESKTOP_APP_ID`、`DSH_DESKTOP_PRODUCT_NAME`、`DSH_DESKTOP_ICON_DIR`）。环境解析测试覆盖缺省、合法值与拒绝路径；不打签名凭据的 `:dir` 打包可验证名称与图标落位。
