import type { Point } from "../types";

interface LightBounds extends Point { radius: number }
interface CameraView extends Point { width: number; height: number }

/** Use the light's full reach, including centers outside the camera view. */
export function lightIntersectsView(light: LightBounds, view: CameraView): boolean {
  const dx = Math.max(view.x - light.x, 0, light.x - (view.x + view.width));
  const dy = Math.max(view.y - light.y, 0, light.y - (view.y + view.height));
  return dx * dx + dy * dy <= light.radius * light.radius;
}

/** Under a limited shader budget, rank distance to the illuminated area rather
 * than the center. A large room light can still cover the view from far away. */
export function selectLightsForView<T extends LightBounds>(
  lights: readonly T[],
  view: CameraView,
  maxLights: number,
  canRender: (light: T) => boolean,
): Array<{ light: T; distance: number }> {
  const centerX = view.x + view.width / 2;
  const centerY = view.y + view.height / 2;
  const visible = lights.filter(light => canRender(light) && lightIntersectsView(light, view))
    .map(light => ({ light, distance: Math.hypot(light.x - centerX, light.y - centerY) - light.radius }));
  if (visible.length <= maxLights) return visible;
  return visible.sort((left, right) => left.distance - right.distance).slice(0, maxLights);
}
