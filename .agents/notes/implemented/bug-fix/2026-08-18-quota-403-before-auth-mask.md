# Agent Note: Quota 403 classified as QUOTA before the AUTH mask

Status: implemented

English | [中文](2026-08-18-quota-403-before-auth-mask.zh.md)

## Problem

A provider 403 with quota wording — Kimi's "You've reached your usage limit for this billing cycle" is the case that surfaced it — was classified as `AUTH`, and the client then projects every `AUTH` failure as "API key is invalid" to keep provider auth wording (which may echo a credential) out of the GUI. The user sees "API key is invalid" when the real condition is an exhausted account quota, with the actionable reason buried in the session log. Two compounding gaps caused it: `httpErrorCode`/`classifyPiAiError` mapped 401/403 to `AUTH` before checking quota wording, and `isQuotaExceededError` only matched noun-first phrasing ("usage limit exceeded"), missing verb-first phrasing ("reached your usage limit").

## Decision

Quota wording is checked before the 401/403 → `AUTH` mapping in both classifier sites (`llm-deepseek` `httpErrorCode` and `llm-pi-ai` `classifyPiAiError`): a 403 whose code/type/message matches `isQuotaExceededError` classifies as `QUOTA`, so the client projects the provider's real message instead of the generic auth copy. `isQuotaExceededError` additionally recognizes verb-first wording ("reached/exceeded/exhausted your usage limit or quota"). Non-quota 401 and 403 remain `AUTH` and keep the display mask: provider auth errors may echo a credential, and no concrete failing case justifies widening the code surface with a permission class.

## Alternatives considered

- **A dedicated `PERMISSION` code for every 403** — broader code-surface change (retry-policy membership, display, tooling) without a failing case beyond quota; rejected to keep the fix narrow.
- **Display-side-only change (show the real message for all `AUTH`)** — would re-expose provider auth wording that may echo credentials; the mask exists for that reason.

## Consequences

Quota-exhausted 403s now surface the provider's reason ("You've reached your usage limit…") in the turn error instead of "API key is invalid"; genuine 401s keep the masked copy. `QUOTA` was already outside every default retry set, so retry behavior is unchanged. Covered by unit tests at all three seams (quota wording, both classifiers, and the client projection) plus the existing e2e auth snapshot, which is a 401 case and stays green.
