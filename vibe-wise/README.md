# vibe-wise (Pi package)

> Learning mode for [Pi](https://github.com/badlogic/pi-mono): the agent asks for your
> approach first, examines tradeoffs, then writes the code of the chosen design and
> explains it. Progress is kept in local `.vibe-wise/` notes and restored across sessions.
>
> A port of the Claude Code plugin `vibe-wise` v0.1.43. Requires `pi-coding-agent`
> ≥ 0.84.1 (developed and verified on 0.84.1).

## Install

There is no npm/git publication yet — install from a local checkout of this
repository:

```bash
# global (user settings)
pi install /abs/path/to/vibe-wise

# or project-local (writes .pi/settings.json in the current project)
pi install ./vibe-wise -l -a
```

Verify and undo:

```bash
pi list -a               # shows the vibe-wise package (project-local entries need -a)
pi config                # both skills listed under Skills (interactive TUI)
pi remove /abs/path/to/vibe-wise
```

> Project-local installs require trust in non-interactive runs: without
> `-a`/`--approve` pi refuses with `Project is not trusted. Use --approve to modify
> local package config.`, and `pi list` hides project packages. In the interactive TUI
> pi asks for that trust itself. Global installs and removals need no `-a`.

## Usage

Two skills, driven from the interactive TUI:

- `/skill:vibe-wise-learn` — start or resume teaching-driven development;
- `/skill:vibe-wise-reset` — preview the notes, then wipe them (fingerprint-checked,
  with a backup).

Pickers and the confirmation dialog need an **interactive TUI**. In
`--mode json` / `--print` / rpc the tools refuse or degrade to a text prompt
instead of hanging or guessing an answer; teaching continues in chat.

## How context restoration works

Pi's `session_start` cannot inject anything into the model. So the extension does
something less obvious: on every turn, `before_agent_start` chains a
**constant-size restore pointer** (file paths plus reading instructions — never note
content or a topic index) onto
the system prompt. Consequences:

- after `/compact` nothing is lost — the pointer is rebuilt on the next turn;
- context size does not grow with your learning history;
- the pointer is never persisted into the session (`systemPrompt`, not `message`).

Details, measurements and source citations: [`docs/development.md`](docs/development.md).

## State

Notes live in `.vibe-wise/` (`profile.md`, `progress.md`, `project-map.md`),
resolved nearest-wins up to the repository root:

- **byte-compatible with the original Claude Code plugin** — the same notes work
  in both tools;
- a legacy `.sensible-vibes/` directory is read as a fallback, never migrated;
- notes are local files. No network calls, no telemetry, no LLM calls from
  package code; note contents are treated as data, never executed or spliced
  into commands.

## Tools

| Tool | What it does |
| --- | --- |
| `vibe_wise_ask` | picker-style question to the user (needs TUI; text fallback otherwise) |
| `vibe_wise_questionnaire` | onboarding questionnaire on first run |
| `vibe_wise_reset` | read-only preview → explicit confirm → backup → atomic wipe |

`VIBE_WISE_DEBUG_ENTRY=1` makes the extension append a `vibe-wise-injected` custom
entry per turn — a debugging aid for observability, not part of the contract.

## Scope and limitations

- Teaching quality is **model-dependent**: the tests prove the mechanics (state
  resolving, pointer, reset safety), not the pedagogy.
- Pickers/confirm only work in a real TUI.
- Before a release, the manual TUI checklist in `docs/development.md` should be
  run — it cannot be automated without a TTY.
- The opt-in integration tests need a live model provider; if the provider hangs
  they skip loudly (never fake a pass).

## Development

```bash
cd vibe-wise
npm install
npx tsc --noEmit
npx vitest run                                  # fast, hermetic

# opt-in: real headless pi runs against a temp fixture (needs a live provider)
VIBE_WISE_INTEGRATION=1 npx vitest run tests/integration.test.ts
```

See [`docs/development.md`](docs/development.md) for the review trail, verified
runtime facts and deviations from the original plugin.

## Verified acceptance facts

From the port's acceptance criteria, actually checked by the test suite:

- restore pointer is constant-size — **962 bytes** measured from the package root,
  bound ≤ 1100, `Δlength = 0` when `progress.md` grows by 100 KB;
- state-directory resolving: nearest-wins, `.vibe-wise` > `.sensible-vibes` on one
  level, stops at `.git` (file or directory), never crosses the repository root,
  symlinks are not read (no fallback, no crash);
- reset is fingerprint-bound (directory identity + note bytes), requires explicit
  confirmation, backs up before writing, replaces atomically, re-checks the
  fingerprint, and on mismatch reports "did not complete" plus the backup path;
- read-only restore: `session_start` + `before_agent_start` never change the bytes
  of `.vibe-wise/*`;
- local-only: `extensions/`, `lib/`, `skills/` use only `node:fs`, `node:path`,
  `node:crypto`, `node:url` (plus the local `typebox` schema builder in the tool
  definitions) — no network calls, no telemetry, no LLM calls from plugin code.

## Attribution and license

MIT. Original `vibe-wise` Claude Code plugin by Noah Kim (© 2026); this is a Pi
port by Vorvarinoo, not the original. See [LICENSE](LICENSE).
