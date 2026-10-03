/**
 * Shared constants for the VibeWise state format.
 * Byte-compatible with the original Claude Code plugin (v0.1.43).
 */

/** State directory names, in precedence order (nearest level, first match wins). */
export const STATE_DIR_NAMES = [".vibe-wise", ".sensible-vibes"] as const;

/** The three learner note files, in canonical (FRESH/fingerprint) order. */
export const NOTE_NAMES = ["profile.md", "progress.md", "project-map.md"] as const;

export type NoteName = (typeof NOTE_NAMES)[number];

/** Directory inside the state directory that receives reset backups. */
export const BACKUP_DIR_NAME = "backups";
