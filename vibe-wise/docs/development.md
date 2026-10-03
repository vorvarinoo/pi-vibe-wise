# Development

> Port of the vibe-wise Claude Code plugin (v0.1.43) to a pi-coding-agent package.
> See `PLAN.md` at the repo root for the full port plan and review trail.

## Status

| Milestone | State |
| --- | --- |
| M1 Scaffolding & infra | done |
| M2 State library (`lib/`) | done — reviewed, mandatory fixes applied |
| M3 Skills (prose port) | not started |
| M4 Extension boot + injection | not started |
| M5 Reset tool (full flow) | not started |
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

`npx vitest run` on Windows: **47 passed, 3 skipped** (50 total) — `lib/` behaviour is
covered by three files (`state-pointer.test.ts` 29, `reset.test.ts` 19, `smoke.test.ts` 2).
`buildPointer` currently measures **962 bytes** for a realistic plugin root (bound: ≤ 1100).

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
