# Agent Note: A conversation.view slot id is the view target the shell activates

Status: implemented

English | [中文](2026-09-15-conversation-view-slot-id-is-target.zh.md)

## Problem

The ui-conversation shell selects a fixed conversation view by its slot registration id. [`activateView`](../../../../packages/client/ui-conversation/src/client/apply.ts) resolves the chosen tab to a slot id (`viewTabs` publishes `{ id: entry.options.id }`, `resolveActiveView` matches by that id) and calls `binding(sessionId).activate(active.id)`, which reaches [`assembler.activateTarget(slotId)`](../../../../packages/client/ui-conversation/src/client/conversation/assembler.ts). View snapshots are indexed by `ConversationViewDefinition.target`: `resetViewBuilders` stores each builder under `definition.target`, `activateTarget(target)` builds a snapshot only for the target it adds to `activeTargets`, and `flush()` rebuilds only active targets. A view whose component reads its snapshot by target — `useConversation(state => state.views.get(TARGET))` — therefore renders only when its slot id equals its target.

Two views registered a slot id that differed from the target they read. [`ui-patent-teams`](../../../../packages/client/ui-patent-teams/src/client/index.ts) used id `teams` with target `patentTeams`; [`ui-document-studio`](../../../../packages/client/ui-document-studio/src/client/index.ts) used id `document` with target `documentDeliverables`. Selecting either tab activated a target with no registered view definition, so the real target never entered `activeTargets`, its snapshot stayed `undefined`, and the component fell back to its empty state. document-studio's preset auto-switch carried the same mismatch: `setActiveView(sessionId, 'document')` passed the slot id, so a document-preset session could not jump to the studio either.

The chat and trajectory views never hit this. Their slot ids already equal their targets, and they read through `binding.target(TARGET)`, whose subscription activates the target directly regardless of the slot id. No test caught the two outliers: document-studio's `client-bundle` spec asserted the slot id was `document`, recording the mismatch without rendering the view, and the studio view had no web e2e.

## Decision

A `conversation.view` slot's registration id equals the `ConversationViewDefinition.target` its component reads. ui-patent-teams registers id `PATENT_TEAMS_TARGET` (`patentTeams`); ui-document-studio registers id `DOCUMENT_DELIVERABLES_TARGET` (`documentDeliverables`) and its auto-switch calls `setActiveView(sessionId, DOCUMENT_DELIVERABLES_TARGET)`. The shell is unchanged: activating by slot id is correct because the slot id is the view's identity across `viewTabs`, `resolveActiveView`, and `setView`. The fix aligns the two registrations with the identity the shell already assumes.

## Alternatives considered

- **Activate by the component's target instead of the slot id.** Rejected: the slot id is the view's identity through the whole tab pipeline, so a target-based shell would need a slot-id-to-target map the shell does not own, and it would re-plumb the two views that already work because their id equals their target. Aligning the two outliers is smaller than changing the shared activation path.
- **Derive the target from the registered component or builder.** Rejected: the slot registration and the `ConversationViewDefinition` are separate contributions a plugin makes independently; the shell has no seam to read a component's target without the plugin declaring it, and the declaration the plugin already makes is the slot id.
- **Leave the mismatch and document the empty view.** Rejected: a view that silently renders its empty state on every selection is a user-facing defect, not a documented limitation.

## Consequences

Both views render their fold. A new `conversation.view` plugin must set its slot id to the target its component reads; the chat and trajectory views are unaffected because they already satisfy that and read through `binding.target`. document-studio's `client-bundle` spec now asserts the slot id and the `setActiveView` target are `documentDeliverables`.

## Testing

[`apps/web/tests/document-studio-panel.e2e.ts`](../../../../apps/web/tests/document-studio-panel.e2e.ts) seeds a native-v3 session carrying one `document_deliver` registration, selects the Deliverables tab, and goldens the folded file list: two chips with their format and quality-gate badges plus the delivered-file count. The scenario is negative-validated — with the slot id reverted to `document`, the list anchor never appears and the render case times out on the empty view. [`apps/web/tests/patent-teams-panel.e2e.ts`](../../../../apps/web/tests/patent-teams-panel.e2e.ts) guards the same contract for the Teams view.
