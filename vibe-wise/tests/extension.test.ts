/**
 * Extension-layer tests (PLAN §7.4, with [P9] corrections).
 *
 * The handlers are driven with fake events/ctx — no pi import, no subprocess.
 * Each test pins an observable invariant (read-only restore, injection gating,
 * error swallowing, tool fallback/cancel/no-write semantics), not the
 * implementation's shape.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
	existsSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	createBeforeAgentStartHandler,
	createSessionStartHandler,
	createToolResultMarker,
	learnSkillPath,
} from "../extensions/handlers";
import { buildPointer } from "../lib/pointer";
import { makeNotes, makeProject, makeTempRoot } from "./helpers";

const roots: string[] = [];

function freshProject(mode: string): { root: string; project: string } {
	const root = makeTempRoot("vw-ext-");
	roots.push(root);
	const project = makeProject(root);
	makeNotes(project, { mode });
	return { root, project };
}

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function makeDeps(pluginRoot = "/does/not/matter") {
	return { pluginRoot };
}

describe("session_start handler", () => {
	it("caches the state dir for reason=startup when the profile is active", async () => {
		const { project } = freshProject("active");
		const handler = createSessionStartHandler(makeDeps());
		await handler.handle({ reason: "startup" }, { cwd: project });
		expect(handler.cache.current).not.toBeNull();
		expect(handler.cache.current?.stateDir).toBe(
			path.join(project, ".vibe-wise"),
		);
	});

	it("re-reads the cache on every reason (resume, fork, new, reload)", async () => {
		const { project } = freshProject("active");
		const handler = createSessionStartHandler(makeDeps());
		for (const reason of ["resume", "fork", "new", "reload"] as const) {
			handler.cache.current = { stateDir: "/stale" };
			await handler.handle({ reason }, { cwd: project });
			expect(handler.cache.current?.stateDir).toBe(
				path.join(project, ".vibe-wise"),
			);
		}
	});

	it("drops a stale cache when the cwd changes on the same instance (mutation: resume into another project)", async () => {
		// Regression guard: without the cache reset, /resume into a different project
		// would keep injecting the PREVIOUS project's pointer.
		const active = freshProject("active");
		const paused = freshProject("paused");
		const session = createSessionStartHandler(makeDeps());
		const before = createBeforeAgentStartHandler(makeDeps(), session.cache);

		await session.handle({ reason: "startup" }, { cwd: active.project });
		expect(
			(await before.handle({ systemPrompt: "BASE" })) as {
				systemPrompt: string;
			},
		).toHaveProperty("systemPrompt");

		// Same handler instance, different project, paused profile.
		await session.handle({ reason: "resume" }, { cwd: paused.project });
		expect(session.cache.current).toBeNull();
		await expect(before.handle({ systemPrompt: "BASE" })).resolves.toEqual({});
	});

	it("caches nothing when the profile is paused", async () => {
		const { project } = freshProject("paused");
		const handler = createSessionStartHandler(makeDeps());
		await handler.handle({ reason: "startup" }, { cwd: project });
		expect(handler.cache.current).toBeNull();
	});

	it("caches nothing when there is no state directory", async () => {
		const root = makeTempRoot("vw-ext-");
		roots.push(root);
		const project = makeProject(root); // .git but no .vibe-wise
		const handler = createSessionStartHandler(makeDeps());
		await handler.handle({ reason: "startup" }, { cwd: project });
		expect(handler.cache.current).toBeNull();
	});

	it("swallows resolver errors instead of breaking the session [P10d]", async () => {
		const handler = createSessionStartHandler({
			...makeDeps(),
			resolveState: async () => {
				throw new Error("boom");
			},
		});
		await expect(
			handler.handle({ reason: "startup" }, { cwd: "/x" }),
		).resolves.toBeUndefined();
		expect(handler.cache.current).toBeNull();
	});

	it("never changes state bytes (read-only restore, acceptance §9.8)", async () => {
		const { project } = freshProject("active");
		const state = path.join(project, ".vibe-wise");
		const before = readdirSync(state)
			.sort()
			.map((f) => readFileSync(path.join(state, f)));
		const handler = createSessionStartHandler(makeDeps());
		await handler.handle({ reason: "startup" }, { cwd: project });
		const after = readdirSync(state)
			.sort()
			.map((f) => readFileSync(path.join(state, f)));
		expect(after).toEqual(before);
	});
});

describe("before_agent_start handler", () => {
	it("returns {} when no state is cached", async () => {
		const handler = createBeforeAgentStartHandler(makeDeps(), {
			current: null,
		});
		await expect(handler.handle({ systemPrompt: "BASE" })).resolves.toEqual({});
	});

	it("chains the pointer onto the system prompt when active", async () => {
		const { project } = freshProject("active");
		const session = createSessionStartHandler(makeDeps());
		await session.handle({ reason: "startup" }, { cwd: project });
		const handler = createBeforeAgentStartHandler(makeDeps(), session.cache);
		const result = await handler.handle({ systemPrompt: "BASE" });
		expect("systemPrompt" in result).toBe(true);
		const prompt = (result as { systemPrompt: string }).systemPrompt;
		expect(prompt.startsWith("BASE\n\n")).toBe(true);
		expect(prompt).toContain(learnSkillPath(makeDeps().pluginRoot));
		expect(prompt).toContain(path.join(project, ".vibe-wise"));
		expect(prompt).toBe(
			"BASE\n\n" +
				buildPointer({
					pluginRoot: makeDeps().pluginRoot,
					skillPath: learnSkillPath(makeDeps().pluginRoot),
					stateDir: path.join(project, ".vibe-wise"),
				}),
		);
	});

	it("injects nothing when paused (pointer absent, not 'contains paused') [P-T1]", async () => {
		const { project } = freshProject("paused");
		const session = createSessionStartHandler(makeDeps());
		await session.handle({ reason: "startup" }, { cwd: project });
		const handler = createBeforeAgentStartHandler(makeDeps(), session.cache);
		await expect(handler.handle({ systemPrompt: "BASE" })).resolves.toEqual({});
	});

	it("returns {} when the pointer builder throws [P10d]", async () => {
		const handler = createBeforeAgentStartHandler(
			{ pluginRoot: "\0invalid" },
			{ current: { stateDir: "/some/state" } },
		);
		// Even if buildPointer somehow succeeds, the handler must not throw.
		const result = await handler.handle({ systemPrompt: "BASE" });
		expect(typeof result).toBe("object");
	});

	it("appends the debug entry only under the env flag (spike seam)", async () => {
		const { project } = freshProject("active");
		const session = createSessionStartHandler(makeDeps());
		await session.handle({ reason: "startup" }, { cwd: project });
		const entries: Array<[string, unknown]> = [];
		const handler = createBeforeAgentStartHandler(makeDeps(), session.cache, {
			appendEntry: (t, d) => entries.push([t, d]),
		});
		const previous = process.env.VIBE_WISE_DEBUG_ENTRY;
		try {
			process.env.VIBE_WISE_DEBUG_ENTRY = "1";
			await handler.handle({ systemPrompt: "BASE" });
			expect(entries).toEqual([
				[
					"vibe-wise-injected",
					{
						stateDir: path.join(project, ".vibe-wise"),
						pointerLength: expect.any(Number),
					},
				],
			]);
			entries.length = 0;
			delete process.env.VIBE_WISE_DEBUG_ENTRY;
			await handler.handle({ systemPrompt: "BASE" });
			expect(entries).toEqual([]);
		} finally {
			if (previous === undefined) delete process.env.VIBE_WISE_DEBUG_ENTRY;
			else process.env.VIBE_WISE_DEBUG_ENTRY = previous;
		}
	});
});

describe("tool_result marker", () => {
	it("flips isError for marked vibe-wise tools", async () => {
		const marker = createToolResultMarker(["vibe_wise_ask", "vibe_wise_reset"]);
		await expect(
			marker.handle({
				toolName: "vibe_wise_ask",
				details: { vibeWiseIsError: true },
			}),
		).resolves.toEqual({ isError: true });
		await expect(
			marker.handle({
				toolName: "vibe_wise_reset",
				details: { vibeWiseIsError: true, failed: true },
			}),
		).resolves.toEqual({ isError: true });
	});

	it("leaves normal and foreign tool results untouched", async () => {
		const marker = createToolResultMarker(["vibe_wise_ask"]);
		await expect(
			marker.handle({
				toolName: "vibe_wise_ask",
				details: { vibeWiseIsError: false },
			}),
		).resolves.toBeUndefined();
		await expect(
			marker.handle({ toolName: "read", details: { vibeWiseIsError: true } }),
		).resolves.toBeUndefined();
		await expect(
			marker.handle({ toolName: "vibe_wise_ask", details: undefined }),
		).resolves.toBeUndefined();
	});
});

describe("vibe_wise_reset tool semantics (via the reviewed lib)", () => {
	it("preview reports the state, files, backup parent, and confirmation without writing", async () => {
		const { project } = freshProject("active");
		const state = path.join(project, ".vibe-wise");
		const before = readFileSync(path.join(state, "profile.md"));
		const { resetNotes } = await import("../lib/reset");
		const preview = resetNotes(project);
		expect(preview.status).toBe("preview");
		expect(preview.state).toBe(state);
		expect(preview.files).toEqual([
			"profile.md",
			"progress.md",
			"project-map.md",
		]);
		expect(preview.backup_parent).toBe(path.join(state, "backups"));
		expect(preview.confirmation).toEqual(expect.any(String));
		expect(readFileSync(path.join(state, "profile.md"))).toEqual(before);
		expect(existsSync(path.join(state, "backups"))).toBe(false);
	});

	it("non-UI reset refuses with zero disk writes [P3/T3]", async () => {
		const { project } = freshProject("active");
		const state = path.join(project, ".vibe-wise");
		const before = readdirSync(state)
			.sort()
			.map((f) => readFileSync(path.join(state, f)));

		// Simulate the tool's non-UI branch: hasUI=false -> error result, no calls into lib.
		const ctx = { hasUI: false, cwd: project } as never;
		const { registerVibeWiseReset } = await import(
			"../extensions/tools/vibe_wise_reset"
		);
		const registered: Array<{
			name: string;
			execute: (...args: unknown[]) => Promise<unknown>;
		}> = [];
		const fakePi = {
			registerTool: (t: never) => registered.push(t as never),
		} as never;
		registerVibeWiseReset(fakePi);
		const tool = registered[0];
		expect(tool.name).toBe("vibe_wise_reset");

		const result = (await tool.execute(
			"t1",
			{ cwd: project },
			undefined,
			undefined,
			ctx,
		)) as {
			content: { text: string }[];
			details: Record<string, unknown>;
		};
		expect(result.content[0].text).toContain("interactive");
		expect(result.details.vibeWiseIsError).toBe(true);
		expect(result.details.noUi).toBe(true);
		const after = readdirSync(state)
			.sort()
			.map((f) => readFileSync(path.join(state, f)));
		expect(after).toEqual(before);
		expect(existsSync(path.join(state, "backups"))).toBe(false);
	});

	it("confirmed flow: preview -> tool-owned confirm -> commit writes fresh notes and backup", async () => {
		const { project } = freshProject("active");
		const state = path.join(project, ".vibe-wise");
		const originals = Object.fromEntries(
			readdirSync(state)
				.sort()
				.map((f) => [f, readFileSync(path.join(state, f))] as const),
		);

		const { registerVibeWiseReset } = await import(
			"../extensions/tools/vibe_wise_reset"
		);
		const registered: Array<{
			name: string;
			execute: (...args: unknown[]) => Promise<unknown>;
		}> = [];
		registerVibeWiseReset({
			registerTool: (t: never) => registered.push(t as never),
		} as never);
		const tool = registered[0];

		let confirmCalls = 0;
		let confirmAnswer = true;
		const ctx = {
			hasUI: true,
			cwd: project,
			ui: {
				confirm: async (_title: string, message: string) => {
					confirmCalls += 1;
					expect(message).toContain("Reset VibeWise learning");
					expect(message).toContain(state);
					return confirmAnswer;
				},
			},
		} as never;

		// Step 1 — preview: READ-ONLY, no dialog, no writes.
		const preview = (await tool.execute(
			"t0",
			{},
			undefined,
			undefined,
			ctx,
		)) as {
			content: { text: string }[];
			details: { status: string; confirmation: string };
		};
		expect(preview.details.status).toBe("preview");
		expect(preview.details.confirmation).toEqual(expect.any(String));
		expect(confirmCalls).toBe(0);
		expect(readFileSync(path.join(state, "profile.md"))).toEqual(
			originals["profile.md"],
		);
		expect(existsSync(path.join(state, "backups"))).toBe(false);

		// Step 2a — commit call, user cancels: still no writes, no backup dir.
		confirmAnswer = false;
		const cancelled = (await tool.execute(
			"t1",
			{ confirmation: preview.details.confirmation },
			undefined,
			undefined,
			ctx,
		)) as {
			details: Record<string, unknown>;
		};
		expect(confirmCalls).toBe(1);
		expect(cancelled.details.cancelled).toBe(true);
		expect(readFileSync(path.join(state, "profile.md"))).toEqual(
			originals["profile.md"],
		);
		expect(existsSync(path.join(state, "backups"))).toBe(false);

		// Step 2b — commit call, user approves: fresh notes + backup of the originals.
		confirmAnswer = true;
		const committed = (await tool.execute(
			"t2",
			{ confirmation: preview.details.confirmation },
			undefined,
			undefined,
			ctx,
		)) as {
			content: { text: string }[];
			details: { status: string; backup: string };
		};
		expect(confirmCalls).toBe(2);
		expect(committed.details.status).toBe("reset");
		expect(realpathSync(committed.details.backup)).toContain(
			path.join(state, "backups"),
		);
		expect(readFileSync(path.join(state, "profile.md"))).not.toEqual(
			originals["profile.md"],
		);
		expect(readFileSync(path.join(state, "profile.md")).toString()).toContain(
			"Learning mode: active",
		);
		// Backup holds the original bytes.
		expect(
			readFileSync(path.join(committed.details.backup, "profile.md")),
		).toEqual(originals["profile.md"]);
	});

	it("refuses to commit when the notes changed between preview and confirm", async () => {
		const { project } = freshProject("active");
		const state = path.join(project, ".vibe-wise");
		const { registerVibeWiseReset } = await import(
			"../extensions/tools/vibe_wise_reset"
		);
		const registered: Array<{
			name: string;
			execute: (...args: unknown[]) => Promise<unknown>;
		}> = [];
		registerVibeWiseReset({
			registerTool: (t: never) => registered.push(t as never),
		} as never);
		const tool = registered[0];
		const ctx = {
			hasUI: true,
			cwd: project,
			ui: { confirm: async () => true },
		} as never;
		const { resetNotes } = await import("../lib/reset");
		const preview = resetNotes(project);
		// Mutate notes after the preview.
		writeFileSync(
			path.join(state, "progress.md"),
			"## Pending decision\nChanged!\n",
		);
		const failed = (await tool.execute(
			"t1",
			{ confirmation: preview.confirmation ?? "" },
			undefined,
			undefined,
			ctx,
		)) as {
			content: { text: string }[];
			details: Record<string, unknown>;
		};
		expect(failed.details.vibeWiseIsError).toBe(true);
		expect(failed.content[0].text).toContain("Target or notes changed");
	});
});

describe("vibe_wise_ask tool semantics", () => {
	async function askTool() {
		const { registerVibeWiseAsk } = await import(
			"../extensions/tools/vibe_wise_ask"
		);
		const registered: Array<{
			name: string;
			execute: (...args: unknown[]) => Promise<unknown>;
		}> = [];
		registerVibeWiseAsk({
			registerTool: (t: never) => registered.push(t as never),
		} as never);
		return registered[0];
	}

	const params = {
		title: "Next step?",
		options: [
			{ label: "Confirm", description: "Move on" },
			{ label: "Discuss", description: "Ask questions first" },
		],
	};

	it("returns the chosen label via ui.select", async () => {
		const tool = await askTool();
		const ctx = {
			hasUI: true,
			ui: {
				select: async (_title: string, options: string[]) =>
					options.find((o) => o.startsWith("Discuss")),
				input: async () => undefined,
			},
		} as never;
		const result = (await tool.execute(
			"t1",
			params,
			undefined,
			undefined,
			ctx,
		)) as {
			content: { text: string }[];
			details: Record<string, unknown>;
		};
		expect(result.content[0].text).toContain("Discuss");
		expect(result.details.answer).toBe("Discuss");
	});

	it("falls back to chat with details.fallback when hasUI is false", async () => {
		const tool = await askTool();
		const ctx = { hasUI: false } as never;
		const result = (await tool.execute(
			"t1",
			params,
			undefined,
			undefined,
			ctx,
		)) as {
			content: { text: string }[];
			details: Record<string, unknown>;
		};
		expect(result.details.fallback).toBe(true);
		expect(result.details.vibeWiseIsError).toBe(true);
		expect(result.content[0].text).toContain("Confirm — Move on");
		expect(result.content[0].text).toContain("plain chat");
	});

	it("reports cancellation as a non-error", async () => {
		const tool = await askTool();
		const ctx = { hasUI: true, ui: { select: async () => undefined } } as never;
		const result = (await tool.execute(
			"t1",
			params,
			undefined,
			undefined,
			ctx,
		)) as {
			details: Record<string, unknown>;
		};
		expect(result.details.cancelled).toBe(true);
		expect(result.details.vibeWiseIsError).toBe(false);
	});

	it("rejects option lists outside 2-4 with fallback", async () => {
		const tool = await askTool();
		const ctx = { hasUI: true, ui: { select: async () => "x" } } as never;
		const result = (await tool.execute(
			"t1",
			{ title: "?", options: [{ label: "only" }] },
			undefined,
			undefined,
			ctx,
		)) as { details: Record<string, unknown> };
		expect(result.details.fallback).toBe(true);
	});

	it("honours allowCustom through ui.input", async () => {
		const tool = await askTool();
		const ctx = {
			hasUI: true,
			ui: {
				select: async (_t: string, options: string[]) => options[0],
				input: async () => "  my own answer  ",
			},
		} as never;
		const result = (await tool.execute(
			"t1",
			{ ...params, allowCustom: true },
			undefined,
			undefined,
			ctx,
		)) as { details: Record<string, unknown> };
		expect(result.details.wasCustom).toBe(true);
		expect(result.details.answer).toBe("my own answer");
	});
});

describe("vibe_wise_questionnaire tool semantics", () => {
	async function questionnaireTool() {
		const { registerVibeWiseQuestionnaire } = await import(
			"../extensions/tools/vibe_wise_questionnaire"
		);
		const registered: Array<{
			name: string;
			execute: (...args: unknown[]) => Promise<unknown>;
		}> = [];
		registerVibeWiseQuestionnaire({
			registerTool: (t: never) => registered.push(t as never),
		} as never);
		return registered[0];
	}

	const questions = {
		questions: [
			{
				id: "experience",
				title: "Overall programming experience?",
				options: [
					{ label: "Beginner" },
					{ label: "Intermediate", description: "Some experience" },
				],
			},
			{
				id: "scope",
				title: "Learning scope?",
				options: [{ label: "Whole system" }, { label: "Parts we touch" }],
			},
		],
	};

	it("asks sequentially and maps back labels", async () => {
		const tool = await questionnaireTool();
		const titles: string[] = [];
		const ctx = {
			hasUI: true,
			ui: {
				select: async (title: string, options: string[]) => {
					titles.push(title);
					return options[0];
				},
			},
		} as never;
		const result = (await tool.execute(
			"t1",
			questions,
			undefined,
			undefined,
			ctx,
		)) as {
			details: { answers: Record<string, string> };
		};
		expect(titles).toEqual([
			questions.questions[0].title,
			questions.questions[1].title,
		]);
		expect(result.details.answers).toEqual({
			experience: "Beginner",
			scope: "Whole system",
		});
	});

	it("falls back to per-question chat when hasUI is false", async () => {
		const tool = await questionnaireTool();
		const ctx = { hasUI: false } as never;
		const result = (await tool.execute(
			"t1",
			questions,
			undefined,
			undefined,
			ctx,
		)) as {
			content: { text: string }[];
			details: Record<string, unknown>;
		};
		expect(result.details.fallback).toBe(true);
		expect(result.content[0].text).toContain("one at a time in plain chat");
	});

	it("cancel aborts with no partial answers", async () => {
		const tool = await questionnaireTool();
		let calls = 0;
		const ctx = {
			hasUI: true,
			ui: {
				select: async (_title: string, options: string[]) => {
					calls += 1;
					return calls === 1 ? options[0] : undefined;
				},
			},
		} as never;
		const result = (await tool.execute(
			"t1",
			questions,
			undefined,
			undefined,
			ctx,
		)) as {
			details: { cancelled: boolean; answers: Record<string, string> };
		};
		expect(result.details.cancelled).toBe(true);
		expect(Object.keys(result.details.answers)).toEqual([]);
		expect(calls).toBe(2);
	});
});
