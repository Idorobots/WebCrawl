import { POWERUP_DEFINITIONS, POWERUP_KINDS } from "../domain/powerups";
import type { PowerupKind } from "../types";

const MULTILINE_THRESHOLD = 8;

/** Show owned types once, in pickup order, with an adjacent count for additional stacks. */
export function renderPowerupInventory(
  host: HTMLElement,
  powerups: Partial<Record<PowerupKind, number>>,
  order: readonly PowerupKind[] = POWERUP_KINDS,
): void {
  const ownedKinds = new Set(POWERUP_KINDS.filter(kind => (powerups[kind] ?? 0) > 0));
  const ordered = [
    ...order.filter(kind => ownedKinds.has(kind)),
    ...POWERUP_KINDS.filter(kind => ownedKinds.has(kind) && !order.includes(kind)),
  ];
  const inventoryKey = ordered.map(kind => `${kind}:${powerups[kind]}`).join("|");
  if (host.dataset.inventoryKey === inventoryKey) return;
  host.dataset.inventoryKey = inventoryKey;
  host.hidden = ordered.length === 0;
  host.classList.toggle("is-multiline", ordered.length > MULTILINE_THRESHOLD);
  host.replaceChildren();
  for (const kind of ordered) {
    const definition = POWERUP_DEFINITIONS[kind];
    const count = powerups[kind]!;
    const label = count > 1 ? `${definition.name} ×${count}` : definition.name;
    const slot = document.createElement("span");
    slot.className = "powerup-inventory-slot";
    slot.title = label;
    slot.dataset.powerup = kind;
    const image = document.createElement("img");
    image.src = definition.asset;
    image.alt = "";
    image.draggable = false;
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
