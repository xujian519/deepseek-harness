# `@deepseek-ai/dsh-desktop-app`

English | [中文](README.zh.md)

The dsh desktop-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-web-app`](../web-app/README.md): it restates the web runtime values for the desktop profile and inserts this package's `desktop-runtime` glue plugin, which occupies the composition seat the desktop shell plugins (`packages/desktop/*`) mount through. The desktop profile (`dsh --profile desktop`) stacks `dsh-base`, `dsh-web-app`, and this bundle.

## Model Experience

None, as the glue plugin holds the composition seat without contributing model-visible text; the web-surface prompt and `DSH_WEB_URL` runtime variable are owned by [`dsh-web-app`](../web-app/README.md), which this bundle layers over unchanged.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Desktop shell services are not mounted yet** — menu, tray, dialogs, global shortcuts, notifications, and drag-and-drop arrive with the `packages/desktop/*` plugins; the `desktop-runtime` row is their composition seat.
