/**
 * `vibe_wise_reset` — the ONLY reset path (PLAN §5.3, skills/vibe-wise-reset).
 *
 * DEVIATION from PLAN §8 (M4 vs M5): the plan staged this tool as a minimal
 * stub in M4 and a full flow in M5. Implemented fully here, wired to the
 * reviewed `lib/reset.ts` port, because the library was already complete and
 * reviewed — a stub would be strictly less safe. M5 becomes integration
 * verification. Documented in the milestone report.
 *
 * Flow (strictly two calls — the planned §5.3 sequence):
 *   1. no `confirmation` -> READ-ONLY preview: no dialog, no disk writes;
 *   2. `confirmation` from that preview -> fingerprint re-check, then the
 *      tool-owned dialog; commit only on explicit approval.
 * - invocation of the skill/tool is never consent; only the dialog is;
 * - commit re-checks the fingerprint and refuses on any drift;
 * - non-interactive runs refuse with ZERO disk writes (PLAN §4.4, [P3/T3]).
 */
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { FINGERPRINT_MISMATCH_MESSAGE, resetNotes } from "../../lib/reset";
import { errorResult, isInteractive, okResult } from "./shared";

export const RESET_TOOL_NAME = "vibe_wise_reset";

const ResetParams = Type.Object({
	cwd: Type.Optional(
		Type.String({
			description:
				"Absolute project working directory. Defaults to the session cwd. " +
				"Relative paths are rejected (matching the original helper).",
		}),
	),
	confirmation: Type.Optional(
		Type.String({
			description:
				"The exact `confirmation` fingerprint from a previous preview. " +
				"Omit for a read-only preview; pass it to commit the reset.",
		}),
	),
});

export function registerVibeWiseReset(pi: ExtensionAPI): void {
	pi.registerTool({
		name: RESET_TOOL_NAME,
		label: "VibeWise: reset",
		description:
			"Back up this project's VibeWise learning notes and restart them fresh. " +
			"Call with no `confirmation` for a read-only preview (no writes, no dialog), " +
			"then call again with the preview's exact `confirmation` value to commit; " +
			"the commit call asks the user to confirm and does nothing if they cancel. " +
			"Never resets application code.",
		parameters: ResetParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const cwd = params.cwd ?? ctx.cwd;
			const detailsBase = { cwd };

			if (!isInteractive(ctx)) {
				// [P3/T3] Non-UI runs must not touch the disk at all. The preview is
				// read-only, but committing is impossible without a dialog, so refuse
				// outright and let the model explain.
				return errorResult(
					"Reset requires an interactive session (it must show a confirmation dialog). " +
						"Nothing was read or written. Ask the user to run the reset from an interactive session.",
					{ ...detailsBase, noUi: true },
				);
			}

			const confirmation = params.confirmation ?? null;

			try {
				// Step 1 — read-only preview. `resetNotes(cwd, null)` never writes, and no
				// dialog belongs here: the model presents these paths to the user in chat
				// (skills/vibe-wise-reset/SKILL.md steps 1-2).
				const preview = resetNotes(cwd, null);
				const noteList = (preview.files ?? []).join(", ");

				if (confirmation === null) {
					if (preview.status === "no_notes") {
						return okResult(
							`No VibeWise learning notes found for ${cwd}. There is nothing to reset; ` +
								"suggest starting the learn skill instead.",
							{ ...detailsBase, status: preview.status },
						);
					}
					return okResult(
						`Reset preview for ${preview.project}:\n` +
							`State directory: ${preview.state}\n` +
							`Notes that will reset: ${noteList}\n` +
							`Originals will be saved under ${preview.backup_parent}.\n` +
							"Nothing was changed. To commit, call this tool again with " +
							`confirmation: "${preview.confirmation}" and the user's agreement.`,
						{
							...detailsBase,
							status: preview.status,
							project: preview.project,
							state: preview.state,
							files: preview.files,
							backup_parent: preview.backup_parent,
							confirmation: preview.confirmation,
						},
					);
				}

				// Step 2 — commit. A stale token (or vanished notes) must be refused BEFORE
				// the dialog; the message text is single-sourced from the ported helper.
				if (
					preview.status === "no_notes" ||
					confirmation !== preview.confirmation
				) {
					throw new Error(FINGERPRINT_MISMATCH_MESSAGE);
				}

				// Invocation, silence, or earlier tool approvals are not consent — only
				// this dialog is.
				const approved = await ctx.ui.confirm(
					"Reset",
					`Reset VibeWise learning for ${preview.project}?\n` +
						`State directory: ${preview.state}\n` +
						`Notes that will reset: ${noteList}\n` +
						`Originals will be saved under ${preview.backup_parent}.`,
					{ signal },
				);
				if (!approved) {
					return okResult(
						"User cancelled. No changes were made, including to learner notes.",
						{ ...detailsBase, status: "preview", cancelled: true },
					);
				}

				// Committed with the exact preview token; lib re-checks it internally.
				const committed = resetNotes(cwd, preview.confirmation ?? "");
				return okResult(
					`Learning notes reset. Backup: ${committed.backup}. Now read the learn ` +
						"skill and restart onboarding with fresh notes.",
					{
						status: committed.status,
						project: committed.project,
						state: committed.state,
						backup: committed.backup,
						cwd,
					},
				);
			} catch (error) {
				// Surface the helper's exact message text (never reworded).
				const message = error instanceof Error ? error.message : String(error);
				return errorResult(message, { ...detailsBase, failed: true });
			}
		},
	});
}
