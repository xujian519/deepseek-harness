# @deepseek-ai/dsh-client-ui-document-studio

English | [中文](README.zh.md)

Document-delivery studio for the [document agent preset](../../../apps/cli/config/agent-presets/document/README.md): a `conversation.view` tab (`document`, label 交付物) that lists the session's produced files, previews HTML/text through the host, and offers open / show-in-folder / print actions. It also auto-switches a session to the studio when the session's agent preset is the document agent.

## What it mounts

- **The studio view** — one entry in the `conversation.view` ring (id `document`, order 20). The tab appears for every session once the plugin is loaded; selecting it shows the studio in the center column.
- **The produced-file vocabulary** — a turn-scoped `ConversationNodeDefinition` (`documentDeliverables`) folding successful mutation `locations` (diff cards and generic edit cards) into turn data, plus a session-scoped view target (`documentDeliverables`) folding every turn in the window into one first-seen ordered list. The derivation is the same vocabulary `ui-deliverables` uses; this package owns its own key so the studio works whether or not `ui-deliverables` is composed in.
- **The preview** — selecting a file reads its text through the host `host.readFileText` RPC (capped at 4 MiB; oversized files show the head plus a truncation note). HTML renders in a sandboxed iframe (`sandbox=""`, no scripts); Markdown/JSON/YAML/CSV/LOG renders as text.
- **The actions** — open with the OS default application, show in folder (only when the host reports native open capability over a loopback authority), and print / export PDF (prints the HTML preview through the browser's print dialog, where "Save as PDF" exports).
- **The auto-switch** — when the current session's preset is the document agent, the studio view is activated on session entry. The switch goes through `ctx.conversation.setActiveView`, which is the sanctioned cross-package channel (the per-session store handle is apply-local by design); the setter mounts with the session's conversation seat, so the switch retries for a bounded window.

The shipped Web patch (`packages/bundle/web-app/cordis.patch.yml`) is the only composition that loads this package. Removing its one entry removes the tab, the vocabulary, the preview, and the auto-switch together.

## Prerequisites

The document agent preset (`document` in `apps/cli/config/agent-presets/`) is what a document session selects; the studio renders for every session regardless. The `host.readFileText` RPC ships with the host; no OpenDesign or other external process is required.

## Model Experience

None: this package is browser-side UI plumbing and reaches no model request. The produced-file data is derived from the mutation tools' own `locations`, never from the model's closing prose.

### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The preview is preview, not execution** — HTML renders with `sandbox=""`, so interactive artifacts (JS-driven decks, live dashboards) show their first paint but do not run. A renderer that trusts the session's own produced files is deferred.
- **PDF is browser-print in this iteration** — the print action opens the OS print dialog; silent `webContents.printToPDF` export through the desktop shell is the P3 follow-up of the document-agent plan.
- **Auto-switch fires on session entry** — a deliberate tab pick back to chat survives until the user leaves and re-enters the session.
- **Preview is text-only by extension** — binary formats (`.docx`, `.pptx`, `.pdf`) list and open but have no inline preview yet.
