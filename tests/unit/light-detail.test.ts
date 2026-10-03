import { beforeEach, describe, expect, it } from "vitest";
import {
  LIGHT_DETAIL_STORAGE_KEY,
  loadLightDetail,
  recommendedLightDetail,
  storeLightDetail,
} from "../../src/client/render/light-detail";

describe("light detail", () => {
  beforeEach(() => localStorage.removeItem(LIGHT_DETAIL_STORAGE_KEY));

  it("recommends a level from the available light capacity", () => {
    expect(recommendedLightDetail(0)).toBe("none");
    expect(recommendedLightDetail(1)).toBe("low");
    expect(recommendedLightDetail(4)).toBe("low");
    expect(recommendedLightDetail(8)).toBe("low");
    expect(recommendedLightDetail(16)).toBe("medium");
    expect(recommendedLightDetail(128)).toBe("high");
  });

  it("prefers saved choices and ignores invalid preferences", () => {
    storeLightDetail("high");
    expect(loadLightDetail(4)).toBe("high");
    localStorage.setItem(LIGHT_DETAIL_STORAGE_KEY, "invalid");
    expect(loadLightDetail(4)).toBe("low");
  });

  it("uses the recommended setting if storage is blocked", () => {
    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    } as unknown as Storage;
    expect(loadLightDetail(16, blocked)).toBe("medium");
    expect(() => storeLightDetail("none", blocked)).not.toThrow();
  });
});
