import { lstatSync, statSync } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import { STATE_DIR_NAMES } from "./paths";

/** The subset of `fs.Stats` the resolution rules depend on. */
export interface DirStats {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isFile(): boolean;
}

/**
 * §6.1/`[P1]`: an existing candidate TERMINATES the search. A valid directory
 * returns its path; anything else (symlink, plain file, broken symlink) returns
 * `null` — never fall back to a parent level, which could silently load another
 * project's learner profile.
 */
function decideCandidate(stats: DirStats, candidate: string): string | null {
  return stats.isDirectory() && !stats.isSymbolicLink() ? candidate : null;
}

/**
 * §6.1: a `.git` directory OR file (worktree) is a repository boundary.
 * Reached via `stat()` (follows symlinks), matching Python's `Path.exists()`.
 */
function isGitBoundary(stats: DirStats): boolean {
  return stats.isDirectory() || stats.isFile();
}

/**
 * Find the nearest learning-notes directory without crossing a Git project boundary.
 *
 * Exact port of `state_directory()` from `_source/vibe-wise-main/hooks/session_start.py`.
 * The order of checks is significant:
 *
 * 1. At each level, check both state directory names FIRST. Any existing candidate
 *    (even an invalid one: a symlink, a plain file, a broken symlink) terminates the
 *    search immediately — a valid directory returns its path, anything else returns
 *    `null`.
 * 2. Only then check for `.git`: a `.git` directory OR a `.git` file (worktree) is a
 *    boundary — stop climbing.
 */
export async function stateDirectory(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of STATE_DIR_NAMES) {
      const candidate = path.join(dir, name);
      let stats;
      try {
        // lstat: a broken symlink still stats successfully (must NOT be skipped),
        // while a missing candidate throws ENOENT.
        stats = await lstat(candidate);
      } catch {
        continue; // candidate absent at this level
      }
      return decideCandidate(stats, candidate);
    }
    try {
      // stat (not lstat): follows symlinks, like Python's Path.exists().
      const git = await stat(path.join(dir, ".git"));
      if (isGitBoundary(git)) break;
    } catch {
      // no .git here — keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null; // filesystem root reached
    dir = parent;
  }
  return null;
}

/**
 * Synchronous twin of `stateDirectory()`, for the synchronous reset path
 * (`resetNotes()` runs the whole preview/backup/replace sequence with sync fs).
 * Both walkers share `decideCandidate()` and `isGitBoundary()` so the §6.1 rules
 * cannot drift between them.
 */
export function stateDirectorySync(cwd: string): string | null {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of STATE_DIR_NAMES) {
      const candidate = path.join(dir, name);
      let stats;
      try {
        stats = lstatSync(candidate);
      } catch {
        continue; // candidate absent at this level
      }
      return decideCandidate(stats, candidate);
    }
    try {
      const git = statSync(path.join(dir, ".git"));
      if (isGitBoundary(git)) return null;
    } catch {
      // no .git here — keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null; // filesystem root reached
    dir = parent;
  }
}
