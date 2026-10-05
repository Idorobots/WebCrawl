import { describe, expect, it } from "vitest";
import { lightIntersectsView, selectLightsForView } from "../../src/client/render/light-culling";

const view = { x: 0, y: 0, width: 800, height: 600 };

describe("light culling", () => {
  it.each([
    { x: -300, y: 300 }, { x: 1100, y: 300 },
    { x: 400, y: -300 }, { x: 400, y: 900 },
  ])("keeps an off-screen room light whose radius reaches the view at %j", center => {
    const light = { ...center, radius: 400 };
    expect(lightIntersectsView(light, view)).toBe(true);
    expect(selectLightsForView([light], view, 4, () => true).map(entry => entry.light)).toEqual([light]);
    expect(lightIntersectsView({ ...light, radius: 299 }, view)).toBe(false);
  });

  it("does not count a light whose bounding square overlaps only a viewport corner", () => {
    expect(lightIntersectsView({ x: -80, y: -80, radius: 100 }, view)).toBe(false);
    expect(lightIntersectsView({ x: -60, y: -80, radius: 100 }, view)).toBe(true);
  });

  it("retains a large off-screen room light ahead of closer tiny lights when the budget fills", () => {
    const room = { x: -500, y: 300, radius: 1400 };
    const auras = [390, 400, 410, 420].map(x => ({ x, y: 300, radius: 20 }));
    const selected = selectLightsForView([...auras, room], view, 4, () => true);
    expect(selected.map(entry => entry.light)).toEqual([room, auras[1], auras[0], auras[2]]);
    expect(selected).toHaveLength(4);
  });

  it("preserves visibility filters, fully off-screen culling, and unlimited-budget order", () => {
    const room = { x: 400, y: 300, radius: 300, visible: true };
    const hidden = { ...room, visible: false };
    const distant = { ...room, x: 2000 };
    const aura = { ...room, radius: 20 };
    const lights = [aura, hidden, distant, room];
    expect(selectLightsForView(lights, view, 4, light => light.visible).map(entry => entry.light)).toEqual([aura, room]);
    expect(selectLightsForView(lights, view, 0, light => light.visible)).toEqual([]);
  });
});
