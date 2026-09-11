# 桌面端 UI / 组件审阅报告

**审阅对象**：DeepSeek Harness 桌面端（Electron 壳 + `packages/client/*` 浏览器半侧）
**审阅日期**：2026-09-11
**审阅人**：UI Designer（像素君）

---

## 0. 范围与方法

| 项 | 数值 |
|---|---|
| UI 功能包 | `packages/client/` 下 49 个（`ui-*` + `better-sidebar` + `ui-dockkit`） |
| CSS Modules | 142 个 `.module.css`，27,740 行 |
| TSX（含测试） | 119,511 行 |
| 基础原子组件 | `ui-primitives` 60+ 个 |
| 设计 token 源 | `ui-theme/src/styles/design-platform.css`（340 行）、`gradient-shadow-text.css`、`base.css` |
| 桌面壳 | `apps/desktop/`（Electron 33 个源文件） |

方法：按 **token 层 → 原子组件层 → 组合组件层 → 框架层 → 桌面壳层** 五层，交叉 **视觉一致性 / 可访问性 / 交互模式 / 信息架构** 四个维度取证。所有结论均带 `文件:行号`，数字由脚本实测得出。

---

## 1. 总体判断

**一句话结论：这是一个"配色系统做完、其余四个维度没做完"的设计系统。**

项目的 token 三层架构（`--dsw-static-*` 原始色板 → `--dsw-alias-*` 语义色 → `--dsw-specific-*` 业务色）设计水平相当高，深浅双主题完整对位，颜色采用率也真实到位。但排版、间距、圆角、层级、动效这五类维度**要么没有 token，要么采用率不足 1%**。实测：

| 维度 | 已有 token | 声明总数 | 走 token | **采用率** |
|---|---|---|---|---|
| 颜色 | 三层 token 体系 | — | 绝大多数 | **~85%**（61 处硬编码） |
| font-size | 8 档阶梯（11/12/13/14/16/20/24） | 451 | 4 | **0.9%** |
| 过渡时长 | `--ds-transition-duration*` | 119 | 6 | **5%** |
| border-radius | **无 token** | 23 个取值 | 0 | **0%** |
| spacing | **无 token** | 1366 个 px 值 | 0 | **0%** |
| z-index | **无 token** | 28 个魔数 | 0 | **0%** |

注意最后一列的形状：**颜色维度的 token 化是真实落地的，另外五个维度是空的。** 这不是"没做设计系统"，而是"设计系统只做了一半，且没有闸门阻止它退化"。下文 13 项 P0/P1 问题，全部是这一句话的具体表现。

### 值得肯定的地方（不是客套，是这份报告的前提）

1. **三层 token 命名有纪律**：`static` 是色板、`alias` 是语义、`specific` 是业务，层级清晰，深色主题逐条对位（`design-platform.css:157-340`），没有出现"深色主题漏配某个 token"的情况。
2. **原子组件层克制且干净**：`Button` / `Input` / `Menu` / `Tooltip` / `Modal` / `Switch` / `Tag` / `Pill` 全部只吃 `var()`，无框架依赖、无 ctx 泄漏。`Button.tsx` 四个 variant 精确映射 `--dsw-alias-button-*` 家族；`Button.module.css:6-9` 还标注了几何来自 Figma 节点与实例数——这是可审计的组件。
3. **`Tag` 与 `Pill` 的边界是一次教科书式的设计决策**：`Tag.tsx:1-2` 和 `Pill.tsx:1-5` 的注释明确写出"只读徽标是 Tag（11px），可选胶囊是 Pill（24px 行高），尺寸区分与交互性同等重要"，并说明 `Pill` 传 `onClick` 才渲染 `<button>`。**没有把两者合并成一个带 6 个 boolean 的巨型组件**，这恰恰是很多团队会犯的错。
4. **布局求解是纯函数 + 显式常量**：`ui-layout/src/client/columns.ts:11-29` 把 `CENTER_MIN=400`、`SIDEBAR_MIN/MAX/DEFAULT`、`SIDEBAR_AUTO_COLLAPSE=1024`、`RIGHTBAR_MAX_RATIO=0.7` 全部命名化并可单测；`AppFrame.tsx` 的拖拽用 pointer capture + rAF 节流，且**拖拽时主动关闭过渡**（`AppFrame.module.css:14-17`，注释解释了"缓动会让列边界脱离指针"）——这是踩过坑才有的实现。
5. **a11y 基础不薄**：`aria-*` 共 1221 处；345 个 `<button>` 中，**纯图标按钮缺 `aria-label` 的数量为 0**；`Modal.tsx:56-59` 有 `role="dialog"` + `aria-modal` + `aria-label` + Esc 关闭。

所以：**骨架是好的，问题出在最后一公里。**

---

## 2. P0 问题（直接影响可用性，建议当次迭代修完）

### P0-1　三个文字 token 不达 WCAG AA，`label-dimmed` 几乎不可见

`design-platform.css` 中文字色 token 的实测对比度（已独立复算，非估算）：

| token | 浅色值 | 浅色对比度 | 深色值 | 深色对比度(base) | 深色对比度(layer-1) | 判定 |
|---|---|---|---|---|---|---|
| `label-dimmed` | `neutral-bluish-200` rgb(225,229,238) | **1.26:1** | `neutral-bluish-750` rgb(67,69,74) | **1.90:1** | **1.64:1** | ❌ 严重 |
| `label-caption` | `neutral-bluish-400` rgb(173,178,184) | **2.14:1** | `neutral-bluish-600` rgb(129,133,140) | 4.92:1 | **4.24:1** | ❌ |
| `label-tertiary` | `neutral-bluish-600` rgb(129,133,140) | **3.70:1** | `neutral-bluish-400` rgb(173,178,184) | 8.54:1 | 7.36:1 | ❌ 浅色 |
| `label-secondary` | `neutral-bluish-700` rgb(97,102,107) | 5.80:1 | `neutral-bluish-300` rgb(207,211,214) | 12.11:1 | 10.42:1 | ✅ |

行号：`design-platform.css:201,202,208,209`（浅色）/ `:294,295,301,302`（深色）。

**影响面不是边角料**：`label-tertiary` 用了 **330 次**、`label-secondary` 236 次、`label-caption` **69 次**、`label-dimmed` 25 次。也就是说浅色主题下**所有元数据、时间戳、计数、辅助说明**都低于 4.5:1。这对需要长时间阅读长文档的专利律师是直接的阅读负担。

`label-dimmed` 1.26:1 意味着白底上的浅灰文字**基本不可辨认**，无论它设计意图多"次要"。

**修复建议**（新增一档并重定义语义）：

```css
/* 新增一档：在 bluish-600(3.70:1) 与 bluish-700(5.80:1) 之间补 4.5:1 及格位 */
body { --dsw-static-neutral-bluish-650: rgb(112, 117, 123); } /* 白底 4.65:1 */
body {
  --dsw-alias-label-tertiary: var(--dsw-static-neutral-bluish-650);  /* 330 处受益 */
  --dsw-alias-label-caption:  var(--dsw-static-neutral-bluish-650);  /* 69 处受益 */
  /* label-dimmed 降级为"非文本专用"（图标、禁用态边框），从文档文字场景移除 */
}
body[data-ds-dark-theme] {
  --dsw-alias-label-caption: var(--dsw-static-neutral-bluish-500);   /* layer-1 上 5.75:1 */
  --dsw-alias-label-dimmed:  var(--dsw-static-neutral-bluish-700);   /* 非文本 3.15:1 */
}
```

### P0-2　强调色三分裂：同一个"品牌蓝"有三个值、三套 token

| 用途 | token | 浅色实际值 | 引用次数 |
|---|---|---|---|
| 业务强调色 | `--dsw-alias-state-business-primary` | `deepseek-500` rgb(65,118,230) | **105** |
| "新"强调色 | `--dsw-alias-brand-primary-new-colorprimary-new-color` | rgb(65,118,230) 硬写 | **15**（只在 `ui-trajectory`、`ui-dockkit`） |
| 主按钮填充 | `--dsw-alias-button-primary-fill` → `--dsw-alias-brand-primary` | `neutral-bluish-1000` **rgb(15,17,21) 近黑** | 全部 CTA |

三件事同时成立：

1. **主按钮是黑的，不是品牌蓝的。** `design-platform.css:179` 把 `--dsw-alias-brand-primary` 指向 `neutral-bluish-1000`（近黑），于是 `--dsw-alias-button-primary-fill`（`:191`）也是黑的。整个产品最重要的 CTA 与品牌色无关。
2. **有一个专门的品牌蓝 token 躺在那里没人用。** `--dsw-alias-brand-primary-new-colorprimary-new-color`（`:178`）只在 `ui-trajectory` 和 `ui-dockkit` 两个"新模块"里被引用 15 次，其余 47 个包一律使用 `state-business-primary` 的另一个蓝。
3. **token 名本身是生成器残留。** `brand-primary-new-colorprimary-new-color` 是 "new-color + primary-new-color" 两层前缀拼接失误的产物。一个设计 token 的名字读不出语义，说明它是被机器塞进来的，而不是被设计过的。

结果：`ui-trajectory` 里的选中态蓝，和 `ui-chat` 里的运行态蓝，**在同一个屏幕上不是一个蓝**。

**修复建议**：确定唯一的品牌强调色（建议 `deepseek-500`），将 `--dsw-alias-brand-primary` 指回它；主按钮使用 `--dsw-alias-brand-primary`；把 `...-new-colorprimary-new-color` 重命名为 `--dsw-alias-brand-accent`，并在一个版本内把 15 处引用迁移过去后删除旧名。

### P0-3　基础组件层既无统一焦点环，也无 hover 过渡

**焦点环**：全客户端 CSS 中**没有任何一条全局 `:focus` / `:focus-visible` 规则**（已全仓 grep 确认）。`ui-primitives` 的 `Button` / `Input` / `Menu` / `Tooltip` / `Modal` / `Tag` / `Pill` / `DisclosureRow` 的 `:focus-visible` 计数**全部为 0**。

需要准确表述其后果：这不是"焦点不可见"——浏览器 UA 默认焦点环仍在。问题是**设计系统在最该定义焦点语言的层级缺席**，于是：
- 键盘用户看到的是 Chromium 默认浅蓝描边，与产品设计语言无关；
- 而全仓有 **48 处 `outline:none`**，其中 **10 个文件没有任何 `:focus-visible` 替代**——一旦某个消费方顺手写了 `outline:none`，焦点就真的消失了。典型危险点：`ui-commands/src/client/PopupSelectView.module.css:93` 的 listbox 选项（列表项丢焦点环，键盘用户完全失去位置感）、`ui-primitives/src/JsonTree.module.css:210-212`（`.expander:focus-visible { outline: none }`——**主动把聚焦态抹掉**）。

**过渡**：`Button.module.css` 的 `transition` 计数为 **0**。主按钮 hover 是**瞬时跳变**，没有过渡。这与"macOS 典雅、细腻"的目标定位直接冲突。全仓 119 处 transition 中，只有 6 处使用已定义好的 `--ds-transition-duration*`（`base.css:11-14`），51 处硬编码 `ms`、21 处硬编码 `s`（**单位混用**）。

**修复建议**（放进 `ui-theme` 的基础层，一次修完全站）：

```css
/* 统一焦点语言：一处定义，全站生效 */
:where(a, button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
/* 统一动效节奏，并收敛单位到 ms */
:root {
  --dsw-duration-fast: 120ms;
  --dsw-duration-base: 180ms;
  --dsw-duration-slow: 300ms;
  --dsw-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
}
/* 原子组件补上过渡 */
.button { transition: background-color var(--dsw-duration-fast) var(--dsw-ease-standard); }
.button.primary:active:not(:disabled) { background: var(--dsw-alias-button-primary-fill); }
```

另：`Button` 的 `primary` variant 目前**只有 hover、没有 active 反馈**（`ghost` 有）。按下无回弹，手感偏"软"。

### P0-4　三栏布局不持久化，重启即丢

`ui-layout/src/client/stores.ts:76-130` 的 `createLayoutStore()` **没有 `persist`**。对比同一仓库里其他 store：

- `ui-conversation/src/client/stores.ts:23` → `persist: CONVERSATION_STORE_KEY` ✅
- `better-sidebar/src/client/state.ts:4` → `dsh-sidebar:v1:<id>` ✅
- `ui-layout/src/client/stores.ts` → 无 ❌

后果：用户拖好的侧栏宽度、右栏开关状态、面板选择，**关窗口就归零**。对一个"通常配 2-3 块屏幕分屏工作"的专利律师用户，三栏布局就是工作台本身，每次重启重摆一次是不可接受的。

而且 `stores.ts:36-40` 的注释本身写着"closing it forgets its drag width"——这是**被当成特性写进注释的行为**，说明是遗漏而非权衡。

**修复建议**：给 `createLayoutStore` 加 `persist: 'dsh.layout.v1'`，落盘 `sidebar` / `rightbar` / `rightbarShown` / `rightbarTrack` / `narrowExpanded`。注意 `ui-layout/AGENTS.md` 约定 store 只承载"共享查看状态"，布局宽度正是这一类，不违反分层红线。

### P0-5　桌面壳没接上视觉目标，已写好的契约成了死代码

`apps/desktop/src/main.ts:90-104`：

```ts
const window = new BrowserWindow({
  width: 1280, height: 840, minWidth: 880, minHeight: 600, show: false,
  webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
})
```

**没有 `titleBarStyle`、没有 `frame: false`、没有 `transparent`、没有 `vibrancy` / `backgroundMaterial`**（已全文件 grep 确认零匹配）。窗口是系统原生标题栏。

三件事叠在一起让这个缺口更刺眼：

1. 前端**已经写好了** Windows Control Overlay 与标题栏条带契约——`better-sidebar/src/client/wco.ts`、`better-sidebar/src/client/titlebar-strip.ts`——但壳层没开无边框，**这套代码永远走不到**。
2. 目标定位是"macOS 典雅 + 毛玻璃"，而全客户端 `backdrop-filter` **只有 9 处**，其中 4 处还是 `blur(2px)` 的模态遮罩（`Modal.module.css:18`、`OnboardingSurface.module.css:18`、`SettingsRoot.module.css:74`、`sidebar.module.css:1168` 都是 `var(--dsw-mask-blur)` = `blur(2px)`，`gradient-shadow-text.css:19`）。最轻的模糊只有 2px，视觉上几乎不可感知 → **"毛玻璃"目前只存在于设计意图里，不存在于产品里**。
3. 主界面是**实色分层**：`sidebar.module.css:147` 就是 `background: var(--dsw-alias-bg-layer-1)` 纯色。

**修复建议**：
- macOS：`titleBarStyle: 'hiddenInset'`；Windows：`titleBarOverlay`。让 `wco.ts` / `titlebar-strip.ts` 真正生效。
- 侧栏与浮层引入真实景深：`--dsw-mask-blur` 从 `blur(2px)` 提到 `blur(20px) saturate(180%)`，并把侧栏/头部改为半透明 + `backdrop-filter`，让三栏产生层次而非三块同色平面。

### P0-6　`Modal` 没有焦点陷阱、没有焦点归还

`ui-primitives/src/Modal.tsx:41-48` 的焦点相关逻辑全部内容：

```ts
useEffect(() => {
  if (!open) return
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
  document.addEventListener('keydown', onKeyDown)
  return () => { document.removeEventListener('keydown', onKeyDown) }
}, [open, onClose])
```

`role="dialog"` + `aria-modal="true"` 都有（`:56-59`），但：
- **无焦点陷阱**：没有 `focusin` 拦截、没有 Tab 循环。`aria-modal="true"` 会告诉屏幕阅读器"外面不可达"，但**键盘仍可 Tab 到背景内容**，声明与行为不一致——这比不写 `aria-modal` 更糟。
- **无初始聚焦**：打开后焦点仍在触发按钮上。
- **无焦点归还**：关闭后焦点丢失到 `<body>`。

`ui-directory-picker-browse/src/client/DirectoryBrowser.tsx:389` 的注释自认了这一事实（"Modal has no focus trap"）。同类还有 `ui-attachment/src/ImageLightbox.tsx:52-53`，以及若干只写 `role="dialog"` 却漏 `aria-modal` 的面板（`ui-conversation/.../ContextMeter.tsx:131`、`ui-chat/.../TurnUsagePanel.tsx:71,150`）。

**修复建议**：在 `Modal` 里补齐标准三段式——打开时记录 `document.activeElement` 并聚焦卡片内首个可聚焦元素；`keydown` 里拦截 Tab 做首尾循环；关闭时 `previous.focus()`。`aria-modal="true"` 必须与焦点陷阱同时存在，二者不可拆。

---

## 3. P1 问题（设计系统欠账，建议一个专项迭代清完）

### P1-1　圆角 23 个取值，无阶梯、无 token

全仓 23 种不同 `border-radius` 值。高频：`8px`(66) / `6px`(63) / `999px`(38) / `12px`(36) / `50%`(36) / `4px`(27) / `10px`(20) / `16px`(18) / `20px`(15) / `18px`(13)。主题里**只有 `--dsw-corner-shape`，没有 radius token**。

8/6/999/12/50% 已占 66%，说明节奏是存在的，只是从未被命名。建议收敛为 5 档：

```css
:root {
  --dsw-radius-xs: 4px; --dsw-radius-sm: 6px; --dsw-radius-md: 8px;
  --dsw-radius-lg: 12px; --dsw-radius-xl: 16px; --dsw-radius-pill: 999px;
}
```

（`Button` 的 18px/14px 胶囊半径建议保留为组件几何，不纳入阶梯——`Button.module.css:1-4` 已注明来自 Figma 节点，属于组件自有属性。）

### P1-2　间距无 token，8px 节奏被 2px 微调污染

1366 个 px 值中 4 的倍数只占 **54%**。频次：`4px`(213) / `6px`(189) / `8px`(265) / `10px`(106) / `12px`(134) / `14px`(45) / `16px`(65)，另有 `2px`(103)、`1px`(25)、`3px`(32)、`5px`(37)、`7px`(18)、`9px`(8)、`11px`(5)。

8px 塔尖是清楚的，但 **6/10/14px 共 340 次** 与 `1/3/5/7px` 共 112 次穿插其间，形成第二套隐性节奏（2px 网格）。两套网格并存会让界面的"呼吸感"不稳定——这正是"看起来都对，就是不够整"的根源。

建议：落 `--dsw-space-1..8`（4/8/12/16/24/32/48/64），并约定 **1px 只用于 hairline 边框、2px 只用于图标光学对齐**，其余一律归位。

### P1-3　字号阶梯只有 0.9% 采用率，且存在 36 处野生字号 + 1 处命名错误

阶梯本身是完整的，定义在 `gradient-shadow-text.css:179-256`：

| token | 值 |
|---|---|
| `--dsw-font-xxxs-11` | 11px/14px |
| `--dsw-font-xxs-12` | 12px/18px |
| `--dsw-font-xs-13` | 13px/20px |
| `--dsw-font-s-14` | 14px/22px |
| `--dsw-font-base-16` | 16px/24px |
| `--dsw-font-m-18` | **500 16px/28px** ⚠️ |
| `--dsw-font-l-20` | 500 20px/28px |
| `--dsw-font-xl-24` | 600 24px/32px |

两个问题：

1. **451 个 `font-size` 声明里只有 4 个走 token，447 个写死 px。** 阶梯形同装饰。
2. **`--dsw-font-m-18` 的名字是 18，值是 16px**（`:193`）。而 `--dsw-font-base-16` 也是 16px/24px，两者字号相同、行高不同（28 vs 24）。命名与值不符，消费方无法从名字判断该用哪个。建议改名为 `--dsw-font-base-16-relaxed` 之类，或修正为 18px。
3. 野生字号 36 处：`6px`(1)、`9.5px`(1)、`10px`(8)、`10.5px`(3)、`11.5px`(3)、`12.5px`(6)、`15px`(6)、`17px`(3)、`18px`(4)、`26px`(1)。例：`ui-patent-teams/.../TeamsDashboard.module.css:618` 用 9.5px、`:46` 用 11.5px；`ui-agent-preset/.../AgentPresetSection.module.css:177` 用 15px。

字体栈本身有讲究（`base.css:7-10` 为 Windows CJK 显式排除裸 `monospace` 回退），说明团队关注过排版细节——那么字号阶梯的 0.9% 采用率更应被视为**遗漏而非取舍**。

### P1-4　z-index 28 个魔数，相邻包互相抢层级

散落 0–1100。高频：`1`(24) / `2`(10) / `100`(9) / `3`(7) / `4`(6) / `10`(5) / `1000`(5) / `1100`(5)。

典型"抢层级"：`better-sidebar/src/client/sidebar.module.css` 里 `:923` 是 **1001**、`:975` 是 **1002**、`:1686` 是 **1000**——同一个文件里三个相邻浮层用连续魔数互压；`ui-chat/.../stat-dialog.module.css:6` 又是 **1100**。`ui-layout/.../AppFrame.module.css:45` 用 11（手柄）、`:79` 用 20（overlay）。

建议落 6 档并禁止新增：

```css
:root {
  --dsw-z-base: 0;   --dsw-z-sticky: 10;  --dsw-z-dropdown: 100;
  --dsw-z-overlay: 1000; --dsw-z-modal: 1100; --dsw-z-toast: 1200;
}
```

### P1-5　阴影有三套并行命名

65 处 `box-shadow` 中 61 处已走 `var()`（94%，这点做得好），但 token 命名**三套并存**：`--dsw-elevation-prominent/panel/soft`、`--dsw-shadow-lv1/2/3`，以及直接用 `var(--dsw-alias-border-*)` 拼描边环。合计 37 种不同定义。

`HoverCard.module.css:13` 注释引用的是 `--dsw-shadow-lv3`，`AppFrame` 风格走 `elevation-*`，两套命名描述同一件事。需要一次归一化，建议保留 `--dsw-elevation-*`（语义更明确）并给出 `0/1/2/3` 四档。

### P1-6　硬编码颜色 61 处，其中 2 处跨主题语义冲突

分布：`ui-primitives` 23、`web` 14、`ui-dockkit` 6、`ui-chat` 4、`ui-conversation` 4、`ui-workspace` 4、其余零散。

要区分两类：

- **可豁免**：`mask` 渐变里的 `black/transparent/#000`（技术必需）、以及自带浅/深两套值的文件（`web/src/boot-page.module.css:4-23`、`ui-primitives/src/JsonTree.module.css:2-8`）。
- **应修**：`ui-primitives/src/HoverCard.module.css:14` 定义 `--dsw-hovercard-bg: #2C2C2E` + `:37` `color: #FFFFFF`。注释写着"figma 值，浅深一致"——但**浅色主题下浮层是深色底**，与"浮层用最浅层 `bg-layer-3`"的语义体系冲突；且这是全仓唯一的组件级颜色变量，绕过了 token 体系。`ui-workspace/.../Rows.module.css:311-334` 硬编码 `#FFFFFF/#CFD3D6/#ADB2B8`，只因上层底色也是硬编码才成立——一旦底色 token 化就会失效。

### P1-7　浮层列表 4 套并行实现，键盘行为不一致

| 文件 | 行数 | `role=` | Esc 处理 |
|---|---|---|---|
| `ui-primitives/src/Menu.tsx` | 325 | 8 | ✅（`:183`，且 `:187-193` 有 ArrowUp/Down/Home/End） |
| `ui-model-selection/src/client/ModelSelect.tsx` | 418 | 6 | ✅ |
| `ui-commands/src/client/PopupSelectView.tsx` | 177 | 3 | ✅ |
| `ui-input-trigger/src/client/MenuView.tsx` | 189 | 6 | ❌ **无 Escape 处理** |

定位逻辑**有一部分是共享的**（`useAnchoredMaxHeight` 被 `PopupSelectView`、`MenuView` 复用；`useAnchoredPosition` 被 `ui-schedule` 复用），这点要给分。但 `ModelSelect.tsx:130` 带着这个注释：

```
/* jscpd:ignore-start -- deliberate mirror of ui-primitives useAnchoredPosition:
```

也就是说：定位逻辑被**刻意复制**了一份，并且用注释**压制了 `pnpm run duplication` 的克隆告警**。键盘导航与 role 维护则完全由四个文件各自实现，于是 `MenuView.tsx` 漏了 Escape。

建议：抽一个 `ui-primitives` 的 `<ListboxSurface>`（定位 + roving tabindex + Esc + outside-pointer 四件事合一），四个消费方降级为纯渲染。这同时能修掉 P0-3 里 `PopupSelectView` 列表项无焦点环的问题（因为焦点环会在共享层定义一次）。

---

## 4. P2 问题（可访问性与交互细节）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| P2-1 | 生产代码**无 `<main>` landmark、无 `<h1>`** | 全量扫描：`<main>` 生产 0 处（6 处全在测试）；`h2`×8/`h3`×8/`h4`×5，`h1`=0 | 屏幕阅读器无法跳转到主区域、无文档标题层级 |
| P2-2 | 9 处 `<div/span onClick>` 无 `role`/`tabIndex`，键盘完全不可达 | `better-sidebar/src/client/mermaid.tsx:297`、`ui-primitives/src/JsonTree.tsx:217`、`better-sidebar/src/client/TabBar.tsx:181`、`ui-trajectory/.../TrajectoryTable.tsx:2307`、`ui-dockkit/.../TabPanel.tsx:400`、`ui-workspace/.../WorkspaceBrowser.tsx:1133`、`ui-conversation/.../InputBar.tsx:426` | 标签页、树节点、搜索框无法用键盘激活 |
| P2-3 | 10 个 CSS 文件 `outline:none` 且无 `:focus-visible` 替代 | `PopupSelectView.module.css:93`、`WorkspaceBrowser.module.css:200,464`、`InputBar.module.css:178,320`、`Input.module.css:29`、`JsonTree.module.css:210-212` 等 | 与 P0-3 同源，修 P0-3 可一并解决 |
| P2-4 | 7 个无限循环动画无 `prefers-reduced-motion` 护栏 | `ui-tool/.../ToolRow.module.css:36`（2.6s sweep）、`ui-conversation/.../TodoPanel.module.css:126`（1s spin）、`ui-input-trigger/.../MenuView.module.css:179`（2s） | 前庭不适风险；全仓 44 个 `@keyframes`、26 处 `infinite`，已有 33 个文件加了护栏，这 7 个是漏网 |
| P2-5 | 无 Cmd+K 命令面板 | `apps/desktop/src/main.ts:366` 是唯一 accelerator（`CmdOrCtrl+,`） | 桌面端标配缺失；切会话/切模型/开关面板全靠鼠标 |
| P2-6 | 工具调用与推理**默认全折叠** | `ui-tool/.../ToolRow.tsx:137` `useState(false)` | 流式执行过程中用户"看不见发生了什么"，长任务体感差 |
| P2-7 | 无流式光标、无逐消息 skeleton | 全仓无打字光标；running 只靠扫光带 | 输出停顿与卡死无法区分 |
| P2-8 | 空状态无任何引导 | `ui-conversation/.../EmptyHero.tsx:132-165`：只有鲸鱼 + 标题 + 版本徽标 + 工作区 chip，全仓无示例提示文案 | 新用户第一屏不知道能做什么 |
| P2-9 | 插件管理器页面与设计系统完全脱节 | `apps/desktop/renderer/plugin-manager.css:1-6,55,65` 使用 `Canvas` / `CanvasText` / `ButtonBorder` / `AccentColor` 系统原始色 | 这是桌面壳唯一自有 UI 面，却零 token |

**P2-6 值得单独说**：`ToolRow` 默认折叠本身是合理的密度决策，但对"过程即价值"的 Agent 产品，建议改为 **running 时默认展开、结束后自动折叠**——让过程可见，让结果清爽。这是一行状态逻辑的改动，收益很大。

---

## 5. 组件 API 层的观察

除 P1-7（浮层列表重复）外，原子组件 API 总体干净，但有几处可以更省心：

| 组件 | 观察 | 建议 |
|---|---|---|
| `Button` | 只有 `variant` × `size` × `icon`，无 `loading` 态；无 icon-only 的正式变体（消费方自己设几何） | 补 `loading?: boolean`（自动 `aria-busy` + 禁用 + 转圈），避免每个调用点各写一遍 |
| `Button` | `primary` 无 `:active` 反馈 | 补 active 态 |
| `Button` | 无统一 `transition` | 见 P0-3 |
| `Pill` | `onClick` 存在与否决定渲染 `<button>` 还是 `<span>`，设计巧妙 | 保持。但需补 `:focus-visible`（当前 0 处） |
| `Modal` | `headless` 模式允许绕开默认 chrome | 保持。但焦点三段式必须在共享层实现，不能交给消费方 |
| `HoverCard` | 唯一使用组件级颜色变量的组件 | 纳入 token（P1-6） |

---

## 6. 修复路线图

### 阶段一：止血（建议 1 周，只碰 token 层与两个原子组件）

| 任务 | 改动面 | 收益 |
|---|---|---|
| 对比度修正 + 新增 `bluish-650` | `design-platform.css` 一个文件 | 浅色主题 424 处文字达标（P0-1） |
| 统一品牌强调色，重命名坏 token | `design-platform.css` + 15 处引用 | 全站强调色一致（P0-2） |
| 全局 `:focus-visible` + 原子组件补 `transition`/`active` | `ui-theme` 基础层 + `ui-primitives` 8 个文件 | 键盘可用性 + hover 质感（P0-3、P2-3） |
| `Modal` 焦点陷阱三段式 | `ui-primitives/src/Modal.tsx` | `aria-modal` 不再撒谎（P0-6） |
| `createLayoutStore` 加 `persist` | `ui-layout/src/client/stores.ts` | 三栏布局持久化（P0-4） |

阶段一之后，**P0 全清，且改动集中在 10 个文件以内**——这正是 token 体系该发挥的杠杆。

### 阶段二：统一（建议 2-3 周）

1. 落 `--dsw-radius-*` / `--dsw-space-*` / `--dsw-z-*` / `--dsw-duration-*` 四组 token，并做一轮机械替换（P1-1/2/4）
2. 字体阶梯采用率从 0.9% 拉起：修 `--dsw-font-m-18` 命名，把 36 处野生字号归位，`font-size` 一律走 composite token（P1-3）
3. 阴影两套命名归一（P1-5）
4. 抽 `<ListboxSurface>` 合并 4 套浮层列表（P1-7）
5. 清理 61 处硬编码颜色中应修的部分（P1-6）

**关键建议：这一步必须配一条 CI 闸门。** 项目已有 `pnpm run duplication`（克隆检测）与 `doc-sync` 等闸门，加一条"CSS 里禁止出现裸 `font-size: Npx` / `border-radius: Npx` / `z-index: N` / 硬编码色值"的 lint 是同等成本的事。**没有闸门，阶段二的成果会在两个季度内退化回现状**——这是 P1 类问题的成因，也是它们唯一的解药。

### 阶段三：提升（建议 3-4 周）

1. 桌面壳接上原生视觉：`titleBarStyle: 'hiddenInset'` / Windows `titleBarOverlay`，激活已写好的 `wco.ts`、`titlebar-strip.ts`；`--dsw-mask-blur` 从 2px 提到真实景深，侧栏/头部改半透明 + `backdrop-filter`（P0-5）
2. Cmd+K 命令面板 + 全局快捷键表（P2-5）
3. 过程反馈重做：running 展开 / 结束折叠、流式光标、轻量 skeleton（P2-6/7）
4. 空状态加示例引导（P2-8）
5. 补 `<main>` landmark 与标题层级；9 处不可达元素语义化（P2-1/2）
6. 插件管理器页面纳入设计系统（P2-9）

---

## 7. 附：可直接落地的 token 补丁

```css
/* ── 1. 新增一档文字色，补齐 4.5:1 及格位 ───────────────────── */
body { --dsw-static-neutral-bluish-650: rgb(112, 117, 123); } /* 白底 4.65:1 */
body {
  --dsw-alias-label-tertiary: var(--dsw-static-neutral-bluish-650);
  --dsw-alias-label-caption:  var(--dsw-static-neutral-bluish-650);
}
body[data-ds-dark-theme] {
  --dsw-alias-label-caption: var(--dsw-static-neutral-bluish-500); /* layer-1 上 5.75:1 */
  --dsw-alias-label-dimmed:  var(--dsw-static-neutral-bluish-700); /* 非文本 3.15:1 */
}

/* ── 2. 唯一品牌强调色 ──────────────────────────────────────── */
body { --dsw-alias-brand-primary: var(--dsw-static-deepseek-500); }
body { --dsw-alias-button-primary-fill: var(--dsw-alias-brand-primary); }

/* ── 3. 圆角阶梯 ───────────────────────────────────────────── */
:root {
  --dsw-radius-xs: 4px;  --dsw-radius-sm: 6px;  --dsw-radius-md: 8px;
  --dsw-radius-lg: 12px; --dsw-radius-xl: 16px; --dsw-radius-pill: 999px;
}

/* ── 4. 间距阶梯 ───────────────────────────────────────────── */
:root {
  --dsw-space-1: 4px;  --dsw-space-2: 8px;  --dsw-space-3: 12px; --dsw-space-4: 16px;
  --dsw-space-6: 24px; --dsw-space-8: 32px; --dsw-space-12: 48px; --dsw-space-16: 64px;
}

/* ── 5. 层级阶梯（禁止新增） ─────────────────────────────────── */
:root {
  --dsw-z-base: 0;    --dsw-z-sticky: 10;    --dsw-z-dropdown: 100;
  --dsw-z-overlay: 1000; --dsw-z-modal: 1100; --dsw-z-toast: 1200;
}

/* ── 6. 动效节奏（单位统一为 ms） ────────────────────────────── */
:root {
  --dsw-duration-fast: 120ms; --dsw-duration-base: 180ms; --dsw-duration-slow: 300ms;
  --dsw-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
}

/* ── 7. 统一焦点语言（一处定义，全站生效） ───────────────────── */
:where(a, button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

/* ── 8. 尊重动效偏好（默认兜底，无需逐组件声明） ─────────────── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 8. 结论

这个项目的设计系统**不是缺设计能力，而是缺"最后一公里的强制力"**。`Tag`/`Pill` 的边界划分、`columns.ts` 的布局求解、`Button` 的 Figma 溯源注释——这些都需要真实的系统思维才写得出来。问题在于：**token 定义完了，但没有一道闸门要求组件消费它**，于是颜色维度（有明确的视觉回报）被消费了，排版/间距/圆角/层级/动效（视觉回报迟钝）被绕过了。

所以最高优先级不是任何一个具体问题，而是**阶段二必须带上 CI 闸门**。否则这份报告里 P1 的每一项，都会在半年后以新的取值重新出现。

---

*本报告所有数字均由脚本实测得出；对比度按 WCAG 2.1 相对亮度公式独立复算。*
