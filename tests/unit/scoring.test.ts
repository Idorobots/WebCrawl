import { describe, expect, it } from "vitest";
import { scoreForRun, scoredLootCount, timedShieldState } from "../../src/client/domain/scoring";
import { CRYSTAL_INVULNERABILITY_BLINK_START_MS } from "../../src/client/domain/specs";

describe("scoring and crystal shields", () => {
  it("scores only credits, remaining crystals, and kill types", () => {
    const inventory = { credits: 3, crystals: 2, cores: 12, medkits: 4 };
    const stats = { kills: 9, fastKills: 2, slowKills: 3, sentryKills: 1, bossKills: 1, shotsFired: 20 };

    expect(scoredLootCount(inventory)).toBe(5);
    expect(scoreForRun(inventory, stats)).toBe(6_250);
  });

  it("keeps timed protection tinted until it blinks near expiry", () => {
    const activeUntil = 10_000;
    expect(timedShieldState(activeUntil, 0, CRYSTAL_INVULNERABILITY_BLINK_START_MS)).toEqual({
      active: true,
      tintVisible: true,
    });
    expect(timedShieldState(activeUntil, 8_900, CRYSTAL_INVULNERABILITY_BLINK_START_MS)).toEqual({
      active: true,
      tintVisible: false,
    });
    expect(timedShieldState(activeUntil, 8_680, CRYSTAL_INVULNERABILITY_BLINK_START_MS)).toEqual({
      active: true,
      tintVisible: true,
    });
    expect(timedShieldState(activeUntil, 10_000, CRYSTAL_INVULNERABILITY_BLINK_START_MS)).toEqual({
      active: false,
      tintVisible: false,
    });
  });
});
