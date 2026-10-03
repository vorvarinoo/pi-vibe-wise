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
- **Language support.** The learning language is stored as a `Language:` line in
  `.vibe-wise/profile.md` and enforced on every turn by a one-line addition to the
  injected pointer, so it no longer depends on the model guessing from the
  conversation (a Chinese-default model with no user message asked in Chinese).
  `VIBE_WISE_LANGUAGE=ru|en` overrides the profile; only whitelisted codes ever
  reach the system prompt. Onboarding asks the language first when there is no
  signal, with each option labelled in its own language. The reset confirmation
  dialog is localized through the tool's optional `language` parameter.
- Test suite: 98 passing unit/seam tests, 6 skips on Windows (platform + opt-in
  integration), opt-in bounded headless integration tests
  (`VIBE_WISE_INTEGRATION=1`).

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
  legacy `.sensible-vibes/` is read as a fallback, never migrated. The reset
  templates stay byte-identical to `reset.py`, so notes keep round-tripping
  between the Claude Code plugin and this port.
- **Language:** the port is language-adaptive (questions, headings, buttons and
  reports follow the learner), which the original always produced in English;
  the pointer therefore carries one extra fixed line when a language is set.
