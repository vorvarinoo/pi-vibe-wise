# VibeWise extension

Loaded via the package manifest (`package.json` → `pi.extensions:
["./extensions/index.ts"]`). Pi loads this single file with jiti (TypeScript,
no build step) and scans nothing else under `extensions/` — verified against
Pi 0.84.1 (`resolveExtensionEntries()` in `dist/core/package-manager.js`).

## Layout

| File | Role |
| --- | --- |
| `index.ts` | Wiring only: registers the two session handlers, the `tool_result` marker hook, and the three tools. Resolves `PLUGIN_ROOT` from `import.meta.url`, never from the user's cwd. |
| `handlers.ts` | Testable core. Imports nothing from pi, so `tests/extension.test.ts` drives it with fake events/ctx. Holds the session cache, pointer injection, and the `isError` marker. |
| `tools/shared.ts` | Tool-result helpers. Non-error results set `details.vibeWiseIsError: false`; error-flavoured results set `true` and keep their details. |
| `tools/vibe_wise_ask.ts` | Single-question picker (replacement for the original `AskUserQuestion`). The input title for `allowCustom` is the model-composed question; the placeholder is optional, so a non-English dialog gets no forced English strings. |
| `tools/vibe_wise_questionnaire.ts` | Bounded sequential multiple-choice batch for onboarding. |
| `tools/vibe_wise_reset.ts` | Strictly two calls: read-only preview (no dialog, no writes) → commit call with the preview's fingerprint → tool-owned dialog → commit. Wired to `lib/reset.ts`. Dialog/preview/result texts are localized via the optional `language` parameter (`"ru"`/`"en"`, default `en`; unknown values fall back to English). |

## Why the `tool_result` hook exists

Pi 0.84.1's `AgentToolResult` has **no `isError` field**. The runtime sets
`isError: true` only when `execute()` throws — and then replaces `details`
with `{}`, losing `details.fallback` / `details.noUi` / the exact helper error
text. Our tools therefore return normal results with a `vibeWiseIsError`
details flag, and the `tool_result` hook flips `isError` for that call while
keeping the details intact (`agent-session.js`:
`isError: hookResult?.isError ?? isError`).

## UI surface (Pi 0.84.1 facts)

- `ctx.ui.select(title, options: string[], { signal })` — options are plain
  strings; descriptions are folded in as `label — description` and mapped back
  by exact match (`tools/shared.ts`).
- `ctx.ui.confirm(title, message, { signal }) -> boolean`.
- `ctx.ui.input(title, placeholder?, { signal }) -> string | undefined`.
- `ctx.hasUI === false` in `--mode json` / `print` / `rpc`; every tool refuses
  or falls back without side effects (reset performs zero disk writes).
- `ctx.ui.custom()` (bespoke TUI components) is intentionally unused — the
  sequential-select design covers the required UX with less surface.

## Observability

The injected system prompt is not visible in the session JSON stream. With
`VIBE_WISE_DEBUG_ENTRY=1` the extension appends a `vibe-wise-injected` custom
entry (`pi.appendEntry`) on every turn where the pointer was injected; visible
in `--mode json` as an `entry_appended` event. Used by the M4 spike and manual
compaction checks (PLAN §7.5).

## Reset consent model

`vibe_wise_reset` is deliberately **two separate calls**:

1. without `confirmation` → read-only preview: no dialog, no disk writes, no
   backup directory; returns `project`, `state`, `files`, `backup_parent`, and
   the `confirmation` fingerprint. The model shows those paths to the user in
   chat (`skills/vibe-wise-reset/SKILL.md` step 2).
2. with that exact `confirmation` → the fingerprint is re-checked first (a
   stale token is refused *before* the dialog), then the tool shows its own
   `ctx.ui.confirm` dialog, and only explicit approval commits. Cancel leaves
every byte untouched.

Invocation of the skill or tool, silence, or an earlier tool approval is never
consent. See `skills/vibe-wise-reset/reference.md` for the full contract.
