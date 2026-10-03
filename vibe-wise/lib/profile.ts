import { lstat, readFile } from "node:fs/promises";

/**
 * Paused marker: a line that consists entirely of `Learning mode: paused`
 * (case-insensitive, full-line match with anchors — exact port of the
 * `re.fullmatch(r"Learning mode:\\s*paused\\s*", line, re.IGNORECASE)` check).
 */
const PAUSED_LINE = /^Learning mode:\s*paused\s*$/i;

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
  let stats;
  try {
    stats = await lstat(profilePath);
  } catch {
    return false; // missing
  }
  if (stats.isSymbolicLink() || !stats.isFile()) return false;

  let hasContent = false;
  try {
    const buffer = await readFile(profilePath);
    // Decode as UTF-8, rejecting any invalid byte sequence like Python's open(encoding="utf-8").
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    for (const line of linesOf(text)) {
      if (line.trim().length > 0) hasContent = true;
      if (PAUSED_LINE.test(line)) return false;
    }
  } catch {
    return false; // unreadable or invalid UTF-8
  }
  return hasContent;
}
