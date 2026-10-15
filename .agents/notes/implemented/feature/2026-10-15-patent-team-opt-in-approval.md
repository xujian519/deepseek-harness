# Agent Note: The patent team flow is opt-in, and creating or closing a team is a user decision

Status: implemented

English | [中文](2026-10-15-patent-team-opt-in-approval.zh.md)

## Problem

The `patent` preset routed complex cases into a durable multi-agent team by default. The persona's 团队协作 entry read "复杂案件（OA 答复/无效宣告/全流程撰写）按 `patent-team-composition` 技能组建持久团队", and the shipped skill opened with "复杂专利作业优先组建持久团队并行分工". Nothing asked the user first: the model read the case type, decided a team should exist, and the captain plus its members worked a task DAG to completion behind a composite quality gate. The two sessions that motivated [the team-wait note](2026-10-15-patent-teams-wait.md) are the shape this produces — 4h34m and 15h40m of wall clock in which seven members' combined active time was 9.0 hours against 15.7 hours — and the team-composition skill itself records a 7-member, 15-task, 51-message run whose output the user still rejected ("规模不是质量").

Two things were missing, and they are separate problems:

- **A default that follows the request.** The preset had one route (team) and one implicit fallback (single session, when the plugin was disabled), so "answer what was asked and nothing more" was not a mode the model could select deliberately. A user who asked to check one claim's support got a case pipeline.
- **Enforcement behind the two decisions that decide a case.** Creating a team and closing a case were ordinary model calls. The persona and the skill stated confirmation points as instructions, and the plugin offered no seam through which a user decision could stop a call. The persona's discipline 6 was weaker still — "向用户确认或至少说明取舍理由" — under which explaining the choice and proceeding satisfied it.

## Decision

**The preset declares two work modes and defaults to the intent-driven one.** `presets/patent.patch.yml` gains a 作业模式 section decided before work starts. 流程二 · 意图驱动（默认）scopes the job to the user's request — a sub-task stays a sub-task and does not expand into the full case pipeline — while keeping every discipline and gate unchanged (`law_verify`, the quality gates, the delivery gate's `rule_check` / `law_verify` / `matter_log_append` / closure run, and case-file recording). Human participation is that mode's point: the scope and artifact list are restated for confirmation before work starts, each trade-off (search channel, comparison documents, claim layout and count, specification conventions, reply or amendment strategy, grounds combination, delivery template) is confirmed through `ask_user_question` with its reason, stage outputs are shown before the next step, and an unanswered point is not approval. 流程一 · 专利团队 remains available and requires the user's explicit instruction in that turn; case complexity, deliverable count, and workload are not instructions. The section also states that either mode can be switched to the other mid-case, after telling the user what is finished and what is open.

**The team flow's confirmation points are stated where the team flow loads.** `patent-team-composition`'s description — the one surface the model sees before loading the skill into context — now opens with the opt-in trigger, so "the standing route for complex cases" cannot be read back out of it. Its body states the gate (an explicit user instruction, in that turn) and gains a 人工确认点 section: the roster and task DAG are confirmed before `patent_teams_create`, each stage's key output is shown to the user before the next task starts, strategy choices stay with the user, and per-round reporting is required instead of one closing report. The team-size threshold now reads "an explicit instruction *and* adversarial roles that reduce risk", keeping the delegation rules the persona deliberately does not carry.

**The two case-level decisions are execution points.** `@deepseek-ai/dsh-patent-teams` gains `approveCreation` and `approveClosure`. With either on, the matching tool (`patent_teams_create` / `patent_teams_delete`) asks the deployment's `approval` service for one decision before the mutation runs, carrying the tool, the exact call, and a reason that names the team and its goal (or the closure). A decision that is not `allowed-once`, or a deployment with no mounted answerer, raises `TeamApprovalError` naming the outcome (`rejected`, `cancelled`, `unavailable`) and the mutation does not happen: `src/approval.ts` owns the seam, and both tools call it before touching the service. The package defaults both switches to `false` — which decisions a deployment reserves for its users is deployment policy — and the patent preset turns both on. The persona and the skill state that a refusal here is an ordinary rejection and that retrying the same call to get past it is prohibited; the reason text reaches the model as the failed call, and the `approval/asked` + `approval/decided` pair is what a reviewer reads afterwards.

**Discipline 6 now requires a decision.** The persona's HITL discipline reads "必须用 ask_user_question 向用户确认并说明取舍理由；用户未表态时按未获批处理" instead of permitting an explanation as the alternative to confirmation.

## Alternatives considered

**Keep the team as the default for complex cases and add more confirmation points inside it.** Rejected: the case type is the model's guess about the user's intent, and a guess is not a request. More checkpoints inside a flow the user never asked for make the flow longer, not more answerable; the measured sessions show what the waiting and the review rounds cost.

**Default `approveCreation` / `approveClosure` to `true` in the package.** Rejected: a package default decides for every deployment. A deployment that mounts no answerer would then refuse every team it ever tries to create — an opt-in confirmation turned into an outage, and precisely the fail-loud-at-first-use surprise a default should not create. The preset is the surface that owns this deployment's policy, which is how `qualityGate` is wired too.

**Gate more of the team's mutations — `add_member`, `remove_member`, `create_task`, `reassign_task`.** Rejected: the decision is one (does this team and this plan exist), so gating the plan's parts multiplies prompts without adding a decision, and a user asked four times in a row learns to click through. The plan is approved at creation, and the roster's later changes are the captain's to report.

**Gate closure but not creation.** Rejected: the roster is what a user would want to change, and a team that already exists with members already spawned cannot be meaningfully approved after the fact — the expensive part (spawning continuable subagents) has happened. Approval has to stand in front of the call that spends it.

**Fail open when no answerer is mounted.** Rejected: the switch would be inert on exactly the deployments that turned it on, and the confirmation would disappear without a trace. The deployment's precedent is fail-closed for the same reason (`patent-rule`'s delivery gate, and `dsh-user-approval`'s own contract that missing answerers return `unavailable`).

**Leave it as instructions.** Rejected: instructions are what shipped before this change. A model free to create the team is free to create it after explaining why, and the user's complaint was that its participation was too small — which no amount of prose fixes.

**Put the work-mode routing in a skill instead of the persona.** Rejected: routing is persona content under [the persona-placement note](../architecture/2026-10-12-persona-carries-identity-not-mechanics.md) — the persona carries identity, the disciplines, and the case-type routing, while mechanics move to the skill a routing line names. The team skill only loads once the team flow has been chosen, so the default-versus-opt-in choice has to be visible before that point.

## Consequences

- The two decisions cannot be taken without the user. A deployment that turns the switches on gets a refusal it cannot talk its way past, and one that leaves them off gets the same behaviour as before.
- A deployment that turns a switch on without an answerer fails loud at the first call (`unavailable`), not silently, and a deployment whose approval policy is `never` (the base bundle's `DSH_PERMISSION_MODE=danger-full-access` stance) rejects the same calls deterministically. The patent preset mounts an answerer: `dsh-user-approval` arrives with `packages/bundle/base/cordis.patch.yml` at `policy: ask`, and the web client composes the answering UI.
- The model sees a failed tool call for an ordinary refusal, so the persona and the skill both say not to retry it and to bring the plan or the closing statement to the user instead. Without that sentence, "the call failed" is exactly the state a model retries.
- `registerPatentTeamsTools(ctx)` becomes `registerPatentTeamsTools(ctx, options)`; `apply()` is the only caller, updated in the same change, and the package is pre-stable.
- The persona grew by 901 characters (9,276 → 10,177, measured on the merged tree), staying inside the 12,000-character ceiling `scripts/preset-mode-baseline.json` sets for the `patent` mode.
- Coverage: `packages/patent/patent-teams/tests/approval.spec.ts` pins the grant, each refusal outcome, the missing answerer, and an answerer that throws; `tests/tools.spec.ts` pins both tool gates for granted, refused, and switch-off; `packages/bundle/web-app/tests/patent-preset.spec.ts` pins the two preset rows and the persona/skill anchors, so a rewrite cannot make the team the default again or drop an enforcement row while the prose keeps claiming it.

## Deferred

Only `patent_teams_create` and `patent_teams_delete` are enforced. Stage-output review, per-round reporting, and the strategy decisions stay instructions in the skill, because the plugin has no per-round notion: a second render in the same session does not ask again, and neither does a member's task completion. A turn-scoped ledger — the shape `patent-rule`'s delivery gate uses for its own prerequisites — would be the way to enforce per-round review if the instructions prove insufficient in practice.
