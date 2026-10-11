import { describe, expect, it } from "vitest";
import { hudBarRatioChanged } from "../../src/client/ui/hud-bar";

describe("hud bar pulse", () => {
  it("does not pulse on the first render or when the ratio is unchanged", () => {
    expect(hudBarRatioChanged(undefined, 1)).toBe(false);
    expect(hudBarRatioChanged(0.7, 0.7)).toBe(false);
    expect(hudBarRatioChanged(1, 1)).toBe(false);
  });

  it("pulses whenever the value changes, whether from damage or healing", () => {
    expect(hudBarRatioChanged(0.7, 0.6)).toBe(true);
    expect(hudBarRatioChanged(0.6, 0.7)).toBe(true);
    expect(hudBarRatioChanged(0, 1)).toBe(true);
  });
});
