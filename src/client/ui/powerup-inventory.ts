import { POWERUP_DEFINITIONS, POWERUP_KINDS } from "../domain/powerups";
import type { PowerupKind } from "../types";

/** Show owned types once, with an adjacent count for additional stacks. CSS fits the icons to the panel. */
export function renderPowerupInventory(host: HTMLElement, powerups: Partial<Record<PowerupKind, number>>): void {
  const owned = POWERUP_KINDS.filter(kind => (powerups[kind] ?? 0) > 0);
  const inventoryKey = owned.map(kind => `${kind}:${powerups[kind]}`).join("|");
  if (host.dataset.inventoryKey === inventoryKey) return;
  host.dataset.inventoryKey = inventoryKey;
  host.hidden = owned.length === 0;
  host.replaceChildren();
  for (const kind of owned) {
    const definition = POWERUP_DEFINITIONS[kind];
    const count = powerups[kind]!;
    const label = count > 1 ? `${definition.name} ×${count}` : definition.name;
    const slot = document.createElement("span");
    slot.className = "powerup-inventory-slot";
    slot.title = label;
    slot.dataset.powerup = kind;
    const image = document.createElement("img");
    image.src = definition.asset;
    image.alt = label;
    slot.appendChild(image);
    if (count > 1) {
      const stackCount = document.createElement("strong");
      stackCount.className = "powerup-stack-count";
      stackCount.textContent = String(count);
      stackCount.setAttribute("aria-hidden", "true");
      slot.appendChild(stackCount);
    }
    host.appendChild(slot);
  }
}
