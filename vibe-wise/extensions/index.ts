/**
 * VibeWise extension entry point (PLAN §4.1).
 *
 * Thin wiring layer: all logic lives in `handlers.ts` (testable without pi)
 * and `tools/*` (thin wrappers around the reviewed `lib/` ports).
 *
 * Boot contract:
 * - `session_start` re-resolves the state cache on every reason; errors are
 *   swallowed so learning never breaks a session ([P10d]);
 * - `before_agent_start` chains the constant-size restore pointer onto the
 *   turn's system prompt via `systemPrompt` (never `message`, which would
 *   persist into the session — PLAN §4.2);
 * - the `tool_result` hook flips `isError` for tools that report
 *   `details.vibeWiseIsError` (runtime facts: AgentToolResult has no isError
 *   field, and throwing would wipe details — see handlers.ts).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
	createBeforeAgentStartHandler,
	createSessionStartHandler,
	createToolResultMarker,
} from "./handlers";
import { ASK_TOOL_NAME, registerVibeWiseAsk } from "./tools/vibe_wise_ask";
import {
	QUESTIONNAIRE_TOOL_NAME,
	registerVibeWiseQuestionnaire,
} from "./tools/vibe_wise_questionnaire";
import {
	RESET_TOOL_NAME,
	registerVibeWiseReset,
} from "./tools/vibe_wise_reset";

// Resolved from the extension file location, never from the user's cwd.
const PLUGIN_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

const TOOL_NAMES = [
	ASK_TOOL_NAME,
	QUESTIONNAIRE_TOOL_NAME,
	RESET_TOOL_NAME,
] as const;

export default function vibeWiseExtension(pi: ExtensionAPI): void {
	const sessionStart = createSessionStartHandler({ pluginRoot: PLUGIN_ROOT });
	const beforeAgentStart = createBeforeAgentStartHandler(
		{ pluginRoot: PLUGIN_ROOT },
		sessionStart.cache,
		{ appendEntry: (customType, data) => pi.appendEntry(customType, data) },
	);
	const toolResultMarker = createToolResultMarker(TOOL_NAMES);

	pi.on("session_start", async (event, ctx) => {
		await sessionStart.handle(event, ctx);
	});

	pi.on("before_agent_start", async (event) => beforeAgentStart.handle(event));

	pi.on("tool_result", async (event) => toolResultMarker.handle(event));

	registerVibeWiseAsk(pi);
	registerVibeWiseQuestionnaire(pi);
	registerVibeWiseReset(pi);
}
