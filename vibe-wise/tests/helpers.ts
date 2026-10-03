import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Create an isolated temp root for one test (caller removes it via rm -rf in afterEach). */
export function makeTempRoot(prefix: string): string {
	return mkdtempSync(path.join(tmpdir(), prefix));
}

/** A project dir named "project with spaces" (as in the original suite) with a `.git` directory. */
export function makeProject(root: string): string {
	const project = path.join(root, "project with spaces");
	mkdirSync(project);
	mkdirSync(path.join(project, ".git"));
	return project;
}

export const ORIGINAL_NOTES: Record<string, Buffer> = {
	"profile.md": Buffer.from(
		"Learning mode: paused\nOnboarding: complete\nAdvanced\n",
		"utf-8",
	),
	"progress.md": Buffer.from(
		"## Pending decision\nAwaiting implementation approval\n",
		"utf-8",
	),
	"project-map.md": Buffer.from(
		"# Project Map\nCLI -> service -> SQLite\n",
		"utf-8",
	),
};

/** Create `.vibe-wise` (or legacy `.sensible-vibes`) with the original suite's note bytes. */
export function makeNotes(
	project: string,
	opts: { legacy?: boolean; mode?: string } = {},
): string {
	const state = path.join(
		project,
		opts.legacy ? ".sensible-vibes" : ".vibe-wise",
	);
	mkdirSync(state);
	if (opts.legacy === true || opts.mode === undefined) {
		for (const [name, data] of Object.entries(ORIGINAL_NOTES)) {
			writeFileSync(path.join(state, name), data);
		}
	}
	if (opts.mode !== undefined) {
		writeFileSync(
			path.join(state, "profile.md"),
			"# Learner Profile\n" +
				`Learning mode: ${opts.mode}\n` +
				"Onboarding: complete\n" +
				"Checkpoint frequency: Light\n" +
				"Question style: Open-ended\n" +
				"Implementation style: AI writes code\n" +
				"Strong concepts: HTTP request flow\n",
			"utf-8",
		);
		writeFileSync(
			path.join(state, "project-map.md"),
			"# Project Map\nCLI → service.py → SQLite\n",
			"utf-8",
		);
		writeFileSync(
			path.join(state, "progress.md"),
			"# Learning Progress\n## Transactions\n" +
				"Demonstrated understanding: two writes must succeed together.\n" +
				"## Queues\nNeeds reinforcement: retries.\n",
			"utf-8",
		);
	}
	return state;
}

export type SymlinkResult = "created" | "skipped";

function tryLink(
	target: string,
	linkPath: string,
	type: "dir" | "file" | "junction",
): boolean {
	try {
		symlinkSync(target, linkPath, type);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP")
			return false;
		throw error;
	}
}

/**
 * Create a link at `linkPath` pointing to `target`.
 *
 * On POSIX this is a real symlink. On Windows a real symlink requires Developer Mode or
 * admin rights, so for directory targets we fall back to a **junction**: creatable by an
 * unprivileged user, and reported by `lstat()` exactly like a symlink
 * (`isSymbolicLink() === true`, `isDirectory() === false`) — which is the property every
 * test here depends on, including the "broken link" case (junctions to a missing target
 * can be created). File links have no junction equivalent.
 *
 * Returns "skipped" so the caller can `ctx.skip()` with an explicit reason — never a
 * silent pass.
 */
export function makeSymlinkOrSkip(
	target: string,
	linkPath: string,
	type: "dir" | "file",
): SymlinkResult {
	if (tryLink(target, linkPath, type)) return "created";
	if (
		process.platform === "win32" &&
		type === "dir" &&
		path.isAbsolute(target)
	) {
		if (tryLink(target, linkPath, "junction")) return "created";
	}
	return "skipped";
}

/** Helper for tests that must bail out when symlink privileges are missing. */
export function skipIfNoSymlinks(result: SymlinkResult): boolean {
	return result === "skipped";
}

/** Recursively copy a directory (fixture helper). */
export function copyDir(from: string, to: string): void {
	cpSync(from, to, { recursive: true });
}
