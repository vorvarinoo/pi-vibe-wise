---
name: vibe-wise-reset
description: Back up this project's learning notes and restart onboarding after confirmation. Does not reset application code.
disable-model-invocation: true
---

# Reset VibeWise learning

Run this in the main conversation, only when explicitly invoked. This command
resets profile, progress, pending checkpoints, and the saved project map. Source
code, dependencies, Git history, other projects, and the installed extension
stay intact.

1. Call the `vibe_wise_reset` tool registered by the VibeWise extension with no
   `confirmation` argument to run the read-only preview for the user's current
   project directory. Do not pass a placeholder path; the tool uses the session
   working directory. If the tool reports `no_notes`, explain there's nothing to
   reset and suggest the learn skill. On any error, stop and explain; don't
   improvise deletion commands.

2. Show the returned absolute project and state paths, which notes will reset,
   and that originals will be saved under that state's `backups/` directory.
   Confirm ONLY through the tool's own confirmation dialog (`ctx.ui.confirm`
   inside `vibe_wise_reset`): invoke the tool again with the preview's exact
   `confirmation` value and let it ask the user — header `Reset` (RU: `Сброс`),
   one question, options **Cancel** (RU: **Отмена**; keep learning notes) and
   **Reset learning** (RU: **Сбросить обучение**; back up notes and restart
   onboarding). Pass `language: "ru"` when conversing in Russian so the dialog
   itself is Russian; omit it for English. Ask whether to reset learning for the named
   project. Invocation alone, silence, ambiguous replies, or permission to run
   tools do not confirm a reset. Cancel makes no changes, including to learner
   notes.

3. Only after the user answers **Reset learning** in the tool's dialog does the
   tool commit the reset. If the target or notes changed, the tool refuses and
   returns the preview error; preview again and get a new confirmation. If the
   reset fails, the tool reports it and any backup path; don't claim success or
   start onboarding. Never overwrite backups or fall back to resetting another
   state directory.

4. On success, show the backup path returned by the tool. Read
   [../vibe-wise-learn/SKILL.md](../vibe-wise-learn/SKILL.md) and resume Learn
   with the new incomplete profile. Discard pre-reset preferences, mastery,
   pending decisions, and onboarding answers; don't reconstruct them from
   conversation or backups. Inspect actual code to rebuild the map. Begin fresh
   onboarding with one question at a time. Backup notes are historical data,
   not active context.
