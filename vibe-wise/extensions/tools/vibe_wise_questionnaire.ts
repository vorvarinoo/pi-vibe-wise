/**
 * `vibe_wise_questionnaire` — bounded sequential onboarding helper (PLAN §4.4).
 *
 * DEVIATION from PLAN §4.4: the plan sketched this as a `ctx.ui.custom()`
 * TUI component (wizard). Implemented instead as a bounded sequence of
 * `ctx.ui.select` calls — the same one-question-at-a-time UX the prose
 * requires, without bespoke TUI components. Documented in the milestone
 * report.
 *
 * It never replaces the onboarding prose; it only batches a fixed list of
 * multiple-choice questions into sequential dialogs. Cancellation aborts the
 * whole batch with `details.cancelled: true` (no partial results).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	errorResult,
	isInteractive,
	labelOf,
	okResult,
	renderOption,
	type AskOption,
} from "./shared";

export const QUESTIONNAIRE_TOOL_NAME = "vibe_wise_questionnaire";

interface Question {
	id: string;
	title: string;
	options: AskOption[];
}

const QuestionSchema = Type.Object({
	id: Type.String({
		description: "Stable key for the answer, e.g. `experience`.",
	}),
	title: Type.String({ description: "Question text." }),
	options: Type.Array(
		Type.Object({
			label: Type.String(),
			description: Type.Optional(Type.String()),
		}),
		{ description: "2-4 options; single-select." },
	),
});

const QuestionnaireParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		description: "Questions asked strictly one at a time, in order (max 8).",
	}),
});

export function registerVibeWiseQuestionnaire(pi: ExtensionAPI): void {
	pi.registerTool({
		name: QUESTIONNAIRE_TOOL_NAME,
		label: "VibeWise: questionnaire",
		description:
			"Ask several multiple-choice onboarding questions strictly one at a time (sequential dialogs). " +
			"Do not use it for open-ended questions; those belong in chat.",
		parameters: QuestionnaireParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const questions: Question[] = params.questions;
			if (questions.length === 0 || questions.length > 8) {
				return errorResult("vibe_wise_questionnaire requires 1-8 questions.", {
					fallback: true,
				});
			}

			if (!isInteractive(ctx)) {
				const list = questions
					.map(
						(q) =>
							`${q.title}\n${q.options.map((o) => `  - ${renderOption(o)}`).join("\n")}`,
					)
					.join("\n");
				return errorResult(
					"No interactive UI is available. Ask these questions one at a time in plain chat:\n" +
						list,
					{ fallback: true, questions: questions.map((q) => q.id) },
				);
			}

			const answers: Record<string, string> = {};
			for (const q of questions) {
				const selected = await ctx.ui.select(
					q.title,
					q.options.map(renderOption),
					{ signal },
				);
				if (selected === undefined) {
					// Documented contract: no partial results on cancel — the onboarding
					// prose re-asks unanswered questions in order anyway.
					return okResult("User cancelled the questionnaire.", {
						cancelled: true,
						answers: {},
						answeredQuestions: [],
					});
				}
				answers[q.id] = labelOf(selected, q.options);
			}

			return okResult("All questions answered.", { answers });
		},
	});
}
