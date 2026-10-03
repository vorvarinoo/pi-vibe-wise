import { describe, expect, it } from "vitest";
import { FRESH } from "../lib/reset";
import { buildPointer } from "../lib/pointer";
import { NOTE_NAMES, STATE_DIR_NAMES } from "../lib/paths";

describe("smoke", () => {
  it("lib modules load and expose the expected surface", () => {
    expect(STATE_DIR_NAMES).toEqual([".vibe-wise", ".sensible-vibes"]);
    expect(NOTE_NAMES).toEqual(["profile.md", "progress.md", "project-map.md"]);
    expect(typeof buildPointer).toBe("function");
    expect(FRESH["profile.md"].startsWith("# Learner Profile\n")).toBe(true);
  });

  it("pointer stays within the constant-size budget", () => {
    const text = buildPointer({
      pluginRoot: "/usr/local/lib/pi/packages/vibe-wise",
      skillPath: "/usr/local/lib/pi/packages/vibe-wise/skills/vibe-wise-learn/SKILL.md",
      stateDir: "/home/dev/work/some-project/.vibe-wise",
    });
    expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(1100);
  });
});
