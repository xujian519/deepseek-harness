# Agent Note: Inline rendered conversation nodes for task-specific interfaces

Status: proposed

English | [中文](2026-08-20-inline-rendered-conversation-nodes.zh.md)

## Problem

The chat flow renders only preset nodes: a `ConversationNodeDefinition` plus a keyed renderer in `packages/client/runtime`, and a tool's UI render intent is one of `generic`/`terminal`/`diff`. Task-specific interfaces — charts, boards, forms, panels — need a tool to emit structured data and a frontend renderer to display it, but no path exists for a tool to declare structured output or for the frontend to render by data. BitFun's Mini Apps (the model writes HTML/JS that runs in a sandboxed iframe) deliver the full form, but executing model-written code changes the security semantics and the cost profile; that is a product decision, not a harness capability for the current phase.

## Proposal

Form A: inline rendered conversation nodes, validated as a `packages/experimental/` prototype. The invariant: the interface is always a projection of the session log — a renderer consumes only recorded data, so the model never reads the UI and "model-visible ⟺ logged" holds by construction.

- A tool declares a structured-data output: the tool contract gains a data shape (a documented data contract), and render intent extends from the preset three (`generic`/`terminal`/`diff` in `packages/core/tools/src/presentation.ts`) to "structured data plus a renderer key". The content-block map is merge-extensible (`ContentBlockMap` in `packages/llm/llm/src/types.ts`), so a data block type is the natural landing point.
- The frontend registers a keyed renderer per key and renders nodes from session-log events, reusing `ConversationNodeDefinition`'s `start`/`update` roles and turn/step anchoring.
- New data events follow the session-event contract: the rendered view and the model-visible view both rebuild from the log.
- A demo tool (e.g. chart data) emits structured data rendered as a chart; a keyless snapshot covers the path.

Explicitly out of scope: iframe sandboxing, model-written executable code, and a marketplace.

## Alternatives considered

- **The full Mini App platform (BitFun's shape)**: model-written code plus sandbox plus marketplace changes the security semantics and the engineering cost class; a product decision, deferred.
- **Extending the three preset render intents with more styles**: no structural advance; cannot express task-specific interfaces.
- **Rendering model-produced HTML fragments directly**: executes untrusted code; unacceptable.

## Acceptance criteria

- The experimental package's demo tool emits structured data that a keyed frontend renderer displays as a chart or panel.
- Every byte the renderer consumes is reconstructable from the session log; no model-visible input bypasses the log.
- A keyless snapshot covers the demo path.

## Risks

- **Renderer fragmentation**: per-tool renderers need a data-contract and registration convention; document the render-intent extension.
- **Boundary with the existing tool-presentation system**: render intent widens from three keys to arbitrary keys; ownership and compatibility need documenting.
- **The prototype may be discarded**: acceptance criteria are explicit; stop when unmet.
