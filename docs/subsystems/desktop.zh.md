# Desktop

[English](desktop.md) | 中文

桌面子系统通过 Electron 主进程向 dsh 后端暴露 OS 级能力，同时保持渲染进程沙箱化。[`@deepseek-ai/dsh-desktop`](../../packages/desktop/desktop/README.zh.md) 定义 `ctx.desktop` Service Definition；[`@deepseek-ai/dsh-desktop-shell`](../../packages/desktop/shell/README.zh.md) 通过 `DSH_DESKTOP_BRIDGE_PATH` 指定的本地 socket 桥接到 Electron Main；[`@deepseek-ai/dsh-desktop-directory-picker`](../../packages/desktop/directory-picker/README.zh.md) 实现 `ctx.directoryPicker` 的 `electron` kind。渲染进程通过正常的后端事件流接收模型可见事实，而不是直接调用 Main。

源码：[`packages/desktop/desktop/src/index.ts`](../../packages/desktop/desktop/src/index.ts)、[`packages/desktop/shell/src/index.ts`](../../packages/desktop/shell/src/index.ts)、[`apps/desktop/src/bridge-server.ts`](../../apps/desktop/src/bridge-server.ts)

## 骨架范围

当前 Phase 3 实现接通了桥接、Service Definition 和 Electron Main 桩处理程序。原生对话框（`showOpenDialog`、`showSaveDialog`）调用 Electron 的 `dialog` API，Electron Main 显示一个静态托盘图标（显示/退出菜单、关闭时隐藏）。通知、菜单、全局快捷键、文件拖放以及可编程的 `setTray` 契约仍为桩实现，将在后续阶段补齐。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdesktop--desktop-abstract-seam"></a>

### `ctx.desktop` — `Desktop` (abstract seam)

Abstract desktop-integration service. Subclass, implement the methods, and load the subclass as a plugin — it registers as `ctx.desktop`.

```ts cordis-catalog
/**
 * Show a native open-file / open-directory dialog.
 * @param options - dialog options.
 * @param signal - caller/connection lifetime; abort rejects the call and
 * discards the dialog result. The native dialog itself stays open until the
 * operator acts because Electron exposes no programmatic close.
 * @returns selected paths, or undefined when the operator cancels.
 */
abstract showOpenDialog(options: OpenDialogOptions, signal?: AbortSignal): Promise<string[] | undefined>

/**
 * Show a native save-file dialog.
 * @param options - dialog options.
 * @param signal - caller/connection lifetime; abort rejects the call and
 * discards the dialog result. The native dialog itself stays open until the
 * operator acts because Electron exposes no programmatic close.
 * @returns the chosen absolute path, or undefined when the operator cancels.
 */
abstract showSaveDialog(options: SaveDialogOptions, signal?: AbortSignal): Promise<string | undefined>

/**
 * Show a system notification.
 * @param notification - notification content.
 */
abstract sendNotification(notification: DesktopNotification): void

/**
 * Register a menu item under a named group. Items in the tray's configured
 * menu group (`'tray'` by default) join the tray context menu; other groups
 * become top-level application menus.
 * @param group - named menu group (e.g., `file`, `view`, `tray`).
 * @param item - menu item to register.
 * @returns a promise resolving to a disposer that removes the item; rejects
 * when the bridge cannot place the item.
 */
abstract registerMenuItem(group: string, item: DesktopMenuItem): Promise<() => void>

/**
 * Register a global keyboard shortcut.
 * @param accelerator - Electron accelerator string.
 * @param handler - callback invoked when the shortcut fires.
 * @returns a promise resolving to a disposer that unregisters the shortcut;
 * rejects when the accelerator is already claimed.
 */
abstract registerGlobalShortcut(accelerator: string, handler: () => void): Promise<() => void>

/**
 * Configure the host tray icon.
 * @param config - tray configuration.
 * @returns a promise resolving to a disposer that removes the tray
 * configuration; rejects when no tray is available.
 */
abstract setTray(config: DesktopTrayConfig): Promise<() => void>
```

Source: [`packages/desktop/desktop/src/index.ts`](../../packages/desktop/desktop/src/index.ts)

<a id="desktop-events"></a>

### `desktop/*` events

<a id="desktopbridge-lost--emit"></a>

#### `desktop/bridge-lost` — emit

The bridge to Electron Main was lost.

```ts cordis-catalog
/**
 * The bridge to Electron Main was lost.
 * @mode emit
 */
'desktop/bridge-lost'(): void
```

Source: [`packages/desktop/desktop/src/index.ts`](../../packages/desktop/desktop/src/index.ts)

<a id="desktopfile-dropped--emit"></a>

#### `desktop/file-dropped` — emit

Files were dropped on the renderer window.

```ts cordis-catalog
/**
 * Files were dropped on the renderer window.
 * @mode emit
 * @param payload - event payload.
 */
'desktop/file-dropped'(payload: { paths: string[] }): void
```

Source: [`packages/desktop/desktop/src/index.ts`](../../packages/desktop/desktop/src/index.ts)

<a id="desktopmenu-activated--emit"></a>

#### `desktop/menu-activated` — emit

A registered menu item was activated.

```ts cordis-catalog
/**
 * A registered menu item was activated.
 * @mode emit
 * @param payload - event payload.
 */
'desktop/menu-activated'(payload: { menuId: string }): void
```

Source: [`packages/desktop/desktop/src/index.ts`](../../packages/desktop/desktop/src/index.ts)

<a id="desktopnotification-clicked--emit"></a>

#### `desktop/notification-clicked` — emit

A notification was clicked.

```ts cordis-catalog
/**
 * A notification was clicked.
 * @mode emit
 * @param payload - event payload.
 */
'desktop/notification-clicked'(payload: { notificationId: string }): void
```

Source: [`packages/desktop/desktop/src/index.ts`](../../packages/desktop/desktop/src/index.ts)

<a id="desktopshortcut-triggered--emit"></a>

#### `desktop/shortcut-triggered` — emit

A registered global shortcut was pressed.

```ts cordis-catalog
/**
 * A registered global shortcut was pressed.
 * @mode emit
 * @param payload - event payload.
 */
'desktop/shortcut-triggered'(payload: { accelerator: string }): void
```

Source: [`packages/desktop/desktop/src/index.ts`](../../packages/desktop/desktop/src/index.ts)

<a id="desktoptray-clicked--emit"></a>

#### `desktop/tray-clicked` — emit

The tray icon was clicked.

```ts cordis-catalog
/**
 * The tray icon was clicked.
 * @mode emit
 * @param payload - event payload.
 */
'desktop/tray-clicked'(payload: { button: 'left' | 'right' }): void
```

Source: [`packages/desktop/desktop/src/index.ts`](../../packages/desktop/desktop/src/index.ts)
<!-- END GENERATED cordis-surface -->
