# Desktop

English | [中文](desktop.zh.md)

The desktop subsystem exposes OS-level capabilities to the dsh backend through the Electron main process while keeping the renderer sandboxed. [`@deepseek-ai/dsh-desktop`](../../packages/desktop/desktop/README.md) defines the `ctx.desktop` Service Definition; [`@deepseek-ai/dsh-desktop-shell`](../../packages/desktop/shell/README.md) bridges it to Electron Main over a local socket set by `DSH_DESKTOP_BRIDGE_PATH`; [`@deepseek-ai/dsh-desktop-directory-picker`](../../packages/desktop/directory-picker/README.md) implements the `electron` kind of `ctx.directoryPicker`. The renderer receives model-visible facts through the normal backend event stream, not by calling Main directly.

Source: [`packages/desktop/desktop/src/index.ts`](../../packages/desktop/desktop/src/index.ts), [`packages/desktop/shell/src/index.ts`](../../packages/desktop/shell/src/index.ts), [`apps/desktop/src/bridge-server.ts`](../../apps/desktop/src/bridge-server.ts)

## Skeleton scope

The current Phase 3 implementation wires the bridge, the Service Definition, and a stub Electron Main handler. Native dialogs (`showOpenDialog`, `showSaveDialog`) call Electron's `dialog` API; notifications, menus, global shortcuts, tray, and drag-and-drop are stubbed and will be filled in by later phases.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdesktop--desktop-abstract-seam"></a>

### `ctx.desktop` — `Desktop` (abstract seam)

Abstract desktop-integration service. Subclass, implement the methods, and load the subclass as a plugin — it registers as `ctx.desktop`.

```ts cordis-catalog
/**
 * Show a native open-file / open-directory dialog.
 * @param options - dialog options.
 * @returns selected paths, or undefined when the operator cancels.
 */
abstract showOpenDialog(options: OpenDialogOptions): Promise<string[] | undefined>

/**
 * Show a native save-file dialog.
 * @param options - dialog options.
 * @returns the chosen absolute path, or undefined when the operator cancels.
 */
abstract showSaveDialog(options: SaveDialogOptions): Promise<string | undefined>

/**
 * Show a system notification.
 * @param notification - notification content.
 */
abstract sendNotification(notification: DesktopNotification): void

/**
 * Register a menu item under a named group.
 * @param group - named menu group (e.g., `file`, `view`).
 * @param item - menu item to register.
 * @returns a disposer that removes the item.
 */
abstract registerMenuItem(group: string, item: DesktopMenuItem): () => void

/**
 * Register a global keyboard shortcut.
 * @param accelerator - Electron accelerator string.
 * @param handler - callback invoked when the shortcut fires.
 * @returns a disposer that unregisters the shortcut.
 */
abstract registerGlobalShortcut(accelerator: string, handler: () => void): () => void

/**
 * Configure the host tray icon.
 * @param config - tray configuration.
 * @returns a disposer that removes the tray.
 */
abstract setTray(config: DesktopTrayConfig): () => void
```

Source: [`packages/desktop/desktop/src/index.ts:118`](../../packages/desktop/desktop/src/index.ts)

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

Source: [`packages/desktop/desktop/src/index.ts:110`](../../packages/desktop/desktop/src/index.ts)

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

Source: [`packages/desktop/desktop/src/index.ts:99`](../../packages/desktop/desktop/src/index.ts)

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

Source: [`packages/desktop/desktop/src/index.ts:81`](../../packages/desktop/desktop/src/index.ts)

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

Source: [`packages/desktop/desktop/src/index.ts:105`](../../packages/desktop/desktop/src/index.ts)

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

Source: [`packages/desktop/desktop/src/index.ts:87`](../../packages/desktop/desktop/src/index.ts)

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

Source: [`packages/desktop/desktop/src/index.ts:93`](../../packages/desktop/desktop/src/index.ts)
<!-- END GENERATED cordis-surface -->
