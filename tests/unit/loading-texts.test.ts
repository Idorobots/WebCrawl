import { describe, expect, it } from "vitest";
import { createThoughtPicker, LOADING_THOUGHTS } from "../../src/client/ui/loading-texts";

describe("thought picker", () => {
  it("never repeats the previous thought", () => {
    const pick = createThoughtPicker();
    let previous = pick();
    for (let i = 0; i < 500; i += 1) {
      const next = pick();
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it("eventually serves every thought", () => {
    const pick = createThoughtPicker();
    const seen = new Set<string>();
    for (let i = 0; i < LOADING_THOUGHTS.length * 3; i += 1) seen.add(pick());
    expect(seen.size).toBe(LOADING_THOUGHTS.length);
  });

  it("works with a tiny pool", () => {
    const pick = createThoughtPicker(["only"], () => 0.5);
    for (let i = 0; i < 10; i += 1) expect(pick()).toBe("only");
  });
});