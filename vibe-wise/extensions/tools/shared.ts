/**
 * Shared UI plumbing for the VibeWise tools.
 *
 * Runtime facts (pi 0.84.1):
 * - `ctx.ui.select(title, options: string[], opts?)` takes plain strings, not
 *   `{label, description}` objects, so option descriptions are folded into the
 *   rendered string and the choice is mapped back by exact match.
 * - `AgentToolResult` carries no `isError`; the `tool_result` extension hook
 *   (see handlers.ts) flips it based on the `vibeWiseIsError` details flag.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface AskOption {
	label: string;
	description?: string;
}

/** Render an option for `ui.select` and remember its label. */
export function renderOption(option: AskOption): string {
	return option.description
		? `${option.label} — ${option.description}`
		: option.label;
}

/** Recover the original label from a rendered select option. */
export function labelOf(
	rendered: string,
	options: readonly AskOption[],
): string {
	const match = options.find(
		(o) =>
			(o.description ? `${o.label} — ${o.description}` : o.label) === rendered,
	);
	return match ? match.label : rendered;
}

export interface ToolResult {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
}

/** Non-error result (cancelled is a normal outcome, not a failure). */
export function okResult(
	text: string,
	details: Record<string, unknown>,
): ToolResult {
	return {
		content: [{ type: "text", text }],
		details: { ...details, vibeWiseIsError: false },
	};
}

/**
 * Error-flavoured result that keeps its details: the `tool_result` hook sees
 * `vibeWiseIsError: true` and flips `isError` for this call.
 */
export function errorResult(
	text: string,
	details: Record<string, unknown>,
): ToolResult {
	return {
		content: [{ type: "text", text }],
		details: { ...details, vibeWiseIsError: true },
	};
}

export function isInteractive(ctx: ExtensionContext): boolean {
	return ctx.hasUI === true;
}
