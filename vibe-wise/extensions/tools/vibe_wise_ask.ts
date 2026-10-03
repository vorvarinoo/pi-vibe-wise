/**
 * `vibe_wise_ask` — the single-question picker that replaces the original
 * plugin's `AskUserQuestion` mechanism (PLAN §4.4, §5.2).
 *
 * - exactly one question, 2-4 options, optional header (<= 12 chars);
 * - single-select only (multi-select is intentionally unavailable);
 * - open-ended reasoning questions must NOT go through this tool;
 * - non-interactive runs return `details.fallback: true` so the model asks the
 *   question in plain chat instead (PLAN §4.4 table);
 * - cancellation is a normal outcome (`details.cancelled`, not an error).
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

export const ASK_TOOL_NAME = "vibe_wise_ask";

const AskParams = Type.Object({
	title: Type.String({
		description: "Short question text shown as the dialog title.",
	}),
	options: Type.Array(
		Type.Object({
			label: Type.String({ description: "Short option label." }),
			description: Type.Optional(
				Type.String({
					description: "One-line description shown under the label.",
				}),
			),
		}),
		{ description: "2-4 options; single-select only." },
	),
	header: Type.Optional(
		Type.String({
			description: "Optional context header, at most 12 characters.",
		}),
	),
	placeholder: Type.Optional(
		Type.String({
			description:
				"Optional input-field placeholder for the custom free-text answer (allowCustom). " +
				"In the learner's language when provided.",
		}),
	),
	allowCustom: Type.Optional(
		Type.Boolean({
			description: "Offer a free-text answer in addition to the options.",
		}),
	),
});

export function registerVibeWiseAsk(pi: ExtensionAPI): void {
	pi.registerTool({
		name: ASK_TOOL_NAME,
		label: "VibeWise: ask",
		description:
			"Single-question picker used by VibeWise onboarding and checkpoint confirmation. " +
			"Pass a short title, 2-4 options with label+description, and an optional header (<=12 chars). " +
			"Never use it for open-ended reasoning questions; ask those in chat.",
		parameters: AskParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const options: AskOption[] = params.options;
			const detailsBase = {
				question: params.title,
				options: options.map((o) => o.label),
			};

			if (options.length < 2 || options.length > 4) {
				return errorResult(
					"vibe_wise_ask requires 2-4 options. Ask the question in chat instead if no options fit.",
					{ ...detailsBase, fallback: true },
				);
			}

			if (!isInteractive(ctx)) {
				// Non-UI run (--mode json / print / rpc): tell the model to fall back
				// to a plain-chat question. No dialog is attempted.
				const list = options.map((o) => `- ${renderOption(o)}`).join("\n");
				return errorResult(
					"No interactive UI is available. Ask the user in plain chat:\n" +
						`${params.title}\n${list}`,
					{ ...detailsBase, fallback: true },
				);
			}

			const rendered = options.map(renderOption);
			const title = params.header
				? `[${params.header}] ${params.title}`
				: params.title;
			const selected = await ctx.ui.select(title, rendered, { signal });

			if (selected === undefined) {
				return okResult("User cancelled the selection.", {
					...detailsBase,
					cancelled: true,
				});
			}

			if (params.allowCustom === true) {
				// The input title reuses the question (already composed by the model in
				// the learner's language); the placeholder is optional so no English
				// string is forced on a non-English dialog.
				const custom = await ctx.ui.input(params.title, params.placeholder, {
					signal,
				});
				if (custom !== undefined && custom.trim() !== "") {
					return okResult(`User wrote: ${custom.trim()}`, {
						...detailsBase,
						answer: custom.trim(),
						wasCustom: true,
					});
				}
			}

			const answer = labelOf(selected, options);
			return okResult(`User selected: ${answer}`, { ...detailsBase, answer });
		},
	});
}
