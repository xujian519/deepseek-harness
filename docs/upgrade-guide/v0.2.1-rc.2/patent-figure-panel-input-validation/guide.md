---
kind: upgrade-guide
description: "generate_patent_figure now rejects duplicate panel suffixes and a top-level structural or vector input supplied alongside panels, instead of overwriting one figure or dropping the input."
---

# Panel inputs are validated before rendering

English | [中文](guide.zh.md)

## Change

Two panel-mode inputs were accepted and then mishandled. Two panels with the same `suffix` wrote the same `figN<suffix>` file, so the result listed both panels at one path and the second overwrote the first. A top-level structural or vector input (`steps`, `blocks`, `dot`, `circuit`, `plot`, `sections`, `sequence`, `appearance_views`, …) supplied together with `panels` was parsed and validated, then silently ignored because panel mode renders only panel fields. Both cases now fail with `invalid_tool_input`: suffixes must be unique (compared case-insensitively, because `fig1A.svg` and `fig1a.svg` are one file on case-insensitive filesystems), and any top-level figure input alongside `panels` is named in the error.

## Migration

1. Give every panel a distinct suffix; re-run the call.
2. Move a shared structural input into each panel that needs it, or drop it; `panels` renders only panel fields.
3. Confirm: two panels with `suffix: "A"` fail with 面板后缀重复; `{ panels: [...], circuit: {...} }` fails with 顶层结构输入.
