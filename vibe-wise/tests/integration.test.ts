/**
 * M6 integration tests: real headless pi runs against the packaged extension.
 *
 * What this pins that unit tests cannot:
 * - the extension actually BOOTS in pi 0.84.1 (manifest resolution, tool
 *   registration, handler wiring) and the pointer is injected on a real turn
 *   (observable only via the `vibe-wise-injected` debug entry, PLAN §7.5);
 * - paused profiles get NO injection in the real runtime.
 *
 * Provider reality (see docs/development.md): opencode-go answers in ~15-20 s
 * when healthy but intermittently hangs forever. Rules enforced here:
 * - the whole file is OPT-IN via `VIBE_WISE_INTEGRATION=1`; by default both tests
 *   skip loudly with the reason below. Rationale: with a dead provider the suite
 *   spent 2×90 s proving nothing, which makes `npx vitest run` a 3-minute command
 *   and discourages running it at all. Opt-in keeps the default suite fast while
 *   still never pretending to have verified anything.
 * - every run is killed at INTEGRATION_TIMEOUT_MS (rc=null -> ctx.skip, never
 *   a silent pass — a skip is loud and reported);
 * - at most 2 pi invocations per suite (one active, one paused);
 * - everything is cleaned up in afterAll.
 *
 * Run with: `VIBE_WISE_INTEGRATION=1 npx vitest run tests/integration.test.ts`
 * (needs a live model provider; part of the release checklist).
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const PI_CLI = path.resolve(
	__dirname,
	"../node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
);
const EXTENSION = path.resolve(__dirname, "../extensions/index.ts");
const ENABLED = process.env.VIBE_WISE_INTEGRATION === "1";
const DISABLED_REASON =
	"headless integration is opt-in: run VIBE_WISE_INTEGRATION=1 npx vitest run " +
	"(requires a live model provider); see docs/development.md";
const INTEGRATION_TIMEOUT_MS = Number(
	process.env.VIBE_WISE_INTEGRATION_TIMEOUT_MS ?? 90_000,
); // cold start measured >70 s; warm ~17 s

interface RunOutcome {
	/** exit code, or null when the run was killed by our timeout */
	code: number | null;
	stdout: string;
	timedOut: boolean;
}

async function runPi(fixture: string): Promise<RunOutcome> {
	return new Promise((resolve) => {
		// Async spawn, not spawnSync: a blocking 90 s call would freeze the vitest
		// worker's RPC loop (observed as "Timeout calling onTaskUpdate").
		const child = spawn(
			process.execPath,
			[
				PI_CLI,
				"-p",
				"-a",
				"--mode",
				"json",
				"-e",
				EXTENSION,
				"reply with the single word ok",
			],
			{
				cwd: fixture,
				env: { ...process.env, VIBE_WISE_DEBUG_ENTRY: "1" },
				windowsHide: true,
			},
		);
		let stdout = "";
		let timedOut = false;
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", () => {
			// drained; stderr is not part of the contract here
		});
		const killer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, INTEGRATION_TIMEOUT_MS);
		child.on("error", () => {
			clearTimeout(killer);
			resolve({ code: null, stdout, timedOut: true });
		});
		child.on("close", (code) => {
			clearTimeout(killer);
			resolve({ code, stdout, timedOut });
		});
	});
}

function injectedEntries(stdout: string): Array<{
	stateDir: string;
	pointerLength: number;
}> {
	return stdout
		.split("\n")
		.filter((line) => line.includes('"entry_appended"'))
		.map((line) => {
			try {
				return JSON.parse(line) as {
					entry?: {
						entry?: { data?: { stateDir: string; pointerLength: number } };
					};
				};
			} catch {
				// Our own timeout kill can truncate the last stdout line. Surface good context
				// instead of a bare SyntaxError; a completed run should always be parsable.
				throw new Error(
					`unparsable JSON line mentioning entry_appended: ${line.slice(0, 120)}`,
				);
			}
		})
		.map((e) => e.entry?.entry?.data ?? { stateDir: "", pointerLength: -1 });
}

function makeFixture(profile: string | null): string {
	const root = mkdtempSync(path.join(tmpdir(), "vw-int-"));
	mkdirSync(path.join(root, ".git"));
	if (profile !== null) {
		mkdirSync(path.join(root, ".vibe-wise"));
		writeFileSync(path.join(root, ".vibe-wise", "profile.md"), profile);
		writeFileSync(path.join(root, ".vibe-wise", "progress.md"), "# P\n");
		writeFileSync(path.join(root, ".vibe-wise", "project-map.md"), "# M\n");
	}
	return root;
}

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("headless pi integration (real runtime, bounded)", () => {
	it("active profile: the pointer is injected exactly once per turn", {
		timeout: INTEGRATION_TIMEOUT_MS + 10_000,
	}, async (skipCtx) => {
		if (!ENABLED) return skipCtx.skip(DISABLED_REASON);
		expect(existsSync(PI_CLI)).toBe(true);
		const fixture = makeFixture(
			"Learning mode: active\nOnboarding: complete\n",
		);
		roots.push(fixture);

		const run = await runPi(fixture);
		// Provider hung -> explicit, LOUD skip. Never a silent pass.
		if (run.timedOut) {
			return skipCtx.skip(
				`provider did not respond within ${INTEGRATION_TIMEOUT_MS / 1000}s (run killed); ` +
					"injection mechanism is covered by unit tests (handlers + spike)",
			);
		}
		expect(run.code).toBe(0);

		const entries = injectedEntries(run.stdout);
		expect(entries).toHaveLength(1);
		expect(entries[0].stateDir).toBe(path.join(fixture, ".vibe-wise"));
		expect(entries[0].pointerLength).toBeGreaterThan(800);
		expect(entries[0].pointerLength).toBeLessThanOrEqual(1100);
	});

	it("paused profile: no injection entries at all", {
		timeout: INTEGRATION_TIMEOUT_MS + 10_000,
	}, async (skipCtx) => {
		if (!ENABLED) return skipCtx.skip(DISABLED_REASON);
		const fixture = makeFixture(
			"Learning mode: paused\nOnboarding: complete\n",
		);
		roots.push(fixture);

		const run = await runPi(fixture);
		if (run.timedOut) {
			return skipCtx.skip(
				`provider did not respond within ${INTEGRATION_TIMEOUT_MS / 1000}s (run killed); ` +
					"paused gating is covered by unit tests",
			);
		}
		expect(run.code).toBe(0);
		expect(injectedEntries(run.stdout)).toHaveLength(0);
	});
});
