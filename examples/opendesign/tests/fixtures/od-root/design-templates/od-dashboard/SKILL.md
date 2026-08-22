---
name: od-dashboard
description: |
  Fixture OpenDesign-style render template: build a single-file KPI dashboard
  from a seed HTML template. Exercises the design-templates/ root of an
  OpenDesign checkout.
whenToUse: User asks for a dashboard, KPI screen, or operations overview.
---

# Dashboard Template (fixture)

Build a single self-contained `index.html` KPI dashboard by copying the seed
`assets/template.html` and filling the KPI card slots with real numbers from
the brief.

## Workflow

1. Copy `assets/template.html` to `index.html`.
2. Replace the six `:root` variables with the active design system tokens.
3. Fill each KPI card with a real value and a one-line context.
4. Do not add external assets; keep the file self-contained.
