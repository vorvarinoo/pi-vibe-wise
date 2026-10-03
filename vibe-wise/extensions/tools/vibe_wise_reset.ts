/**
 * `vibe_wise_reset` — the ONLY reset path (PLAN §5.3, skills/vibe-wise-reset).
 *
 * DEVIATION from PLAN §8 (M4 vs M5): the plan staged this tool as a minimal
 * stub in M4 and a full flow in M5. Implemented fully here, wired to the
 * reviewed `lib/reset.ts` port, because the library was already complete and
 * reviewed — a stub would be strictly less safe. M5 becomes integration
 * verification. Documented in the milestone report.
 *
 * Flow: preview (no writes) -> tool-owned confirmation dialog -> commit.
 * - invocation of the skill/tool is never consent; only the dialog is;
 * - commit re-checks the fingerprint and refuses on any drift;
 * - non-interactive runs refuse with ZERO disk writes (PLAN §4.4, [P3/T3]).
 */
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resetNotes } from "../../lib/reset";
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
			"Call without `confirmation` for a read-only preview, then again with the " +
			"preview's exact `confirmation` value; the tool asks the user to confirm. " +
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
				const result = resetNotes(cwd, confirmation);

				if (result.status === "no_notes") {
					return okResult(
						`No VibeWise learning notes found for ${cwd}. There is nothing to reset; ` +
							"suggest starting the learn skill instead.",
						{ ...detailsBase, status: result.status },
					);
				}

				if (result.status === "preview") {
					const files = (result.files ?? []).join(", ");
					const message =
						`Reset VibeWise learning for ${result.project}?\n` +
						`State directory: ${result.state}\n` +
						`Notes that will reset: ${files}\n` +
						`Originals will be saved under ${result.backup_parent}.`;
					const approved = await ctx.ui.confirm("Reset", message, { signal });
					if (!approved) {
						return okResult(
							"User cancelled. No changes were made, including to learner notes.",
							{ ...detailsBase, status: "preview", cancelled: true },
						);
					}
					// Re-enter with the exact fingerprint; the port re-checks it against
					// the current bytes and refuses on drift.
					const committed = resetNotes(cwd, result.confirmation ?? "");
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
				}

				// status === "reset" (a direct confirmed call).
				return okResult(
					`Learning notes reset. Backup: ${result.backup}. Now read the learn skill ` +
						"and restart onboarding with fresh notes.",
					{
						status: result.status,
						project: result.project,
						state: result.state,
						backup: result.backup,
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
