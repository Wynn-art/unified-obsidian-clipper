# Growth Chat Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent service task, with task and final review. UI and integration are coordinated in this session. Preserve the original checkout until all verification is complete.

**Goal:** Video-grounded Chinese dialogue, manual client handoff, and conditional Obsidian growth reports.
**Architecture:** Pure core helpers and a versioned storage/service layer; a dedicated trusted worker message adapter; an independent panel controller; existing save pipeline extended with an optional third artifact.
**Tech Stack:** Vanilla extension JavaScript, chrome.storage.local, existing DeepSeek requestAiCompletion, Node tests; no new dependencies.
**Spec:** docs/superpowers/specs/2026-08-31-growth-chat.md

## Global Constraints

Use the accepted client-assisted scope, not the earlier Gemini API design. No raw attachment uploads. Preserve settings and logo. Video isolation, cancellation, one response per runtime message, no report for zero completed turns, per-artifact retry are mandatory. Never expose credentials or insert untrusted HTML. Original Downloads directory requires final scoped write approval; develop in the isolated copy.

## Task 1 — Conversation core and service

Files: youtube/growth-core.js, youtube/growth-service.js, tests/growth-service.test.js.
- [x] Write failing tests for empty-report short circuit, imported sources not counting as a dialogue, completed pair persistence, contextual prompts, clear/cancel/stale responses, revision cache invalidation, report required action fields and complete appendix.
- [x] Run node --test tests/growth-service.test.js and verify failure.
- [x] Implement pure validation/prompt/render helpers and service factory with injected storage/model, per-video job cancellation and mutation serialization; matching API contract supplied in task brief.
- [x] Run tests, self-review and independently review this bounded task.

## Task 2 — Trusted runtime adapter and panel

Files: youtube/growth-background.js, youtube/growth-panel.js, youtube/growth-panel.css, youtube/sidepanel.html, youtube/sidepanel.js, youtube/background.js, background.js, core-background.js; tests/growth-panel.test.js and worker-integration tests.
- [x] Test namespace dispatch/trusted sender rejection and abort propagation; implement an adapter with get/import/remove/send/cancel/clear/report actions.
- [x] Add optional AbortSignal to existing requestAiCompletion while retaining existing timeout/body protocol tests.
- [x] Implement bottom details panel, draft text, message list, stop/retry, copy client prompt, material import form, report preview, clear confirmation.
- [x] Wire video lifecycle and invalidation with captured video generation; test stale callbacks and empty dialogue.
- [x] Exercise real panel DOM in browser using synthetic API responses; no real keys or external model calls.

## Task 3 — Optional report artifact

Files: youtube/background.js, youtube/sidepanel.js, youtube/obsidian.js; worker/save integration tests.
- [x] Write tests for unchanged no-report saves, optional report path and link, malformed report rejection, partial failures and exact retry selection.
- [x] Freeze video/context/conversation snapshot before generation; include report content in save identity and preserve prepared result through retries.
- [x] Add conditional third write with independent files.report flag. Existing report files are not deleted by no-dialogue saves.
- [x] Verify user-visible progress/success/partial-failure text accurately names saved artifacts.

## Task 4 — Verification and delivery

- [x] Run full npm test and npm run check; independently review feature against baseline and fix material findings.
- [x] Update README/spec with actual usage/limits and manual attachment workflow; version 0.2.0.
- [x] Package, verify ZIP assets and unchanged logo; back up original 0.1.3.
- [ ] Hash-check original baseline and staged changes, apply only reviewed changes with final filesystem approval.
- [ ] Recheck original and provide reload steps, package path and honest real-model testing limits.
