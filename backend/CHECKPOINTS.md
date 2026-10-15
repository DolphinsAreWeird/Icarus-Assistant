# Backend checkpoints — 2026-10-16

This file records the first integration phase. The subsequent connected demo, latest committed model import, live gateway check and comparison with main are documented in [DEMO_HANDOFF.md](DEMO_HANDOFF.md).

## 1. Baseline and design — `42f9af4`

Created branch `backend` from `assistant-model` at `16ba286`, using `D:\Uhackathon\.worktrees\backend`. The original checkout stays on `assistant-model`; its uncommitted model edits were left untouched and are not included here. There was no branch literally named `model`.

Documented the model/backend boundary in DESIGN.md. Chose a local demo scope so authentication and hosting decisions do not block implementation.

## 2. Serving implementation — `4f76ea7`

Connected POST /chat to ConversationSession and SnapshotAdapter without editing model files. Added server-owned snapshots, Decimal account valuations including cash, bounded isolated conversations, rollback on failed turns, reset coordination, cache freezing, poll shutdown, request validation, and a compatible expanded response envelope. Kept legacy assistant selection and existing market/trade routes.

## 3. Verification and handoff

Added 25 integration cases, including scripted gateway tool calls, new snapshots across turns, rejected numerical hallucinations, unsupported holdings, stale FX, synthetic account/source labels, session isolation/TTL/capacity, concurrent requests/reset, rollback, malformed inputs, Thai/voice aliases and CORS from the actual frontend origin on port 8787. Updated environment examples and Windows run instructions.

Validation results:

- Backend: **108 passed** (83 existing + 25 new), via `python -m pytest -q --basetemp=.test-tmp/verified2`.
- Model: **61 tests run, 1 skipped**, via `python -m unittest discover -s model/tests -q`.
- `git diff --check`: clean.
- HTTP tests use FastAPI TestClient; gateway completions are scripted and exercise the real model tool loop. No live gateway call, external provider request, frontend browser session, deployment or real trade was performed.
- Installed test environment: Python 3.12.4, FastAPI 0.141.1, Starlette 1.6.0, httpx 0.28.1, pytest 9.1.1. The existing requirements pins were preserved; a clean environment installed from those pins was not tested. Two installed dependency deprecation warnings remain.
- The Windows sandbox prevented Python's event-loop socket pair from connecting. Running the test command with approved escalation resolved this; application tests then completed in about one second.

## Decisions to resolve together

1. Which authentication and account provider should replace the fictional users? How should real profile/account access be bound to sessions?
2. Which hosting target, durable store, retention policy and gateway model should be used? Until then use one process on loopback; gateway mode is opt-in.
3. Can the frontend supply exact displayed chart points plus screen_revision/display_version? Until then `/chart` is explicitly unavailable.
4. Is the existing USDT=USD conversion acceptable for the demo, and who approves the fictional profiles, fees and draft guidance? THB values are labeled approximate; gold is a PAXG proxy.
5. When should the model branch's unfinished edits be brought into this branch? This checkpoint intentionally uses its last committed interface.

No blocking question remains for this local backend integration. Nothing was pushed or deployed.
