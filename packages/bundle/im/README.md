---
description: "The optional IM integration as a profile bundle: [`cordis.patch.yml`](cordis.patch.yml) inserts the single `xmanrui-dsh-im` row over any surface profile, pinning the external [`@xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) plugin. That plugin connects up to nine IM channels (WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord, WhatsApp) and a public AI Office connector to a local Harness. The package is a static patch-list carrier with no runtime API; the profile composer resolves the patch through the `dsh.bundle.patch` manifest field, never through code."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-im`

English | [中文](README.zh.md)

## Summary

The optional IM integration as a profile bundle: [`cordis.patch.yml`](cordis.patch.yml) inserts the single `xmanrui-dsh-im` row over any surface profile, pinning the external [`@xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) plugin. That plugin connects up to nine IM channels (WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord, WhatsApp) and a public AI Office connector to a local Harness. The package is a static patch-list carrier with no runtime API; the profile composer resolves the patch through the `dsh.bundle.patch` manifest field, never through code.

This bundle is **not** a member of any shipped profile template: `dsh-base`, `dsh-web-app`, and `dsh-desktop-app` do not name it, so no surface profile loads IM by default. A profile opts in by adding `@deepseek-ai/dsh-im` to its `dsh.profile.bundles` list, or on an installed `dsh` by `dsh plugin --profile <name> add @deepseek-ai/dsh-im` (the CLI's `reconcilePlugins` then appends it because its manifest declares `dsh.bundle`). In-box bundle resolution — the name resolves from the dsh installation before the profile's own `node_modules` — makes the wrapper available to any profile while keeping IM out of the shipped default closure.

The wrapper pins `@xmanrui/dsh-im@3.0.5` as a single dependency, giving the repository one named entry point and one pinned version, and a home for the IM documentation and gates. The upstream package is external and MIT-licensed; this bundle contributes no code of its own beyond the patch.

No runtime invariant companion is published; the package is a static patch-list carrier (a YAML document of loader rows owned by other packages), mounts no service or events, and owns no mutable relation to check; the pinned xmanrui-dsh-im row's own package carries that plugin's invariants.


## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

Indirectly, through the pinned row: the `xmanrui-dsh-im` row activates `@xmanrui/dsh-im`, which owns its own model-visible text (host and client plugin surfaces) and tool registrations. This bundle contributes no model-visible text and no tool of its own.

#### KV Cache effect

None directly; the pinned `@xmanrui/dsh-im` package owns its effect.

## Known Limitations and Deferred Work

- **IM is opt-in, not default** — enabling the bundle attaches the IM SDK dependency closure (`@tencent-connect/qqbot-*`, `@wecom/aibot-node-sdk`, `dingtalk-stream`, `qrcode`) to the profile and surfaces the IM settings page; profiles that do not list it stay unaffected.
- **The pinned upstream is external** — `@xmanrui/dsh-im` is version-pinned at `3.0.5`; bumping it requires rechecking its `@deepseek-ai/dsh-*` service contract (it injects `connection`, `credentials`, `webServer`, `typertGateway`) against the installed core.

### Dev Note

None.
