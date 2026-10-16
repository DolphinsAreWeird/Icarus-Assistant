# Icarus remediation plan

Started 16 October 2026 (Bangkok). Baseline: `main` at `b2b879f`.
Source brief: [SUMMARY.md](SUMMARY.md).

## Working agreement

- Implement on `main`, as requested. SOL 6.1 Medium agents own separate issues; SOL 6.1 High independently reviews the changes.
- Read the relevant Markdown before code. Avoid simultaneous edits to the same files.
- The orchestrator alone updates this plan and performs Git staging/commits. Each resolved issue gets its own commit containing its checked item and validation evidence.
- A checked item means implemented, regression-checked and independently reviewed. Record unavailable external checks honestly.
- Preserve tap-only simulated purchases, exact monetary amounts, labeled reference data and existing supported demo flows.
- Keep credentials private. Use fake audio/offline data for automated checks. No publishing or live money movement is part of this remediation.

## Issue checklist

- [x] **I01: Preserve decimal purchase amounts.** Keep requested, spoken, displayed and executed amounts equal; regress 1000.49/1000.50 and boundaries.
- [x] **I02: Suppress unsupported generated financial figures.** Reject unsafe text before display, speech, history and caching; retain grounded tool output.
- [ ] **I03: Ground legacy trade arguments.** Require the user's purchase intent, asset, side and amount before producing an actionable preview.
- [ ] **I04: Isolate cached contextual answers.** Prevent reuse across users, sessions or different relevant conversation histories.
- [x] **I05: Preserve reviewed server preview terms.** Carry preview identity/terms into native review; never silently create and execute an unseen replacement.
- [x] **I06: Protect public administrative reset.** Public visitors cannot globally reset other accounts or previews.
- [x] **I07: Make QA failures enforceable.** High-severity scans and failed phone confirmation must produce failing run/exit status.
- [ ] **I08: Separate hosted request budgets.** Avoid shared-IP starvation of account reads and confirmations; test multiple visitors and bursts.
- [ ] **I09: Refresh and age visible market data.** Old observations cannot remain labeled live; cover idle/focus/reconnect and quote-review interactions.
- [ ] **I10: Align launcher engines and readiness.** Explicit engine choice, accurate health/readiness, failed backend startup/hang checks.
- [x] **I11: Settle failed fallback speech.** Clean up and settle every terminal playback outcome while keeping interrupted read-back unapproved.
- [ ] **I12: Fix Windows build/fake startup.** Portable npm invocation, nonzero spawn failure and cross-platform fake-mode launch.
- [x] **I13: Refresh dashboard after ring rollover.** Detect replacement events when event count remains 400; retain truthful browser-local analytics labeling.
- [ ] **I14: Repair documentation and claims.** Correct stale run paths, historical handoffs, six broken links, data-locality wording and demo scope. Do not fabricate a live URL, deck or human review.
- [ ] **I15: Restore reproducible validation.** Install locked JS dependencies/browser tooling, run Python/JS suites, typechecks/builds and meaningful offline browser coverage for both engines where feasible.
- [ ] **I16: Final independent review and regression sweep.** Resolve review findings, verify clean issue commits, record remaining external checks and commit the final ledger.
- [ ] **I17: Prepare Vercel hosting.** Prefer Vercel over GitHub Pages for the web app; provide tested routing/build configuration for the existing API service and document the stateful backend requirement. Do not claim an untested serverless migration or fabricate a deployed URL.

## Commit and verification ledger

The issue's commit subject identifies its checkpoint. Hashes will be collected after each commit and in the final ledger.

| Issue | Commit / verification | Independent review |
|---|---|---|
| Planning | `760038d`: initial remediation checklist and reviewed baseline | Pending implementation |
| I01 | `fix: preserve decimal purchase amounts`: 107 frontend tests, typecheck and build passed; 17 new mounted amount regressions | SOL 6.1 High approved; independently reran 17 regressions |

| I06 | `fix: block global reset on public demo proxy`: 54 voice tests and typecheck passed; encoded paths/local reset covered | SOL 6.1 High approved; independently reran 22 proxy regressions |

| I05 | `fix: confirm only the reviewed server purchase preview`: 115 frontend tests, typecheck and build passed; expiry, repricing, retries and edited-order regressions | SOL 6.1 High approved; independently reran 53 purchase tests |

| I02 | `fix: suppress ungrounded bilingual financial figures`: 275 full pinned backend tests passed; 175 focused guard tests, including English/Thai digit and spelled amounts, voice/history/cache | SOL 6.1 High approved after bilingual bypass corrections; independently reran 175 tests |

| I07 | `fix: make QA scan and phone confirmation failures fail the run`: 9 node:test gate tests (high finding → FAIL + exit 1, phone confirm hard check, thrown step), `node --check` on changed .cjs, `--help` exit 0, unstartable run exit 2. No browser run (Playwright browsers absent) | Opus 5.5 High approved after fixes (deduplicated high findings in report, phone fallback data, README exit codes) |

| I13 | `fix: refresh dashboard after event ring rollover`: 128 frontend tests (6 rollover/label/malformed/clear/unmount), typecheck and build passed; rollover tests fail on old HTML | Opus 5.5 High approved after fixes (junk entries, truthful footer, "Clear local events") |

| I11 | `fix: settle failed fallback speech`: 9 settle regressions (double TTS/fallback failure, interrupted and failed read-back stay unapproved, mid-stream provider drop handed to fallback), 168 focused controller/confirm/barge-in tests, voice typecheck passed | Opus 5.5 High approved after fixes (stale-handle result ignored, speakingEnd on fallback error) |

## Execution notes

Two implementation agents can work concurrently on disjoint areas while the High reviewer checks completed patches. The orchestrator handles setup and integration checks and serializes commits. Agents report their exact changed files and stop editing before review/commit.

I15 setup starts immediately so regressions can run during implementation. Browser evidence, package versions and limitations will be recorded here rather than inferred from historical counts.

Hosting steering: the user prefers GitHub or Vercel, whichever is easier. GitHub Pages serves static files; Vercel can host the web app and proxy its API routes. The current Python process stores accounts/previews in memory, so deploying it as independently scaling functions would lose confirmation/session guarantees without a shared-state redesign. Preserve the existing API service boundary and prepare Vercel configuration first; document any account/service requirement precisely.

## External completion checks

These stay pending until the relevant real-world evidence is available; they do not block agent-owned fixes:

- [ ] Real microphone/speaker rehearsal on presentation hardware, including Thai/English, interruption and tap-only confirmation.
- [ ] Native Thai/financial-language review and 3–5 unfamiliar hallway participants.
- [ ] Verify an existing authorized hosted URL and accessible deck, or obtain account/file access if absent.
- [ ] Live-provider and container/deployed-host checks where credentials/runtime access are available.

Partner-wide analytics, production account/custody integration and a nonexistent U-Bot API remain outside the demonstrated feature scope. Fix the existing dashboard rollover and clearly state its actual coverage.
