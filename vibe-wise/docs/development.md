# Development

> Port of the vibe-wise Claude Code plugin (v0.1.43) to a pi-coding-agent package.
> See `PLAN.md` at the repo root for the full port plan and review trail.

## Status

| Milestone | State |
| --- | --- |
| M1 Scaffolding & infra | done |
| M2 State library (`lib/`) | done — reviewed, mandatory fixes applied |
| M3 Skills (prose port) | done |
| M4 Extension boot + injection | done — spike verified (entry_appended active/paused) |
| M5 Reset tool (full flow) | partially done — the tool is fully wired in M4 (see deviations); M5 = integration verification |
| M6 Compaction survival + observability | not started |
| M7 Docs, README, install prep | not started |

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
npx vitest run
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

`npx vitest run` on Windows: **72 passed, 3 skipped** (75 total) — `lib/` behaviour
(`state-pointer.test.ts` 29, `reset.test.ts` 19, `smoke.test.ts` 2) plus the
extension layer (`extension.test.ts` 22: handlers with fake ctx, tool_result
marker, and the three tools' fallback/cancel/confirm/no-write semantics).
`buildPointer` measures **1007 bytes** from the real package root (bound: ≤ 1100).

Remaining skips are platform-limited, not unimplemented:

1. `profileIsActive > symlinked profile is not read` — needs a **file** symlink.
2. `reset: fingerprint binding > non-regular notes rejected` — same.
3. `reset: backup dir mode is 0o700 on POSIX` — NTFS does not apply POSIX modes.

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
cd /tmp/vw-fixture-active && VIBE_WISE_DEBUG_ENTRY=1 \
  pi -p -a --mode json -e <abs>/vibe-wise/extensions/index.ts "reply with the single word ok"
# => entry_appended {customType: "vibe-wise-injected", data: {stateDir: ...\\.vibe-wise, pointerLength: 1007}}

# same fixture but profile = "Learning mode: paused\n..."  =>  0 matches
```

Result: active fixture → **1** `entry_appended`; paused fixture → **0**; both
runs exit 0 in ~8 s with empty stderr. Without the extension loaded, or with
no state directory, no entry is emitted either.

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
