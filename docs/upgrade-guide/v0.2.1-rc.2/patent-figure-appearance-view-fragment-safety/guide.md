---
kind: upgrade-guide
description: "Appearance-view fragments carrying scripts, event handlers, javascript: URLs, embedded HTML, animation, style, or ENTITY/CDATA are now rejected before layout instead of being embedded in the delivered SVG."
---

# Appearance-view fragments carry geometry only

English | [中文](guide.zh.md)

## Change

The appearance-design sheet embedded each model-supplied view fragment verbatim into the delivered SVG. The post-render review (`assertSafeSvg`) rejected ENTITY/CDATA but not `<script>`, event-handler attributes, or `javascript:` URLs, so a fragment could deliver executable content; when an entity declaration was present, the tool still delivered the SVG and only skipped the review with a warning. `generate_patent_figure` now rejects such fragments before rendering with `invalid_tool_input` and writes nothing. Rejected content: `script`, `style`, `foreignObject`, `iframe`, `object`, `embed`, `animate`, `set`, `on*=` attributes, `javascript:` URLs, and ENTITY/CDATA. Numeric character references are decoded before the check, so `&#x6a;avascript:` is caught as well. `<style>` is rejected because CSS can load external resources; keep presentation in attributes.

## Migration

1. Strip active content from `appearance_views[].body` and `extras[].body`; keep geometry elements and presentation attributes.
2. Re-run the call; a rejected fragment now names the view and the offending construct.
3. Confirm: a view body containing `<script>` fails with 可执行元素, and no `fig1.svg` is written.
