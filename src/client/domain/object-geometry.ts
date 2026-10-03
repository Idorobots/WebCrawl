import type { Point } from "../types";

const GEOMETRY_FIELDS = [
  "visualOffset", "destroyedVisualOffset", "hitboxOffset", "hitboxRadii", "footprintRadii",
] as const;
type GeometryField = typeof GEOMETRY_FIELDS[number];

/** Specification geometry uses unitless fractions of the object's size. */
export type RelativeGeometry = { size: number; spriteSize?: number } & Partial<Record<GeometryField, Point>>;

/** Resolved geometry uses world pixels, as required by collision and rendering. */
export type WorldGeometry<T extends RelativeGeometry> = {
  [K in keyof T]: K extends GeometryField ? Point : K extends "size" | "spriteSize" ? number : T[K];
};

export function scalePoint(point: Point, scale: number): Point {
  // Remove arithmetic noise from resolving authored ratios (e.g. 28 becoming
  // 27.999999999999996), while preserving fractional world-pixel tuning.
  return { x: Number((point.x * scale).toPrecision(15)), y: Number((point.y * scale).toPrecision(15)) };
}

/** Resolve a specification once, optionally at a different size. Does not mutate it. */
export function resolveGeometry<T extends RelativeGeometry>(definition: T, size = definition.size): WorldGeometry<T> {
  const geometry: Partial<Record<GeometryField, Point>> = {};
  for (const field of GEOMETRY_FIELDS) {
    const point = definition[field];
    if (point) geometry[field] = scalePoint(point, size);
  }
  return {
    ...definition,
    ...geometry,
    size,
    ...(definition.spriteSize !== undefined ? { spriteSize: definition.spriteSize * size / definition.size } : {}),
  } as WorldGeometry<T>;
}

export function resolveGeometryDefinitions<T extends Record<string, RelativeGeometry>>(
  definitions: T,
): { [K in keyof T]: WorldGeometry<T[K]> } {
  return Object.fromEntries(Object.entries(definitions).map(([key, definition]) =>
    [key, resolveGeometry(definition)]
  )) as { [K in keyof T]: WorldGeometry<T[K]> };
}
