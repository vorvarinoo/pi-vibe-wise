/**
 * Testable core of the VibeWise extension handlers.
 *
 * Deliberately imports NOTHING from `@earendil-works/pi-coding-agent`, so tests
 * can drive these factories with fake event/ctx objects. `extensions/index.ts`
 * is the thin wiring layer that binds them to the real `ExtensionAPI`.
 *
 * Invariants (PLAN §4):
 * - read-only restore: handlers never write inside the state directory;
 * - every error is swallowed -> `{}` / `null` so learning never breaks a session;
 * - the pointer is injected per turn via `systemPrompt` (never via `message`,
 *   which would persist into the session and grow the context).
 */
import path from "node:path";
import { profileIsActive } from "../lib/profile";
import { buildPointer } from "../lib/pointer";
import { stateDirectory } from "../lib/state-directory";

/** Resolved state facts cached between `session_start` and the agent turns. */
export interface StateCache {
	stateDir: string;
}

/** Dependencies of the handlers, overridable for tests. */
export interface HandlerDeps {
	/** Absolute package root (resolved from the extension file location). */
	pluginRoot: string;
	/** How the state directory is resolved (defaults to the §6.1 port). */
	resolveState?: (cwd: string) => Promise<string | null>;
	/** How the profile is judged active (defaults to the §6.2 port). */
	isActive?: (profilePath: string) => Promise<boolean>;
}

export function learnSkillPath(pluginRoot: string): string {
	return path.join(pluginRoot, "skills", "vibe-wise-learn", "SKILL.md");
}

/**
 * `session_start` handler: drop and re-resolve the cache on EVERY reason
 * (startup | reload | new | resume | fork). There is deliberately no special
 * case for compaction: `/compact` emits no `session_start`, the extension
 * instance and its cache survive, and the next turn re-injects the pointer.
 */
export function createSessionStartHandler(deps: HandlerDeps) {
	const cache: { current: StateCache | null } = { current: null };
	const resolveState = deps.resolveState ?? stateDirectory;
	const isActive = deps.isActive ?? profileIsActive;
	return {
		cache,
		async handle(
			event: { reason: string },
			ctx: { cwd: string },
		): Promise<void> {
			void event; // every reason re-reads; the union carries no per-reason data we need
			cache.current = null;
			try {
				const state = await resolveState(ctx.cwd);
				if (state && (await isActive(path.join(state, "profile.md")))) {
					cache.current = { stateDir: state };
				}
			} catch {
				cache.current = null; // [P10d] errors never break the session
			}
		},
	};
}

/**
 * `before_agent_start` handler: chain the restore pointer onto the turn's
 * system prompt when (and only when) an active state directory is cached.
 */
export function createBeforeAgentStartHandler(
	deps: HandlerDeps,
	cache: { current: StateCache | null },
	debug?: { appendEntry: (customType: string, data: unknown) => void },
) {
	const skillPath = learnSkillPath(deps.pluginRoot);
	return {
		async handle(event: {
			systemPrompt: string;
		}): Promise<{ systemPrompt: string } | Record<string, never>> {
			if (!cache.current) return {};
			try {
				const stateDir = cache.current.stateDir;
				const pointer = buildPointer({
					pluginRoot: deps.pluginRoot,
					skillPath,
					stateDir,
				});
				if (debug && process.env.VIBE_WISE_DEBUG_ENTRY === "1") {
					// Observability spike (PLAN §7.5): the injected systemPrompt is not
					// visible in the session JSON stream, so expose it as a custom entry.
					debug.appendEntry("vibe-wise-injected", {
						stateDir,
						pointerLength: pointer.length,
					});
				}
				return { systemPrompt: `${event.systemPrompt}\n\n${pointer}` };
			} catch {
				return {}; // [P10d]
			}
		},
	};
}

/**
 * Marker for the `tool_result` hook: the runtime's `AgentToolResult` has no
 * `isError` field, and throwing from `execute()` would wipe `details` (the
 * runtime replaces them with `{}`). Tools therefore return a normal result and
 * rely on this hook to flip `isError` while keeping `details` intact
 * (`agent-session.js`: `isError: hookResult?.isError ?? isError`).
 */
export function createToolResultMarker(toolNames: readonly string[]) {
	const names = new Set(toolNames);
	return {
		async handle(event: {
			toolName: string;
			details?: unknown;
		}): Promise<{ isError: boolean } | undefined> {
			if (!names.has(event.toolName)) return undefined;
			const details = (event.details ?? {}) as { vibeWiseIsError?: boolean };
			if (details.vibeWiseIsError === true) return { isError: true };
			return undefined;
		},
	};
}
