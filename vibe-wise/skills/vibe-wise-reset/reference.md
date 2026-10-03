# VibeWise reset tool reference

The `vibe_wise_reset` tool wraps the ported reset helper (`lib/reset.ts`, an
exact port of the original `reset.py`). It is registered by the VibeWise
extension and is the only reset path — never improvise file deletion.

## API

Parameters (TypeBox-validated):

| Parameter | Type | Meaning |
| --- | --- | --- |
| `cwd` | string, optional | Absolute project working directory. Defaults to the session `ctx.cwd`. Relative paths are rejected before resolution (matching the original). |
| `confirmation` | string, optional | The exact `confirmation` fingerprint from a previous preview. Omit for a read-only preview; pass to commit. |
| `language` | string, optional | Dialog language: `"ru"` or `"en"` (default). Only the tool-rendered dialog/result texts are localized; helper error texts stay verbatim English. Unknown values fall back to English. |

### Preview (omit `confirmation`)

The preview is strictly read-only: it performs **no** confirmation dialog and
**no** disk writes. `backups/` is not even created. The model is expected to
show these paths to the user in chat before committing (see `SKILL.md`).

Returns:

- `status: "preview"` — with `project` (absolute project dir), `state` (absolute
  state dir), `files` (note names that will reset), `backup_parent`
  (`<state>/backups/`), `confirmation` (fingerprint to echo back verbatim).
- `status: "no_notes"` — nothing to reset; suggest the learn skill instead.

The preview never writes anything.

### Commit (pass `confirmation`)

The tool first re-checks the fingerprint: a stale token (or vanished notes) is
refused with `Target or notes changed. Preview and confirm again; nothing reset.`
**before** any dialog is shown.

Only then does the tool show its own confirmation dialog (`ctx.ui.confirm`):
header `Reset` (RU: `Сброс`), message with the project/state paths and the
backup location. Pass `language: "ru"` for a Russian dialog. Only an explicit
approval commits; Cancel leaves every byte untouched. Invocation of the skill
or tool is never consent.

On success the result carries `status: "reset"`, `backup` (absolute path of the
timestamped backup directory), `project`, and `state`. Backup contents: the
original bytes of every note plus `.new-<name>` staging files that were renamed
into place atomically. Foreign files in the state directory are never touched.

### Guarantees

- **Fingerprint binding.** The commit re-checks that the state directory and
  every note byte still match the preview. On mismatch (or a changed/missing
  note) the tool refuses with
  `Target or notes changed. Preview and confirm again; nothing reset.`
- **Backup before write.** Originals are copied into
  `<state>/backups/reset-<UTC timestamp>-<rand>/` before any active note is
  replaced. Backups are never overwritten.
- **Atomic replace.** Active notes are swapped via rename of pre-written
  `.new-` staging files; a failure mid-way aborts before replacing and reports
  `Reset did not complete. Backup location: <backup>. …`
- **Non-interactive runs.** When no interactive UI is available the tool
  returns an error result and performs **zero** disk writes — no preview
  fallback that mutates, no backup, nothing. The model should then tell the
  user to run the reset from an interactive session.
- **Cancelled.** If the user cancels the dialog, the result is a non-error
  with `details.cancelled: true` and no changes.

### Error contract

Every failure surfaces as an error result whose text starts with the exact
message from the ported helper (never reworded), plus the backup path when one
exists. After a failed reset: stop, report the backup location, do not start
onboarding.
