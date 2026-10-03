# Changelog

All notable changes to this project are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-10-03

Initial Pi package. Port of the Claude Code plugin `vibe-wise` v0.1.43 to
`pi-coding-agent` (verified on 0.84.1). Covers plan milestones M1–M7.

### Added

- `lib/` — pure core: state-directory resolving (nearest-wins, `.vibe-wise` >
  `.sensible-vibes`, stop at `.git`, repo-root boundary, symlink-safe), profile
  activation, constant-size restore pointer, reset flow (fingerprint binding,
  backup, atomic replace, re-check).
- Extension (`extensions/index.ts`) with three custom tools: `vibe_wise_ask`,
  `vibe_wise_questionnaire`, `vibe_wise_reset`.
- Skills `vibe-wise-learn` and `vibe-wise-reset` (`/skill:…`, TUI).
- Test suite: 81 passing unit/seam tests, 3 platform skips on Windows, opt-in
  bounded headless integration tests (`VIBE_WISE_INTEGRATION=1`).

### Changed from the original v0.1.43

- **Injection mechanism:** the restore pointer is chained onto the system prompt
  on every turn via `before_agent_start` (constant-size, non-persistent). The
  original used a Claude Code `SessionStart` hook; Pi's `session_start` cannot
  inject into the model. Side effects: `/compact`-survival and no context growth
  from learning history.
- **User interaction:** three custom tools instead of the original
  `AskUserQuestion` tool, with a text fallback when there is no interactive UI.
- **Packaging:** a pi package (`pi.extensions` + `pi.skills` manifest,
  TS loaded via jiti, no build step) instead of `hooks.json` +
  `.claude-plugin/`.
- State format is **unchanged** — byte-compatible with the original plugin;
  legacy `.sensible-vibes/` is read as a fallback, never migrated.
