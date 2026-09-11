import type { Decoration } from "../types";

export function applyObstacleDamage(item: Decoration, damage: number): boolean {
  if (!item.obstacle || item.destroyed || damage <= 0) return false;
  item.hp = Math.max(0, item.hp - damage);
  item.destroyed = item.hp === 0;
  return true;
}
