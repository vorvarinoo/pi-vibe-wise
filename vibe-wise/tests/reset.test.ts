import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	FRESH,
	getResetIo,
	resetNotes,
	setResetIo,
	snapshotSync,
} from "../lib/reset";
import {
	makeNotes,
	makeProject,
	makeSymlinkOrSkip,
	makeTempRoot,
	ORIGINAL_NOTES,
	skipIfNoSymlinks,
} from "./helpers";

let tempRoots: string[] = [];

/** Skipped (not silently passed) when the platform cannot create symlinks. */
const NO_SYMLINKS =
	"symlink privileges unavailable on this platform (Windows without Developer Mode)";

function fresh(): { root: string; project: string } {
	const root = makeTempRoot("vw-reset-");
	tempRoots.push(root);
	return { root, project: makeProject(root) };
}

afterEach(() => {
	for (const root of tempRoots)
		fs.rmSync(root, { recursive: true, force: true });
	tempRoots = [];
});

function preview(cwd: string) {
	return resetNotes(cwd);
}
function confirm(cwd: string) {
	const p = preview(cwd);
	return resetNotes(cwd, (p as { confirmation: string }).confirmation);
}
function originals(state: string, names = Object.keys(ORIGINAL_NOTES)) {
	const out: Record<string, Buffer> = {};
	for (const name of names) out[name] = fs.readFileSync(path.join(state, name));
	return out;
}
function assertOriginals(state: string, expected: Record<string, Buffer>) {
	for (const [name, data] of Object.entries(expected)) {
		expect(fs.readFileSync(path.join(state, name)), name).toEqual(data);
	}
}

describe("reset: preview / no side effects", () => {
	it("preview and cancel leave notes untouched", () => {
		const { project } = fresh();
		const state = makeNotes(project);
		const before = originals(state);
		const result = preview(project);
		expect(result.status).toBe("preview");
		expect(result.state).toBe(state);
		expect(result.project).toBe(project);
		assertOriginals(state, before);
		expect(fs.readdirSync(state).sort()).toEqual(
			[...Object.keys(ORIGINAL_NOTES), "backups"]
				.sort()
				.filter(
					(n) => n !== "backups" || fs.existsSync(path.join(state, "backups")),
				)
				.sort(),
		);
	});

	it("no state and empty state do not create files", () => {
		const { project } = fresh();
		expect(preview(project).status).toBe("no_notes");
		expect(fs.readdirSync(project)).toEqual([".git"]);
		const state = path.join(project, ".vibe-wise");
		fs.mkdirSync(state);
		expect(preview(project).status).toBe("no_notes");
		expect(fs.readdirSync(state)).toEqual([]);
		expect(fs.existsSync(path.join(project, "backups"))).toBe(false);
	});

	it("nested cwd resolves; legacy notes reset; .vibe-wise not created", () => {
		const { root, project } = fresh();
		const state = makeNotes(project, { legacy: true });
		const nested = path.join(project, "src");
		fs.mkdirSync(nested);
		const result = confirm(nested);
		expect(result.status).toBe("reset");
		expect(result.state).toBe(state);
		assertOriginals(result.backup as string, ORIGINAL_NOTES);
		expect(fs.existsSync(path.join(project, ".vibe-wise"))).toBe(false);
		void root;
	});

	it("preferred state resets without touching legacy", () => {
		const { project } = fresh();
		makeNotes(project);
		const legacy = makeNotes(project, { legacy: true });
		const before = originals(legacy);
		const result = confirm(project);
		expect(result.state).toBe(path.join(project, ".vibe-wise"));
		assertOriginals(legacy, before);
	});

	it("nearest state + worktree boundaries -> no_notes beyond boundary", () => {
		const { project } = fresh();
		const parentState = makeNotes(project);
		const nested = path.join(project, "package");
		fs.mkdirSync(nested);
		const childState = makeNotes(nested, { legacy: true });
		const result = confirm(nested);
		expect(result.state).toBe(childState);
		assertOriginals(parentState, originals(parentState));
		for (const [name, worktree] of [
			["nested-repo", false],
			["worktree", true],
		] as const) {
			const child = path.join(project, name);
			fs.mkdirSync(child);
			if (worktree) {
				fs.writeFileSync(
					path.join(child, ".git"),
					"gitdir: /another/repo/.git/worktrees/test",
				);
			} else {
				fs.mkdirSync(path.join(child, ".git"));
			}
			expect(preview(child).status, name).toBe("no_notes");
		}
	});

	it("symlinked state is not followed", (ctx) => {
		const { root, project } = fresh();
		const outside = path.join(root, "outside");
		fs.mkdirSync(outside);
		const target = path.join(outside, "notes");
		fs.mkdirSync(target);
		for (const [name, data] of Object.entries(ORIGINAL_NOTES)) {
			fs.writeFileSync(path.join(target, name), data);
		}
		const result = makeSymlinkOrSkip(
			target,
			path.join(project, ".vibe-wise"),
			"dir",
		);
		if (skipIfNoSymlinks(result)) ctx.skip(NO_SYMLINKS);
		expect(preview(project).status).toBe("no_notes");
		assertOriginals(target, ORIGINAL_NOTES);
	});
});

describe("reset: full reset", () => {
	it("backs up only notes and restarts onboarding; foreign files untouched", () => {
		const { root, project } = fresh();
		const state = makeNotes(project);
		const before = originals(state);
		fs.writeFileSync(path.join(project, "app.py"), "important source\n");
		fs.writeFileSync(path.join(state, "custom.md"), "keep this\n");
		const sibling = path.join(root, "another-project");
		fs.mkdirSync(sibling);
		const other = makeNotes(sibling);
		const otherBefore = originals(other);

		const result = confirm(project);
		expect(result.status).toBe("reset");
		const backup = result.backup as string;
		expect(path.dirname(backup)).toBe(path.join(state, "backups"));
		// os.replace MOVES .new-* into the state dir: backup retains only the originals
		// (same expectation as the original suite's `set(p.name for p in backup.iterdir()) == set(originals)`).
		expect(fs.readdirSync(backup).sort()).toEqual(
			Object.keys(ORIGINAL_NOTES).sort(),
		);
		assertOriginals(backup, before);
		const profile = fs.readFileSync(path.join(state, "profile.md"), "utf-8");
		expect(profile).toContain("Learning mode: active");
		expect(profile).toContain("Onboarding: incomplete");
		expect(profile).toContain("Onboarding reset: pending");
		expect(profile).not.toContain("Advanced");
		expect(
			fs.readFileSync(path.join(state, "progress.md"), "utf-8"),
		).not.toContain("Pending decision");
		expect(
			fs.readFileSync(path.join(state, "project-map.md"), "utf-8"),
		).not.toContain("SQLite");
		expect(fs.readFileSync(path.join(project, "app.py"), "utf-8")).toBe(
			"important source\n",
		);
		expect(fs.readFileSync(path.join(state, "custom.md"), "utf-8")).toBe(
			"keep this\n",
		);
		assertOriginals(other, otherBefore);
		expect(fs.existsSync(path.join(project, ".git"))).toBe(true);
	});

	it("FRESH templates are byte-identical to the original reset.py", () => {
		// Independent expectation (not reading lib code): the exact bytes from the Python source.
		const expectedProfile =
			"# Learner Profile\n\nLearning mode: active\nOnboarding: incomplete\n" +
			"Onboarding reset: pending\n\n" +
			"Remaining onboarding: Project situation, experience, stack familiarity, " +
			"goals, and preferences.\n";
		expect(FRESH["profile.md"]).toBe(expectedProfile);
		expect(FRESH["progress.md"]).toBe(
			"# Learning Progress\n\nNo learning events recorded yet.\n",
		);
		expect(FRESH["project-map.md"]).toBe(
			"# Project Map\n\nNot mapped yet. Inspect the current project.\n",
		);
		for (const text of Object.values(FRESH)) expect(text).not.toContain("\r");
		// After a reset the on-disk bytes match the templates exactly.
		const { project } = fresh();
		makeNotes(project);
		confirm(project);
		for (const [name, text] of Object.entries(FRESH)) {
			expect(fs.readFileSync(path.join(project, ".vibe-wise", name))).toEqual(
				Buffer.from(text, "utf-8"),
			);
		}
	});

	it("partial state and repeated resets preserve each backup", () => {
		const { project } = fresh();
		const state = makeNotes(project);
		const before = originals(state);
		fs.rmSync(path.join(state, "progress.md"));
		fs.rmSync(path.join(state, "project-map.md"));
		const first = (confirm(project) as { backup: string }).backup;
		expect(fs.readdirSync(first)).toEqual(["profile.md"]);
		expect(fs.readFileSync(path.join(first, "profile.md"))).toEqual(
			before["profile.md"],
		);
		const second = (confirm(project) as { backup: string }).backup;
		expect(second).not.toBe(first);
		expect(fs.readFileSync(path.join(first, "profile.md"))).toEqual(
			before["profile.md"],
		);
	});

	it("atomic replace overwrites an EXISTING note file", () => {
		const { project } = fresh();
		makeNotes(project);
		confirm(project);
		// All three notes existed before; after reset they must have FRESH bytes (overwrite, not EEXIST).
		for (const [name, text] of Object.entries(FRESH)) {
			expect(
				fs.readFileSync(path.join(project, ".vibe-wise", name)),
				name,
			).toEqual(Buffer.from(text, "utf-8"));
		}
		expect(
			fs
				.readdirSync(path.join(project, ".vibe-wise"))
				.filter((n) => n.startsWith(".new-")),
		).toEqual([]);
	});
});

describe("reset: fingerprint binding", () => {
	it("stale confirmation rejected before writes", () => {
		const { project } = fresh();
		const state = makeNotes(project);
		const token = (preview(project) as { confirmation: string }).confirmation;
		fs.writeFileSync(path.join(state, "progress.md"), "new understanding\n");
		expect(() => resetNotes(project, token)).toThrow(/changed/);
		expect(fs.readFileSync(path.join(state, "progress.md"), "utf-8")).toBe(
			"new understanding\n",
		);
		expect(fs.existsSync(path.join(state, "backups"))).toBe(false);
	});

	it("confirmation cannot target a different project", () => {
		const { root, project } = fresh();
		makeNotes(project);
		const other = path.join(root, "another-project");
		fs.mkdirSync(other);
		const otherState = makeNotes(other);
		const before = originals(otherState);
		const token = (preview(project) as { confirmation: string }).confirmation;
		expect(() => resetNotes(other, token)).toThrow(/changed/);
		assertOriginals(otherState, before);
		expect(fs.existsSync(path.join(otherState, "backups"))).toBe(false);
	});

	it("fingerprint covers identity, missing files, and content", () => {
		const { root, project } = fresh();
		const state = makeNotes(project);
		const fp1 = snapshotSync(project).fingerprint;
		// Same bytes, different directory identity -> different fingerprint.
		const project2 = path.join(root, "second project");
		fs.mkdirSync(project2);
		fs.mkdirSync(path.join(project2, ".git"));
		makeNotes(project2);
		const fp2 = snapshotSync(project2).fingerprint;
		expect(fp1).not.toBe(fp2);
		// Content change -> different fingerprint.
		fs.writeFileSync(path.join(state, "profile.md"), "changed\n");
		expect(snapshotSync(project).fingerprint).not.toBe(fp1);
		// Missing file (null) participates.
		const partial = path.join(root, "partial project");
		fs.mkdirSync(partial);
		fs.mkdirSync(path.join(partial, ".git"));
		fs.mkdirSync(path.join(partial, ".vibe-wise"));
		fs.writeFileSync(path.join(partial, ".vibe-wise", "profile.md"), "x");
		const fp3 = snapshotSync(partial).fingerprint;
		fs.writeFileSync(path.join(partial, ".vibe-wise", "progress.md"), "y");
		expect(snapshotSync(partial).fingerprint).not.toBe(fp3);
	});

	it("non-regular notes rejected", (ctx) => {
		const { project } = fresh();
		const state = makeNotes(project);
		const profilePath = path.join(state, "profile.md");
		fs.rmSync(profilePath);
		const result = makeSymlinkOrSkip(
			path.join(state, "progress.md"),
			profilePath,
			"file",
		);
		if (skipIfNoSymlinks(result)) ctx.skip(NO_SYMLINKS);
		expect(() => preview(project)).toThrow(/non-regular/);
		fs.rmSync(profilePath);
		fs.mkdirSync(profilePath);
		expect(() => preview(project)).toThrow(/non-regular/);
		expect(fs.existsSync(path.join(state, "backups"))).toBe(false);
	});

	it("symlinked backup directory rejected before notes change", (ctx) => {
		const { root, project } = fresh();
		const state = makeNotes(project);
		const before = originals(state);
		const outside = path.join(root, "outside");
		fs.mkdirSync(outside);
		const result = makeSymlinkOrSkip(
			outside,
			path.join(state, "backups"),
			"dir",
		);
		if (skipIfNoSymlinks(result)) ctx.skip(NO_SYMLINKS);
		expect(() => confirm(project)).toThrow(/Backup path/);
		assertOriginals(state, before);
		expect(fs.readdirSync(outside)).toEqual([]);
	});

	it("relative or non-existent cwd is rejected before any resolution", () => {
		const { project } = fresh();
		makeNotes(project);
		// Matches reset.py: `if not cwd.is_absolute() or not cwd.is_dir(): raise` — a relative
		// input must NOT be silently resolved against process.cwd().
		expect(() => resetNotes(".")).toThrow(
			/existing absolute project working directory/,
		);
		expect(() => resetNotes("relative/path")).toThrow(
			/existing absolute project working directory/,
		);
		expect(() => resetNotes(path.join(project, "does-not-exist"))).toThrow(
			/existing absolute project working directory/,
		);
		expect(fs.existsSync(path.join(project, ".vibe-wise", "backups"))).toBe(
			false,
		);
	});
});

describe("reset: failure injection", () => {
	it("backup failure does not modify active notes", () => {
		const { project } = fresh();
		const state = makeNotes(project);
		const before = originals(state);
		const io = getResetIo();
		const originalWriteBytes = io.writeBytes;
		setResetIo({
			writeBytes(filePath, data) {
				if (
					path.basename(filePath) === "progress.md" &&
					path.basename(path.dirname(filePath)) !== ".vibe-wise"
				) {
					throw new Error("simulated disk failure");
				}
				originalWriteBytes(filePath, data);
			},
		});
		try {
			expect(() => confirm(project)).toThrow(/did not complete/);
		} finally {
			setResetIo({ writeBytes: originalWriteBytes });
		}
		assertOriginals(state, before);
	});

	it("replacement failure keeps complete backup and reports failure", () => {
		const { project } = fresh();
		const state = makeNotes(project);
		const before = originals(state);
		const io = getResetIo();
		const originalReplace = io.replace;
		setResetIo({
			replace(source, target) {
				if (path.basename(target) === "progress.md")
					throw new Error("simulated write failure");
				originalReplace(source, target);
			},
		});
		try {
			expect(() => confirm(project)).toThrow(/Backup location/);
		} finally {
			setResetIo({ replace: originalReplace });
		}
		const backups = fs.readdirSync(path.join(state, "backups"));
		expect(backups.length).toBe(1);
		assertOriginals(path.join(state, "backups", backups[0]), before);
		// progress.md was not replaced: still the original bytes.
		expect(fs.readFileSync(path.join(state, "progress.md"))).toEqual(
			before["progress.md"],
		);
	});

	it("backup dir mode is 0o700 on POSIX", {
		skip: process.platform === "win32",
	}, () => {
		const { project } = fresh();
		makeNotes(project);
		const backup = (confirm(project) as { backup: string }).backup;
		const mode = fs.statSync(path.dirname(backup)).mode & 0o777;
		expect(mode).toBe(0o700);
	});
});
