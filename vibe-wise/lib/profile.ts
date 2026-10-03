import { lstat, readFile } from "node:fs/promises";

/**
 * Paused marker: a line that consists entirely of `Learning mode: paused`
 * (case-insensitive, full-line match with anchors — exact port of the
 * `re.fullmatch(r"Learning mode:\\s*paused\\s*", line, re.IGNORECASE)` check).
 */
const PAUSED_LINE = /^Learning mode:\s*paused\s*$/i;

/**
 * Learning-language whitelist (deterministic learning language). Only these
 * codes may ever reach the injected pointer; anything else in a `Language:`
 * line — a wrong code, arbitrary prose, an injection attempt — is ignored
 * entirely, so note content can never flow into the system prompt.
 */
const LANGUAGE_CODES = new Set(["en", "ru"]);

/** Full-line `Language: <code>` marker (key case-insensitive, single token). */
const LANGUAGE_LINE = /^language:\s*(\S+)\s*$/i;

/** Extract the lines of `text` (LF-separated; a trailing LF does not yield an extra empty line). */
function* linesOf(text: string): Generator<string> {
	let start = 0;
	while (start <= text.length) {
		let end = text.indexOf("\n", start);
		if (end === -1) {
			if (start === text.length) return; // trailing newline: no final empty line
			end = text.length;
		}
		yield text.slice(start, end);
		start = end + 1;
	}
}

/**
 * Normalize a candidate language value to a whitelisted code (or null).
 * Shared by the profile parser and the `VIBE_WISE_LANGUAGE` env override:
 * trim, lowercase, accept only whitelisted codes — everything else is null.
 */
export function normalizeLanguageCode(
	value: string | undefined | null,
): string | null {
	if (value === undefined || value === null) return null;
	const code = value.trim().toLowerCase();
	return LANGUAGE_CODES.has(code) ? code : null;
}

/**
 * Extract the learning language from profile text: the FIRST full-line
 * `Language: <code>` marker decides; its code must be whitelisted, otherwise
 * null. Scanning is line-by-line with the first match winning, so the result
 * is independent of the profile's total size, and no note prose is ever
 * returned — only a whitelisted code or null.
 */
export function profileLanguage(text: string): string | null {
	// Mirror TextDecoder's default BOM stripping for callers holding raw text.
	const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
	for (const line of linesOf(body)) {
		const match = LANGUAGE_LINE.exec(line);
		if (match) return normalizeLanguageCode(match[1]);
	}
	return null;
}

/** Facts derived from a single profile read. */
export interface ProfileFacts {
	/** Same semantics as `profileIsActive` (see its port notes below). */
	active: boolean;
	/** Whitelisted `Language:` code, or null (absent/unrecognized). */
	language: string | null;
}

/**
 * Read the profile ONCE and derive activation and language together (the
 * restore hook uses this so the file is not read twice per session start).
 * Failure/symlink/invalid-UTF-8 cases return `{ active: false, language: null }`
 * and never throw.
 */
export async function readProfileFacts(
	profilePath: string,
): Promise<ProfileFacts> {
	try {
		const stats = await lstat(profilePath);
		if (stats.isSymbolicLink() || !stats.isFile()) {
			return { active: false, language: null };
		}
		const buffer = await readFile(profilePath);
		// Decode as UTF-8, rejecting any invalid byte sequence like Python's open(encoding="utf-8").
		const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
		let hasContent = false;
		for (const line of linesOf(text)) {
			if (line.trim().length > 0) hasContent = true;
			if (PAUSED_LINE.test(line)) {
				return { active: false, language: null };
			}
		}
		return { active: hasContent, language: profileLanguage(text) };
	} catch {
		return { active: false, language: null }; // missing, unreadable, or invalid UTF-8
	}
}

/**
 * Check activation without copying learner notes anywhere.
 *
 * Exact port of `profile_is_active()` from the original hook:
 * - symlink or not a regular file  -> false (a linked profile could point outside
 *   the selected project's learning notes)
 * - file missing                   -> false (NOT active)
 * - any line fully matches the paused marker -> false (scanned line by line:
 *   the marker can appear after a long profile)
 * - has content, no explicit mode  -> true (older profiles lack an explicit mode)
 * - empty / whitespace-only        -> false
 * - read error / invalid UTF-8     -> false (invalid text isn't evidence of learning)
 */
export async function profileIsActive(profilePath: string): Promise<boolean> {
	// Same code path as readProfileFacts: one lstat + one read + one scan.
	return (await readProfileFacts(profilePath)).active;
}
