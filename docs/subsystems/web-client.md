# Web Client architecture

English | [中文](web-client.zh.md)

The Web Client is a browser-side Cordis application assembled from independently loaded plugins. Its architecture has four reusable foundations: [Client Modules](client-modules.md) loads the plugin graph, the [API Gateway](../api-gateway.md) provides typed Host communication, [Slots](slots.md) composes React UI, and [Conversation](conversation.md) turns a Session history window into target-owned views. This page connects those systems and defines where Client models and feature packages belong.

## Layers and ownership

| Layer | Main owners | Responsibility |
|---|---|---|
| Host application | business services and `packages/api/*-controller` Host entries | Own authoritative state, persistence, mutation ordering, access policy, and stream production. |
| Transport and API assembly | `client/connection`, `api/gateway`, `api/remotes` | Establish a Client generation, expose generated `ctx.remote` methods and streams, forward selected Cordis events, and carry cancellation and results. |
| Client models | `api/session-controller/client`, `api/workspace-controller/client` | Maintain React-free mirrors of Host state, resolve stream/unary races, own object identities and subscriptions, and expose narrow command services. |
| UI adapters | `client/ui-session`, `client/ui-workspace` | Convert model observables into root or Session-scoped standard Slot sources without taking ownership of business state. |
| Conversation data | `client/ui-conversation`, target packages such as `ui-chat` and `ui-trajectory` | Assemble standard events and compact historical Assistant runs into independent target snapshots and own the shared conversation shell and input flow. |
| Composition and rendering | `client/ui-slots`, `client/ui-renderer`, `client/ui-layout`, feature UI packages | Declare extension locations, derive component props, bind observables to React hooks, and mount the final tree. |

The dependency direction is Host state → Remote transport → Client model → UI adapter → Conversation or presentation → Slots → React. User actions travel back through callbacks that close over an injected Client service or generated Remote namespace. A presentation component never receives Cordis `ctx`, a transport object, or another feature plugin's implementation.

## Browser boot

The Host writes the composed `WebBootGraph` to `window.__DSH_BOOT__` and installs the browser module-loader facade before parser-preloaded scripts execute. The module system is a lazy CommonJS table: loading a bundle registers its factory, while materializing an entry runs the factory with synchronous `require` over platform modules and declared dynamic dependencies.

The Web boot kernel creates the module system, prefetches `immediately` entries, mounts the vendored Cordis Loader, and creates every graph entry. Cordis service injection determines activation; module graph order determines only whether synchronous imports can be materialized. After the complete roster reaches a settled state, `ui-renderer` hydrates the framework-free boot DOM and calls the sole context-level `renderSlot('root')` operation. [Client Modules](client-modules.md) owns the graph, bundle route, cache revision, and loader details.

## Remote communication

Host business services annotate callable methods with Typert Remote decorators. Host generation emits strict descriptors, runtime codecs, declaration merges, and source maps. The Client-side `api-remotes` assembly selects those generated contributions and mounts concrete methods under `ctx.remote.<namespace>` and Session-scoped `agentCtx.remote.<namespace>`. Feature packages depend on the generated service face, not the Gateway implementation or a Host package's runtime entry.

The Connection owns request correlation, the `/api` carrier, trust checks, exact Fetch routes, and connection generations. API Gateway owns Remote dispatch, cancellation, logical streams, and selected Host event forwarding. Controller operations belong on generated Remote methods or explicit Remote streams; feature-owned downloads register exact Fetch routes. The [API Gateway reference](../api-gateway.md) defines generation and invocation, while the [Connection README](../../packages/client/connection/README.md) defines the physical carrier and trust policy.

The internal `$events` logical stream is the Connection generation source. Its opening `ready` frame carries the Host home used for path display and establishes the generation after Host listeners are attached, before any controller begins a baseline read. `ctx.remote.$on()` delivers allowlisted ordinary events to the root Client Context and scoped waterfall events to the resolved Session Context; a waterfall listener returns a result, calls `next()`, or rejects.

## Client models

Each API controller package owns a paired Host and Client face. The Host side owns authoritative mutation and stream production. The Client side owns an identity-stable, React-free model over the same generated wire types and exposes observable snapshots plus commands. UI packages consume these Client services and do not reproduce transport state in component stores.

### Sessions

[`api/session-controller`](../../packages/api/session-controller/README.md) exposes Host commands for list, search, creation, selection data, prompt, queue, cancellation, pagination, and follow/control streams. Its Client side is organized as `ClientSessions → SessionManager → Session`:

- `ClientSessions` provides `ctx.sessions`, owns Session scopes and stable `SessionBinding` objects, and projects the selected list state.
- `SessionManager` owns the list baseline, live list/control updates, lazy Session instances, queues, projection stores, subagent catalogs, and conflict ordering between pulls and later updates.
- Each `Session` owns one contiguous logical-event window represented by `SessionEventLikeEntry` values, paging, follow, prompt/control state, and the observable snapshot consumed by adapters.

The durable event path opens `follow()`, whose first frame contains the current header, tail page, cursor, and complete projection baseline. History records have an explicit `event` or `chunks` discriminator and an aligned inner `event`; the journal validates each inclusive logical sequence range before the Client retains the records as `SessionEventLikeEntry` values without per-record conversion. Each physical generation atomically replaces the retained window from that snapshot; standard live events then append by sequence. `page()` is reserved for older history and gap repair. The transient control stream starts every generation with a complete baseline and then applies queue, job, and projection updates.

### Workspaces

[`api/workspace-controller`](../../packages/api/workspace-controller/README.md) keeps Workspace mutation policy and the authoritative follow feed on the Host. `ClientWorkspaceModel` owns the browser rows, order, archived Session ids, command echoes, and stream/unary race resolution. Every stream generation starts with a complete baseline followed by `upsert`, `remove`, `order`, and `archived` increments; reconnect replaces the model from the new baseline. `WorkspaceController` exposes that model as `ctx.workspaces`, while `ui-workspace` contributes `useWorkspaces` and navigation callbacks to the UI.

This pairing is not a second source of business truth. Host controllers decide durable state and mutation outcomes; Client models maintain the latest usable local projection, preserve object identity where useful to rendering, and encode how delayed responses and replacement baselines merge.

## Conversation and presentation

`ui-session` installs the `session` scope adapter and publishes `useSessions`, `useSession`, `sessionId`, and `useProjection`. Domain adapters add further standard sources without putting React hooks on the model objects.

`ui-conversation` binds once to each `SessionBinding.eventSource`. Its event registry correlates standard events and Client-only `chunkrow/*` history events into stable business Contexts, and its view registry materializes target snapshots. Packed runs stay single inputs and Matches through replay; Chat Assistant, Trajectory Assistant, and Turn Tail are the built-in Definitions that interpret them. `ui-chat` and `ui-trajectory` register separate Definitions and builders: they may interpret the same event family, but they do not import or share each other's final display model. The shell selects a registered view and passes its snapshot through standard hooks and Slots. [Conversation](conversation.md) defines Context identity, replay, Location data, target builders, and keyed renderers.

`ui-slots` provides the typed registry and lifecycle ledger; `ui-renderer` is the only package that binds bare observables through `useSyncExternalStore`, owns React contexts, and renders the root tree. Feature components receive framework hooks, owner props, store actions, and explicit injection through their derived props. [Web Client Slots](slots.md) lists those inputs, extension APIs, and the current Slot hierarchy.

## Data paths

| Path | Sequence |
|---|---|
| durable Session display | Host Session log → packed Remote `follow`/`page` history → Client `SessionEventLikeEntry` window → Conversation Contexts → target snapshot (`chat`, `trajectory`, or another registered target) → Slot view → React |
| transient Session control | Host control baseline → Remote snapshot stream → `SessionManager` queue/job/projection stores → Session and list snapshots → standard hooks → components |
| Workspace state | Host Workspace baseline and increments → `ClientWorkspaceModel` → `ctx.workspaces.list` → `useWorkspaces` → sidebar, hero, and navigation entries |
| scoped interaction | Host Cordis waterfall → API Remotes `$events` → `ctx.remote.$on()` on the Session Context → owning UI package → result or `next()` |
| user command | component callback → registration inject face or Slot owner → `ctx.sessions`, `ctx.workspaces`, or generated scoped Remote → Host Controller → authoritative update → stream or event projection back to the Client |

## Reconnection

Physical and logical recovery are separate. Gateway mux restores the physical WebSocket; each `RemoteStream` reopens its own logical source when the Connection publishes a usable generation. A carrier failure is retryable, while a business error, malformed opening item, or protocol violation is terminal for the owning logical stream.

Recovery follows the data's semantics:

- A durable Session journal validates logical sequence ranges and replaces its window from every generation's opening snapshot; `page()` supplies older history and repairs any later range gap.
- Session control and Workspace streams retain the last published value while disconnected, then atomically replace it from a fresh opening baseline.
- Ordinary forwarded notifications are not replayed. Stateful domains need a baseline, cursor, or explicit query; scoped waterfalls retain their own request lifetime.

There is no monolithic Client `Runtime`, `HostFrame`, `events.mux`, `events.host`, or universal `resync()` API. The Connection exposes generation state, Gateway owns logical stream supervision, and each Client model defines replacement or resume semantics appropriate to its data.

## Package boundaries

Feature plugin packages may share declarations through `import type`; they do not runtime-import or re-export another feature plugin's values. Cross-package behavior uses injected Cordis services, and cross-package UI uses Slots. Target-specific Conversation Definitions, projection helpers, and final view data stay with their target package even when Chat and Trajectory intentionally implement parallel logic.

Shared runtime values need a narrow static owner with no feature lifecycle, such as `client/store`, `ui-primitives`, or a browser-safe utility package. Transport and generated API assembly may import runtime contributions because assembling one protocol is their explicit responsibility. A feature package does not add `dsh.client.external` merely to bypass this rule.

Use the four detailed references according to the extension being added:

- [Client Modules](client-modules.md) for package discovery, loading, shared module identities, and boot order.
- [API Gateway](../api-gateway.md) for Host methods, generated Remote contributions, streams, and forwarded events.
- [Web Client Slots](slots.md) for components, hooks, stores, injection, and placement.
- [Conversation](conversation.md) for durable event correlation, target snapshots, and Chat or Trajectory view contributions.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbettersidebar--bettersidebarservice"></a>

### `ctx.betterSidebar` — `BetterSidebarService`

The registry service published as `ctx.betterSidebar`.

```ts cordis-catalog
/**
 * Register a tab type for the + menu and `openTab`. Throws when the
 * descriptor id is already registered.
 *
 * @param descriptor - The tab type's display, enablement, and creation contract.
 * @returns The disposer, which unregisters the type (no-op if replaced) and notifies subscribers.
 */
registerTab(descriptor: TabDescriptor): () => void

/**
 * Register a file viewer consulted by `matchFileViewer`. Throws when the
 * descriptor id is already registered.
 *
 * @param descriptor - The viewer's match contract (priority, detect, exts) and open callback.
 * @returns The disposer, which unregisters the viewer (no-op if replaced) and notifies subscribers.
 */
registerFileViewer(descriptor: FileViewerDescriptor): () => void

/**
 * Currently registered tab types (insertion-order snapshot).
 * @returns The tab type descriptors.
 */
getTabs(): readonly TabDescriptor[]

/**
 * Currently registered file viewers (insertion-order snapshot).
 * @returns The file viewer descriptors.
 */
getFileViewers(): readonly FileViewerDescriptor[]

/**
 * Find a tab descriptor by id (undefined if not registered).
 *
 * @param id - The tab descriptor id to look up.
 * @returns The descriptor, or undefined when the id is not registered.
 */
getTab(id: string): TabDescriptor | undefined

/**
 * Whether a tab type is enabled in the side card prefs. An absent
 * `tabsEnabled[id]` entry means enabled — only an explicit `false`
 * disables the type (hidden from the + menu, `openTab` refuses, and
 * derived flows gate on it).
 *
 * @param id - The tab descriptor id to check.
 * @returns Whether the tab type is enabled.
 */
isTabEnabled(id: string): boolean

/**
 * Whether a file viewer is enabled (absent `viewersEnabled[id]` = enabled).
 *
 * @param id - The file viewer descriptor id to check.
 * @returns Whether the viewer is enabled.
 */
isViewerEnabled(id: string): boolean

/**
 * Find a file viewer for a path (priority desc; detect first, then exts).
 * Disabled viewers are skipped, so files fall through to the next match.
 *
 * @param path - The file path to match (extension extracted from the last dot).
 * @param head - Leading file bytes for content-based `detect` matches; detection is skipped when absent.
 * @returns The best matching enabled viewer descriptor, or undefined when none matches.
 */
matchFileViewer(path: string, head?: Uint8Array): FileViewerDescriptor | undefined

/**
 * Open a tab (used by external tabs and the + menu). `title` overrides
 * the descriptor's title when given (the editor tab shows the file name);
 * when the descriptor provides `createTab` it mints the tab itself and
 * `title`/`path`/`id` are ignored. `url` lands the tab with its `path`
 * pre-set to the URL (the browser tab's navigation seed; the caller
 * usually pairs it with a hostname `title`). A disabled tab type is a
 * no-op.
 *
 * `scope` (v0.12.0+) targets a specific session: when given, the open
 * lands in THAT session's sidebar state (loading it if it has none yet)
 * without switching the UI's active session; when absent the open lands
 * in the currently active session (the pre-0.12 behavior).
 *
 * A CONTENT open (a `path` or `url` seed) must land in sight: when the
 * panel hosting the landing pane is collapsed, it is expanded
 * automatically (the right panel by default, the bottom panel when the
 * active pane lives there; on narrow viewports the merged drawer opens).
 * Type-only opens (the + menu, agent-terminal auto-tabs) never expand —
 * the panel behavior is their caller's business.
 *
 * Note: `available` gates the + menu's disabled state only — it does NOT
 * refuse `openTab` (only the settings disable switch does).
 *
 * @param seed - Which tab to open and its content seed (title/path/diff/url/meta overrides).
 * @param scope - The session whose sidebar receives the open; defaults to the active session.
 */
openTab(seed: OpenTabSeed, scope?: SessionScope): void

/**
 * Close a tab by id (fires descriptor.onClose). An unknown tab id is a
 * strict no-op (no state churn, no callbacks). `scope` (v0.12.0+) rides
 * to the callback (its optional cwd included); absent, the callback gets
 * `{ sessionId }` of the active session.
 *
 * @param tabId - The open tab instance id to close.
 * @param scope - The session whose sidebar closes the tab; defaults to the active session.
 */
closeTab(tabId: string, scope?: SessionScope): void

/**
 * Subscribe to registry changes (register/dispose).
 *
 * @param listener - Invoked after every registry mutation.
 * @returns The disposer that removes the listener.
 */
subscribe(listener: () => void): () => void

/**
 * The current sidebar snapshot: the active session id, its state (panel
 * geometry, open tabs, expansions), and the side card prefs (v0.12.0+).
 * `state`/`sessionId` are undefined until a session becomes active.
 *
 * @returns The current snapshot (active session id, its sidebar state, and the side card prefs).
 */
getSnapshot(): SidebarSnapshot

/**
 * Subscribe to snapshot changes (session switch, state changes, prefs changes). Returns the disposer.
 *
 * @param listener - Invoked after every snapshot change.
 * @returns The disposer that removes the listener.
 */
subscribeState(listener: () => void): () => void

/**
 * Update an open tab's display fields (title / path / meta); a missing tab id is a no-op.
 *
 * @param tabId - The open tab instance id to update.
 * @param patch - The display fields to overwrite; absent fields keep their value.
 */
updateTab(tabId: string, patch: { title?: string; path?: string; meta?: unknown }): void

/**
 * Activate an open tab (the tab-bar activation path; fires
 * descriptor.onActivate). An unknown tab id is a strict no-op. `scope`
 * (v0.12.0+) rides to the callback like `closeTab`'s.
 *
 * @param tabId - The open tab instance id to activate.
 * @param scope - The session whose sidebar activates the tab; defaults to the active session.
 */
activateTab(tabId: string, scope?: SessionScope): void

/**
 * Open a file in the sidebar editor of `scope`'s session (title defaults to the file name).
 *
 * @param scope - The session whose sidebar opens the file.
 * @param path - The file path to open as the editor tab's content seed.
 * @param title - The tab title; defaults to the file name.
 */
openFile(scope: SessionScope, path: string, title?: string): void
```

Source: [`packages/client/better-sidebar/src/client/service.ts`](../../packages/client/better-sidebar/src/client/service.ts)
<!-- END GENERATED cordis-surface -->
