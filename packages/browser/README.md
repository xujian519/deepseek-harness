---
description: "Browser automation backends behind the model-facing download and scraping tools: a cascade abstraction (ego lite → BrowserOS neo → browser-use → @playwright/mcp) with capability probing, cold-decision routing, and link-extraction execution for the browser fallback path. Ported from the Sati browser backend layer (`src/browser/backend/`)."
kind: "package-group"
---

# browser/ — Browser automation backend family

English | [中文](README.zh.md)

Browser automation backends behind the model-facing download and scraping tools: a cascade abstraction (ego lite → BrowserOS neo → browser-use → @playwright/mcp) with capability probing, cold-decision routing, and link-extraction execution for the browser fallback path. Ported from the Sati browser backend layer (`src/browser/backend/`).

| Package | Role |
|---|---|
| [`browser-backend/`](browser-backend/README.md) | Backend types/capabilities, per-backend probes, cascade routing, and the browser-use link extractor. |

Child READMEs own each package contract.
