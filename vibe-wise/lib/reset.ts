import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BACKUP_DIR_NAME, NOTE_NAMES, type NoteName } from "./paths";
import { stateDirectorySync } from "./state-directory";

/**
 * Byte-identical port of the FRESH templates from
 * `_source/vibe-wise-main/skills/reset/reset.py` (lines 13-21).
 * NOTE: "\n" escapes only — a stray "\r" would break byte-compatibility.
 */
export const FRESH: Record<NoteName, string> = {
  "profile.md":
    "# Learner Profile\n\nLearning mode: active\nOnboarding: incomplete\n" +
    "Onboarding reset: pending\n\n" +
    "Remaining onboarding: Project situation, experience, stack familiarity, " +
    "goals, and preferences.\n",
  "progress.md": "# Learning Progress\n\nNo learning events recorded yet.\n",
  "project-map.md": "# Project Map\n\nNot mapped yet. Inspect the current project.\n",
};

export interface Snapshot {
  state: string | null;
  notes: Partial<Record<NoteName, Buffer>>;
  fingerprint: string | null;
}

export interface ResetResult {
  status: "preview" | "no_notes" | "reset";
  project?: string;
  state?: string;
  files?: NoteName[];
  backup_parent?: string;
  confirmation?: string;
  backup?: string;
  cwd?: string;
}

/** Test seam: overridable I/O so failure-injection tests can run without monkey-patching globals. */
export interface ResetIo {
  writeBytes(filePath: string, data: Buffer): void;
  writeText(filePath: string, text: string): void;
  replace(source: string, target: string): void;
}

const defaultIo: ResetIo = {
  writeBytes: (filePath, data) => writeFileSync(filePath, data),
  writeText: (filePath, text) => writeFileSync(filePath, text, "utf-8"),
  replace: (source, target) => renameSync(source, target),
};

/** Allow tests to inject an alternate io implementation (exported for M5 tool wiring). */
export function setResetIo(io: Partial<ResetIo>): ResetIo {
  Object.assign(defaultIo, io);
  return defaultIo;
}

/** Snapshot used by tests; exported for the M5 extension tool. */
export function getResetIo(): ResetIo {
  return defaultIo;
}

/**
 * Read the current notes of the resolved state directory and compute the
 * confirmation fingerprint. Exact port of `snapshot()` from reset.py:
 * - missing note  -> skipped
 * - non-regular   -> ValueError("Refusing to reset non-regular note: <path>")
 * - fingerprint   = sha256(str(state)) + json.dumps([name, hex|null]) per note, in NOTE_NAMES order
 */
export function snapshotSync(cwd: string, state: string | null = null): Snapshot {
  const resolvedState = state ?? stateDirectorySync(cwd);
  if (resolvedState === null) return { state: null, notes: {}, fingerprint: null };
  const notes: Partial<Record<NoteName, Buffer>> = {};
  for (const name of NOTE_NAMES) {
    const notePath = path.join(resolvedState, name);
    let stats;
    try {
      stats = lstatSync(notePath);
    } catch {
      continue; // missing note
    }
    if (!stats.isFile()) {
      throw new Error("Refusing to reset non-regular note: " + notePath);
    }
    notes[name] = readFileSync(notePath);
  }
  const digest = createHash("sha256");
  digest.update(resolvedState);
  for (const name of NOTE_NAMES) {
    const data = notes[name];
    digest.update(JSON.stringify([name, data === undefined ? null : data.toString("hex")]));
  }
  return { state: resolvedState, notes, fingerprint: digest.digest("hex") };
}

/**
 * Preview by default; reset only a confirmed snapshot of local learning notes.
 * Exact port of `reset()` from reset.py, including error message texts.
 */
export function resetNotes(cwd: string, confirmation: string | null = null): ResetResult {
  // Match reset.py: reject a RELATIVE input before resolving (resolving first would
  // silently turn "." into the process cwd and reset the wrong project).
  if (!path.isAbsolute(cwd) || !statIsDir(cwd)) {
    throw new Error("Use an existing absolute project working directory.");
  }
  const resolvedCwd = path.resolve(cwd);
  const { state, notes, fingerprint } = snapshotSync(resolvedCwd);
  if (confirmation !== null && (Object.keys(notes).length === 0 || confirmation !== fingerprint)) {
    throw new Error("Target or notes changed. Preview and confirm again; nothing reset.");
  }
  if (Object.keys(notes).length === 0) {
    return { status: "no_notes", cwd: resolvedCwd };
  }
  const stateDir = state as string;
  const result: ResetResult = {
    status: "preview",
    project: path.dirname(stateDir),
    state: stateDir,
    files: Object.keys(notes) as NoteName[],
    backup_parent: path.join(stateDir, BACKUP_DIR_NAME),
    confirmation: fingerprint as string,
  };
  if (confirmation === null) return result;

  const backupParent = path.join(stateDir, BACKUP_DIR_NAME);
  let backupParentStats;
  try {
    backupParentStats = lstatSync(backupParent);
  } catch {
    backupParentStats = null;
  }
  if (
    (backupParentStats !== null && backupParentStats.isSymbolicLink()) ||
    (backupParentStats !== null && !backupParentStats.isDirectory())
  ) {
    throw new Error("Backup path must be a real directory; nothing reset.");
  }
  mkdirSync(backupParent, { mode: 0o700, recursive: true });
  const prefix = utcResetPrefix();
  const backup = mkdtempSync(path.join(backupParent, prefix));
  try {
    // Finish all backups and prepare replacements before touching active notes.
    for (const [name, data] of Object.entries(notes) as [NoteName, Buffer][]) {
      defaultIo.writeBytes(path.join(backup, name), data);
    }
    for (const name of NOTE_NAMES) {
      defaultIo.writeText(path.join(backup, ".new-" + name), FRESH[name]);
    }
    if (snapshotSync(resolvedCwd).fingerprint !== fingerprint) {
      throw new Error("Notes changed during backup; active notes were not reset.");
    }
    for (const name of NOTE_NAMES) {
      defaultIo.replace(path.join(backup, ".new-" + name), path.join(stateDir, name));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Reset did not complete. Backup location: ${backup}. ` +
        `Check active notes before continuing. ${message}`,
    );
  }
  return { status: "reset", project: path.dirname(stateDir), state: stateDir, backup };
}

/** `strftime("reset-%Y%m%dT%H%M%SZ-")` in UTC, matching the Python prefix format. */
function utcResetPrefix(): string {
  const now = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `reset-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z-`
  );
}

function statIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
