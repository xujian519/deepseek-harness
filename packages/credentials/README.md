---
description: "Package map for the credential capability family: the credential-reference seam, the environment-and-file provider, the authorization flow registry, the Platform account implementation over that store, and how references keep secret values out of configuration."
kind: "package-group"
---

# credentials/ — credentials and authorization

English | [中文](README.zh.md)

## Summary

The `credentials/` group lets configuration name secrets instead of embedding their values. Use `credentials/` to store, look up, and remove credentials, `credentials-local/` for private on-machine storage with per-run environment overrides, and `authorization/` when obtaining a credential requires asking a human. The `deepseek-account/` and `deepseek-account-platform/` pair keeps DeepSeek sign-in state in that same local store for the Client, API, and model consumers. Rotated stored values apply to the next model request, while `DEEPSEEK_API_KEY=… dsh` takes precedence for that run. Configuration files contain only credential names; local secret values remain readable only by the same OS user.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Five packages provide the credential feature: one stores, looks up, and removes secrets at runtime while configuration only names them; the second is the default on-machine store; the third lets plugins obtain credentials that have to be asked for; the account pair defines the DeepSeek account service and its Platform implementation over that store. Their READMEs cover day-to-day use; the subsystem reference owns the exhaustive contracts.

| Package | Role | ctx key |
|---|---|---|
| [`credentials/`](credentials/README.md) | Store, look up, and remove secrets at runtime while configuration only names them | `ctx.credentials` |
| [`credentials-local/`](credentials-local/README.md) | The default on-machine store: a private YAML file, environment overrides win | registers `ctx.credentials` |
| [`authorization/`](authorization/README.md) | Plugin-owned flows that obtain a credential by asking a human | `ctx.authorization` |
| [`deepseek-account/`](deepseek-account/README.md) | The account service definition shared by the Platform implementation, the Remote controller, and model consumers | `ctx.deepseekAccount` |
| [`deepseek-account-platform/`](deepseek-account-platform/README.md) | The Platform account implementation: browser sign-in, stored grant, profile and balance reads, and sign-out | registers `ctx.deepseekAccount` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then the capability-seam table and the configuration surface of the local store.

- [Credentials subsystem reference](../../docs/subsystems/credentials.md) — `CredentialRef` and `CredentialKey`, per-operation resolution, UI-safe `CredentialInfo`, authorization flows, and the generated Cordis surface.
- [Capability seams](../../docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this family follows.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-credentials-local) — every accepted field of the local store.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
