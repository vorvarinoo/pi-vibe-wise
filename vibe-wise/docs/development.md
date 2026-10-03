# Development

> Port of the vibe-wise Claude Code plugin (v0.1.43) to a pi-coding-agent package.
> See `PLAN.md` at the repo root for the full port plan and review trail.

## Status

| Milestone | State |
| --- | --- |
| M1 Scaffolding & infra | done |
| M2 State library (`lib/`) | done — reviewed, mandatory fixes applied |
| M3 Skills (prose port) | done — reviewed, no drift found |
| M4 Extension boot + injection | done — reviewed; one blocker fixed (see M3+M4 review log) |
| M5 Reset flow integration verification | done — tool-level edge cases + manual TUI checklist |
| M6 Compaction survival + observability | done — seam tests + bounded integration tests (skip-on-hang) |
| M7 Docs, README, install prep | done — README/CHANGELOG/LICENSE/package metadata + install smoke test |

## Spike results (M1)

### R9 — Node floor / `fs.renameSync` overwrite

- Verified on the actual dev runtime (node v22.23.2, win32): `fs.renameSync(src, dst)`
  **overwrites an existing destination file** (POSIX-rename semantics), matching
  Python's `os.replace`. No `EEXIST`.
- `engines.node` finalized as `">=20"`: `lib/` uses only `node:fs`/`fs/promises`,
  `node:path`, `node:crypto`, `TextDecoder` (fatal UTF-8) — all available at Node 20.
  No runtime feature requires 22.

### R16 — does Pi scan `extensions/tools/` when the manifest points at one file?

- Verified against the installed Pi 0.84.1 source
  (`dist/core/package-manager.js`, `resolveExtensionEntries()` /
  `collectAutoExtensionEntries()`):
  when a package's `package.json` has `pi.extensions`, each manifest entry is resolved
  **exactly as given**; recursive directory scanning only happens when there is no
  manifest (conventional discovery). Therefore `extensions/tools/*.ts` will NOT be
  loaded as separate extensions — the single-file manifest is safe, and no
  `lib/tools/` fallback is needed.

## Dev commands

```bash
cd vibe-wise
npm install
npx tsc --noEmit
npx vitest run                    # fast, hermetic: unit + seam tests

# opt-in: boots the real pi runtime against a temp fixture (needs a live provider)
VIBE_WISE_INTEGRATION=1 npx vitest run tests/integration.test.ts
```

## Review log — M1+M2

Independent review found three mandatory issues; all are fixed and each fix is now
pinned by a test that fails on the old behavior:

1. **`resetNotes()` accepted a relative `cwd`.** `path.resolve()` ran *before* the
   `isAbsolute` check, so the check was dead and `resetNotes(".")` silently reset the
   process cwd. Now the raw input is validated first, matching `reset.py`.
   Pinned by `reset: fingerprint binding > relative or non-existent cwd is rejected
   before any resolution`.
2. **Symlink tests "passed" instead of skipping.** They used `console.warn(...); return;`,
   which vitest reports as a pass, inflating the green count and masking regressions.
   Now they call `ctx.skip(reason)`: real skips, visible in the reporter.
3. **No test for a plain-file candidate.** The rule "an existing but invalid candidate
   returns `null` immediately, never a parent fallback" (§6.1) was only reachable via
   symlinks, which cannot be created on Windows without Developer Mode. Now covered
   symlink-free by `stateDirectory > plain FILE named .vibe-wise -> null, no fallback
   to parent notes`.

Additionally, the duplicate state-directory walker in `lib/reset.ts` was removed:
`stateDirectorySync()` now lives next to `stateDirectory()` in `lib/state-directory.ts`
and both walkers share the `decideCandidate()` / `isGitBoundary()` helpers, so the
§6.1 rules cannot drift between the sync and async paths.

### Mutation coverage of the M2 core (verified locally)

| Mutation | Caught by |
| --- | --- |
| `.git` checked before state dirs (the `[P1]` bug) | 4 tests, incl. `co-located .git + .vibe-wise: state wins (check order)` |
| invalid candidate climbs to a parent instead of `null` | `plain FILE named .vibe-wise -> null, no fallback to parent notes` |
| `stat` instead of `lstat` for the candidate (follows links) | 4 symlink tests |
| missing `profile.md` treated as active | `profileIsActive > missing file -> false (NOT active)` |
| paused regex loses its anchors | `paused as substring of a longer line does NOT pause` |
| pointer leaks note content | `does not leak note contents (Δlength === 0 with 100KB notes)` |
| one byte changed in `FRESH` | `FRESH templates are byte-identical to the original reset.py` |
| fingerprint drops the identity component | `fingerprint covers identity, missing files, and content` |
| `renameSync` replaced by `writeFileSync` | `backs up only notes ... foreign files untouched`, `partial state and repeated resets preserve each backup` |
| writing allowed in the preview branch | 6 tests, incl. `preview and cancel leave notes untouched` |
| no `isAbsolute` check on the raw `cwd` | `relative or non-existent cwd is rejected before any resolution` |

## Test coverage

`npx vitest run` on Windows: **81 passed, 5 skipped** (86 total) — `lib/` behaviour
(`state-pointer.test.ts` 29, `reset.test.ts` 19, `smoke.test.ts` 2), the
extension layer (`extension.test.ts` 34: handlers with fake ctx, tool_result
marker, the three tools' fallback/cancel/confirm/no-write semantics, M5 reset
cases, and the M6 compaction seam), and `integration.test.ts` (2 real headless
pi runs, **opt-in**; skipped by default with an explicit reason).
`buildPointer` measures **962 bytes** from the package root (bound: ≤ 1100).

Remaining skips are platform- or environment-limited, not unimplemented:

1. `profileIsActive > symlinked profile is not read` — needs a **file** symlink.
2. `reset: fingerprint binding > non-regular notes rejected` — same.
3. `reset: backup dir mode is 0o700 on POSIX` — NTFS does not apply POSIX modes.
4. both `integration.test.ts` tests when the `opencode-go` provider hangs
   (explicit `ctx.skip("provider did not respond within 90s …")` — loud, never
   a silent pass; see *M6 integration tests* below).

## Windows notes

- **Symlink fixtures use junctions.** A real Windows symlink needs Developer Mode or
  admin rights, but a **junction** is creatable by a normal user and `lstat()` reports it
  exactly like a symlink (`isSymbolicLink() === true`, `isDirectory() === false`), which
  is the property under test — including links to a missing target. `makeSymlinkOrSkip()`
  therefore tries a real symlink first, then falls back to a junction for directory
  targets. This is why only the two **file**-symlink cases still skip here. Run the suite
  on POSIX at least once before release to cover those.
- **Junctions are not POSIX symlinks.** They are directory-only and always absolute;
  semantics that depend on `realpath()` resolution are not exercised by them. The port
  never calls `realpath()` for these decisions (matching the original), so the risk is
  limited to the two skipped file-symlink cases.
- EOL: the repo sets `core.autocrlf=false` and `.gitattributes` `* -text`. The reference
  files under `_source/` are CRLF on disk; every ported template literal must use `\n`
  escapes exactly as the Python source does. Tests assert `not.toContain("\r")`.

## Known deviations from the original

- **UTF-8 BOM.** `lib/profile.ts` decodes with `TextDecoder`, which strips a leading BOM,
  so `\uFEFFLearning mode: paused` is treated as paused. Python's `open(encoding="utf-8")`
  keeps the BOM, so the original would read that line as *not* paused and keep learning
  active. This is deliberate (§9.2 asks for BOM tolerance) and pinned by
  `BOM and CRLF are tolerated; unicode survives`.
- **Fingerprint string form.** The port uses `JSON.stringify([name, hex])` (no space after
  the comma) where Python's `json.dumps` emits `", "`. The digest is therefore not
  byte-equal to Python's for the same state. Tokens are never exchanged between the two
  implementations, so this is internal-only; do not use a fingerprint produced by one
  runtime to confirm a reset in the other.

## M4 runtime facts (pi 0.84.1, verified in dist)

These shape the extension layer and must be re-checked on any Pi upgrade:

1. **`AgentToolResult` has no `isError` field.** The runtime marks a tool result as an
   error only when `execute()` throws — and then replaces `details` with `{}`
   (`createErrorToolResult` in `pi-agent-core/dist/agent-loop.js`), which would lose the
   fallback/error payloads. The tools therefore return normal results carrying
   `details.vibeWiseIsError`, and a `tool_result` extension hook flips `isError` per call
   while keeping details intact (`agent-session.js`:
   `isError: hookResult?.isError ?? isError`).
2. **`ctx.ui.select` takes plain strings** (`types.d.ts:70`), not `{label, description}`
   objects (that's the `ctx.ui.custom()` example territory). Descriptions are folded in
   as `label — description` and mapped back by exact match (`extensions/tools/shared.ts`).
3. **`/skill:` is a TUI command.** In `--mode json`/print it is not expanded; the literal
   text goes to the model. Skills with `disable-model-invocation: true` are also hidden
   from the model's skill list. Activation paths: TUI `/skill:...`, or the injected
   pointer telling the model to Read the skill file (the original plugin's semantics).
4. **Skills are validated at load.** `core/skills.js` enforces name charset/length and
   `description` ≤ 1024, emitting diagnostics for violations. Both package skills parse
   with **zero diagnostics** (checked with Pi's own loader); a deliberately broken skill
   produces a warning, confirming the check works.
5. **pi dev-types must match the runtime.** npm resolves the `peerDependencies: "*"` of
   this package to the latest published pi (1.0.0 added `outputSchema`, `exposure`,
   `namespace` to `ToolDefinition`), while the installed CLI is 0.84.1. The dev deps are
   pinned to `0.84.1` (`--save-exact`) so `tsc` cannot validate APIs the runtime lacks.
   Re-pin after a CLI upgrade.

## M4 spike — injection verified end-to-end (headless)

The injected system prompt is not observable in the session JSON stream, so the
extension appends a `vibe-wise-injected` custom entry under
`VIBE_WISE_DEBUG_ENTRY=1` (`pi.appendEntry` → wire event `entry_appended`).

```bash
# fixture with .vibe-wise/profile.md = "Learning mode: active\nOnboarding: complete\n"
cd /tmp/vw-active && VIBE_WISE_DEBUG_ENTRY=1 timeout 180 \
  pi -p -a --mode json -e <abs>/vibe-wise/extensions/index.ts "reply with the single word ok"
# => entry_appended {customType: "vibe-wise-injected", data: {stateDir: ...\\.vibe-wise, pointerLength: 999}}

# same fixture but profile = "Learning mode: paused\n..."  =>  0 matches
```

Result (re-verified by the parent, not only by the worker): active fixture → **exactly 1**
`entry_appended` with `pointerLength: 999` (the value tracks the fixture path length;
1007 was measured for a longer temp path); paused fixture → **0** hits; without state, none.

**Caveat — the model stage intermittently hangs here.** `opencode-go` sometimes never
returns from the provider call (the run then ends via `timeout`, `rc=124`), and sometimes
answers normally: a later re-run finished with **rc=0, empty stderr, 1 injection**. So the
spike is usable, but do not script it as a hard CI gate — retry on `rc=124`. The
mechanism evidence is unaffected either way, because `before_agent_start` (and therefore
the debug entry) runs *before* the provider request. What still needs a human eye is the
second half — that the model *acts on* the pointer — which stays a manual TUI step (M5/M6).

## Review log — M3+M4

Verdict: **accepted with mandatory fixes** — one blocker, fixed here.

**Blocker: `vibe_wise_reset` contradicted its own contract.** The first implementation
collapsed the two-step flow: a call *without* `confirmation` (documented as a read-only
preview) showed the confirm dialog and committed in one go, while a call *with*
`confirmation` committed **silently** with no dialog at all. Since the fingerprint is a
deterministic sha256 over readable note bytes, the second path meant "reset without any
consent" — contradicting PLAN §4.4/§5.3, `reference.md`, `SKILL.md`, and the tool's own
`description`.

Fixed to the strictly two-call model:

1. no `confirmation` → **read-only preview**: no dialog, no writes, `backups/` not even
   created; returns the paths + fingerprint for the model to present in chat;
2. `confirmation` → fingerprint re-checked *first* (stale token refused before any
   dialog), then the tool's own `ctx.ui.confirm`; only explicit approval commits, Cancel
   leaves every byte untouched.

The mismatch message is now a single exported constant in `lib/reset.ts`
(`FINGERPRINT_MISMATCH_MESSAGE`) so the tool and the ported helper cannot drift apart.
`extensions/README.md` and `skills/vibe-wise-reset/reference.md` were updated to match.

### Mutation coverage (verified locally, each mutant reverted afterwards)

| Mutation | Result |
| --- | --- |
| `session_start` no longer drops the cache (stale pointer after `/resume`) | **caught** by the new cross-cwd test (this was the reviewer's coverage gap) |
| preview branch disabled (fused preview → dialog + commit) | **caught** |
| Cancel no longer blocks the commit | **caught** |
| pointer injected while `paused` | caught (2 tests) |
| profile read error rethrown instead of swallowed | caught |
| `vibe_wise_ask` returns success instead of a fallback result without UI | caught |
| `vibe_wise_reset` writes on disk when `hasUI === false` | caught |

### Accepted deviations (reviewer assessed both as fine or better for v1)

- `vibe_wise_reset` wired fully in M4 instead of stubbed — agreed, provided the consent
  model above holds.
- `vibe_wise_questionnaire` as a sequential `ui.select` loop instead of a
  `ctx.ui.custom()` component — judged *better* for v1 (same UX, less bespoke surface).

### Residual risk

Real TUI interaction of the tools (`ui.select`/`ui.confirm` + the `tool_result` isError
flip) is covered at unit level and against the 0.84.1 sources, but not end-to-end through
a live model turn while this provider hangs. M5 must keep the manual TUI run (preview →
confirm → commit → Cancel) as a required step.

## M3/M4 deviations from PLAN

- **`vibe_wise_reset` fully wired in M4** (plan: stub in M4, full in M5). The reviewed
  `lib/reset.ts` was already complete; a stub would be strictly less safe. M5 becomes
  integration verification.
- **`vibe_wise_questionnaire` is a bounded sequential `ui.select` loop**, not a
  `ctx.ui.custom()` TUI component (plan §4.4). Same one-question-at-a-time UX, far less
  bespoke TUI surface; documented in the tool's docstring.
- **Prose port (M3)** is 1:1 with exactly one sanctioned divergence: the picker call
  (`AskUserQuestion` → `vibe_wise_ask`), spelled out in `behavior.md` and
  `onboarding.md` with the tool's real signature and the non-UI fallback rule. The
  line-level diffs are in the milestone report; `state-templates.md` is verbatim.

## M5 — reset-flow integration verification (done)

The reset tool was already fully wired in M4 (see deviations below), so M5 became
tool-level verification of the consent contract and its edge cases. All cases live in
`tests/extension.test.ts` and drive the real registered tool (`registerVibeWiseReset`
against a fake `pi`, `ctx` with a counting `ui.confirm`):

| Case | Pinned behaviour |
| --- | --- |
| tool preview | returns `project` / `state` / `files` / `backup_parent` / `confirmation`; the text carries the paths for the chat message; `ui.confirm` calls === 0; note bytes identical; `backups/` not created |
| `no_notes` via tool | friendly text, `status: no_notes`, non-error marker, zero dialogs, state dir still empty |
| commit with a **foreign** fingerprint | refused with `Target or notes changed…`, dialog **not** shown, both projects byte-identical, no `backups/` anywhere |
| note vanishes between preview and commit | refused with the **exact** `FINGERPRINT_MISMATCH_MESSAGE` (single-sourced from `lib/reset.ts`), dialog not shown, remaining notes untouched |
| `cwd` param | relative `cwd` rejected before resolution (`Use an existing absolute project working directory.`); an explicit absolute cwd of another project is honored — reset happens there, `ctx.cwd`'s project is never touched |
| stale confirmation (existing test) | now also asserts `confirm` was never called: the refusal must happen **before** the dialog |

### Manual TUI verification (required before release)

Cannot be automated in this environment (no TTY); the checklist below must be executed
once in an interactive `pi` session before shipping:

1. In a project with an **active** `.vibe-wise/profile.md`, run `/skill:vibe-wise-reset`.
2. The model calls `vibe_wise_reset` **without** `confirmation` → the tool must show **no
   dialog** and reply with a preview: state dir path, the three note paths, the
   `backups/` location, and the fingerprint.
3. The model shows those paths in chat and asks to proceed (SKILL step 2).
4. Say yes → the model calls the tool again **with** the preview's fingerprint → the
   tool's own dialog appears (`Reset VibeWise learning for …`).
5. Choose **Cancel** → the tool replies `User cancelled…`; verify in the shell that all
   three note files still have their original bytes and that `.vibe-wise/backups/` does
   **not** exist.
6. Call the reset skill flow again, this time approve the dialog → notes become the FRESH
   templates (`profile.md` contains `Onboarding: incomplete`), and
   `.vibe-wise/backups/reset-<UTC>-XXXX/` contains the original bytes.

## M6 — compaction survival + observability (done)

### Compaction survival — verified at the seam and in the 0.84.1 sources

Unit seam (`tests/extension.test.ts`, "compaction survival (M6, seam-level)"):
`session_start(startup)` → `before_agent_start` → **no session event at all** (this is
exactly what `/compact` produces) → `before_agent_start` again ⇒ the second pointer is
byte-identical and still present; a separate test asserts `extensions/index.ts`
registers **no** `session_before_compact` / `session_compact` handler.

Source verification (`@earendil-works/pi-coding-agent` 0.84.1, `dist/core/agent-session.js`):

- The `/compact` command (`core/slash-commands.js:21`) calls `compact()` at
  `agent-session.js:1367`, which emits only `compaction_start` (:1370) / `compaction_end`
  (:1459; the failure path emits it again at :1472) plus — **only if some extension has a
  handler** — `session_before_compact` (:1389) and `session_compact` (:1441). It never
  emits `session_start` or `session_shutdown`.
- `session_start` is emitted only on session (re)creation (`agent-session-runtime.js:141,
  165, 211, 229, 246, 283`) and on `/reload` (`agent-session.js:2072`).
  `session_shutdown` accompanies `/reload` (`agent-session.js:2055`) as well as ordinary
  runtime teardown / exit (`agent-session-runtime.js:107,290`) — none of which `/compact`
  triggers.
- The `ExtensionRunner` (and therefore our handler closures and the state cache) is
  created once per session (`agent-session.js:2037`) and is **not** rebuilt by compaction.

Consequence: our extension gets **zero** callbacks from `/compact`; the cache survives;
the next `before_agent_start` re-injects the same pointer. No compaction handler is
needed — this is now pinned by a test, not just by a comment.

### M6 integration tests (bounded headless runs)

`tests/integration.test.ts` boots the real packaged extension in the real CLI
(`node <local dist/cli.js> -p -a --mode json -e <extensions/index.ts>`, provider
`opencode-go`):

- **active** fixture → on success: exactly **one** `entry_appended` with
  `customType === "vibe-wise-injected"`, `stateDir` pointing at the fixture's
  `.vibe-wise`, and `800 < pointerLength ≤ 1100` (measured 999 for short fixture paths);
- **paused** fixture → zero such entries;
- per-run kill at 90 s (cold start measured > 70 s, warm ~17 s) → on hang the test calls
  `skipCtx.skip("provider did not respond within 90s (run killed); …")` — a loud,
  reported skip, never a silent pass; at most two pi invocations per suite; async
  `spawn` (a blocking `spawnSync` froze the vitest worker's RPC loop —
  `Timeout calling "onTaskUpdate"`), temp fixtures removed in `afterAll`.
- The spawn uses the repo's **pinned local** pi (0.84.1, resolved from
  `node_modules`), not whatever `pi` happens to be on `PATH`.
- **Opt-in.** The file only runs with `VIBE_WISE_INTEGRATION=1`; otherwise both tests
  skip with an explicit reason. Reason for the default: while the provider hangs, the two
  90 s kills made `npx vitest run` a **3-minute** command that proved nothing — that
  discourages running the suite at all. With the flag the same run answers in ~17 s when
  the provider is healthy. `VIBE_WISE_INTEGRATION_TIMEOUT_MS` overrides the 90 s cap.
  The `pi.appendEntry` passthrough in `extensions/index.ts` that this file uniquely
  pins at runtime is **additionally** guarded by a source-assert unit test (see the
  M5+M6 review log), so the wiring is not lost silently between opt-in runs.
  Run before release: `VIBE_WISE_INTEGRATION=1 npx vitest run tests/integration.test.ts`.

## Review log — M5+M6

Verdict: **accepted**, no blocking findings (chain runtime 45m28s: worker ~34m + reviewer).

What the reviewer verified independently:

- Gates reproduced exactly: `tsc --noEmit` clean; **80 passed / 5 skipped** (85 total
  at review time; 81/86 after the post-review source-assert below).
- **All 5 mutations were caught** (each applied to a temp copy, reverted afterwards):
  1. fused flow (preview shows the dialog AND commits) → preview test + 2 others fail;
  2. dialog before the fingerprint check → fingerprint test (assert `confirm === 0`);
  3. passed `cwd` ignored → `cwd param` test;
  4. commit on `no_notes` → `no_notes via the tool` test;
  5. `pi.appendEntry` removed from `extensions/index.ts` → integration test
     (a loud **skip**, not a green, because the provider was hanging).
- Integration tests skip loudly (never a silent pass) when the provider hangs; at most
  two pi invocations per suite; temp fixtures removed in `afterAll`.
- Compaction citations checked against the installed 0.84.1 dist line by line.

Non-blocking doc inaccuracies found and fixed in the same pass (every citation
re-verified against dist afterwards):

- `compaction_end` was cited as `:1453` — it is **:1459** (failure path :1472);
- `session_shutdown` "only on `/reload`" was over-stated — the runtime also emits it on
  teardown/exit (`agent-session-runtime.js:107,290`).

Post-review adjustments by the parent (transparent, after the accepted verdict):

1. **`tests/integration.test.ts` is now opt-in** (`VIBE_WISE_INTEGRATION=1`). While the
   provider hung, the two 90 s kills made `npx vitest run` a **3m02s** command that
   proved nothing; the default suite is now **~2.8 s** (same 81/5 result, gate is green
   and cheap enough to actually run). Default behaviour is a loud skip with the reason.
2. **The coverage hole that opt-in creates is closed deterministically:** a source-assert
   unit test pins the `pi.appendEntry` passthrough and its wiring into
   `createBeforeAgentStartHandler` in `extensions/index.ts`. Verified by mutation:
   removing the passthrough fails that test.
3. `injectedEntries()` parses stdout tolerant-with-context instead of a bare
   `JSON.parse` (a timeout-kill-truncated line would have surfaced as an opaque
   SyntaxError).
4. The two doc inaccuracies above.
