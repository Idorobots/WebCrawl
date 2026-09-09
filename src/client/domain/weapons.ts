import type {
  GraphNode,
  Point,
  WeaponKind,
  WeaponProjectile,
  WeaponSpec,
} from "../types";
import { stableHash } from "./hash";

interface WeaponBase {
  kind: WeaponKind;
  label: string;
  fireCooldownMs: number;
  projectileSpeed: number;
  projectileRange: number;
  projectileRadius: number;
  damage: number;
  maxAmmo: number;
}

export type WeaponSource = "room" | "hidden" | "boss";

const EXTRA_WEAPONS: readonly WeaponBase[] = [
  { kind: "byte-repeater", label: "BYTE REPEATER", fireCooldownMs: 92, projectileSpeed: 650, projectileRange: 760, projectileRadius: 4, damage: 1, maxAmmo: 500 },
  { kind: "scatter-array", label: "SCATTER ARRAY", fireCooldownMs: 520, projectileSpeed: 440, projectileRange: 460, projectileRadius: 4, damage: 1, maxAmmo: 50 },
  { kind: "fork-driver", label: "FORK DRIVER", fireCooldownMs: 260, projectileSpeed: 560, projectileRange: 820, projectileRadius: 5, damage: 1, maxAmmo: 100 },
  { kind: "trident", label: "TRIDENT", fireCooldownMs: 340, projectileSpeed: 540, projectileRange: 760, projectileRadius: 5, damage: 1, maxAmmo: 100 },
  { kind: "needle-rail", label: "NEEDLE RAIL", fireCooldownMs: 610, projectileSpeed: 960, projectileRange: 1_260, projectileRadius: 3, damage: 4, maxAmmo: 30 },
  { kind: "packet-lobber", label: "PACKET LOBBER", fireCooldownMs: 740, projectileSpeed: 300, projectileRange: 690, projectileRadius: 11, damage: 5, maxAmmo: 30 },
  { kind: "cross-compiler", label: "CROSS COMPILER", fireCooldownMs: 460, projectileSpeed: 500, projectileRange: 680, projectileRadius: 5, damage: 1, maxAmmo: 100 },
  { kind: "nova-cache", label: "NOVA CACHE", fireCooldownMs: 820, projectileSpeed: 420, projectileRange: 590, projectileRadius: 5, damage: 1, maxAmmo: 30 },
  { kind: "helix-emitter", label: "HELIX EMITTER", fireCooldownMs: 230, projectileSpeed: 590, projectileRange: 820, projectileRadius: 5, damage: 1, maxAmmo: 60 },
  { kind: "sideband-projector", label: "SIDEBAND PROJECTOR", fireCooldownMs: 390, projectileSpeed: 520, projectileRange: 720, projectileRadius: 5, damage: 2, maxAmmo: 200 },
];

const NAME_PREFIXES = [
  "VOID", "GHOST", "NEON", "NULL", "QUANTUM", "STATIC", "CIPHER", "VECTOR",
  "KERNEL", "CHROME", "SPECTRAL", "BINARY", "CACHE", "SIGNAL", "PHANTOM", "ROOT",
] as const;

export const DEFAULT_WEAPON: WeaponSpec = {
  kind: "pulse-rifle",
  name: "PULSE RIFLE",
  fireCooldownMs: 220,
  projectileSpeed: 520,
  projectileRange: 900,
  projectileRadius: 5,
  damage: 1,
  maxAmmo: null,
  ammoPerLoot: 0,
};

export const WEAPON_COLORS: Record<WeaponKind, number> = {
  "pulse-rifle": 0x86fff0,
  "byte-repeater": 0x72d6ff,
  "scatter-array": 0xffd166,
  "fork-driver": 0x7dffb3,
  trident: 0xb3ff66,
  "needle-rail": 0xffffff,
  "packet-lobber": 0xff8b4d,
  "cross-compiler": 0xc07cff,
  "nova-cache": 0xff70c8,
  "helix-emitter": 0x8f9cff,
  "sideband-projector": 0x5be7c4,
};

function scaled(value: number, percent: number): number {
  return Math.max(1, Math.round(value * percent / 100));
}

export function weaponForRoom(
  room: Pick<GraphNode, "tag" | "title" | "lootSeed">,
  source: WeaponSource = "room",
): WeaponSpec {
  const seed = stableHash(`${room.tag}|${room.title}|${room.lootSeed}|weapon`);
  const base = EXTRA_WEAPONS[seed % EXTRA_WEAPONS.length]!;
  const speedPercent = 90 + (stableHash(`${seed}|speed`) % 21);
  const rangePercent = 90 + (stableHash(`${seed}|range`) % 21);
  const cooldownPercent = 92 + (stableHash(`${seed}|cooldown`) % 17);
  const sourcePercent = source === "boss" ? 125 : source === "hidden" ? 115 : 100;
  const ammoPercent = (90 + (stableHash(`${seed}|ammo`) % 21)) * sourcePercent / 100;
  const maxAmmo = scaled(base.maxAmmo, ammoPercent);
  const prefix = NAME_PREFIXES[stableHash(`${room.title}|${room.tag}|weapon-name`) % NAME_PREFIXES.length]!;
  return {
    kind: base.kind,
    name: `${prefix} ${base.label}`,
    fireCooldownMs: scaled(base.fireCooldownMs, cooldownPercent),
    projectileSpeed: scaled(base.projectileSpeed, speedPercent),
    projectileRange: scaled(base.projectileRange, rangePercent),
    projectileRadius: base.projectileRadius,
    damage: base.damage,
    maxAmmo,
    ammoPerLoot: Math.max(1, Math.ceil(maxAmmo * 0.25)),
  };
}

function rotate(direction: Point, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: direction.x * cosine - direction.y * sine,
    y: direction.x * sine + direction.y * cosine,
  };
}

export function projectilesForWeapon(
  weapon: WeaponSpec,
  facing: Point,
  shotSequence = 0,
): WeaponProjectile[] {
  const patterns: Record<WeaponKind, Array<{ angle: number; lateral?: number }>> = {
    "pulse-rifle": [{ angle: 0 }],
    "byte-repeater": [{ angle: 0 }],
    "scatter-array": [-0.33, -0.22, -0.11, 0, 0.11, 0.22, 0.33].map(angle => ({ angle })),
    "fork-driver": [{ angle: 0, lateral: -10 }, { angle: 0, lateral: 10 }],
    trident: [{ angle: -0.16 }, { angle: 0 }, { angle: 0.16 }],
    "needle-rail": [{ angle: 0 }],
    "packet-lobber": [{ angle: 0 }],
    "cross-compiler": [{ angle: 0 }, { angle: Math.PI / 2 }, { angle: -Math.PI / 2 }, { angle: Math.PI }],
    "nova-cache": Array.from({ length: 8 }, (_, index) => ({ angle: index * Math.PI / 4 })),
    "helix-emitter": (shotSequence % 2 === 0 ? [-0.3, 0.12] : [-0.12, 0.3]).map(angle => ({ angle })),
    "sideband-projector": [{ angle: 0 }, { angle: Math.PI / 2 }, { angle: -Math.PI / 2 }],
  };
  return patterns[weapon.kind].map(({ angle, lateral = 0 }) => ({
    direction: rotate(facing, angle),
    lateralOffset: lateral,
    speed: weapon.projectileSpeed,
    range: weapon.projectileRange,
    radius: weapon.projectileRadius,
    damage: weapon.damage,
  }));
}

export function replenishWeaponAmmo(weapon: WeaponSpec, ammo: number | null): number | null {
  if (weapon.maxAmmo === null || ammo === null) return null;
  return Math.min(weapon.maxAmmo, ammo + weapon.ammoPerLoot);
}

export function weaponKinds(): WeaponKind[] {
  return [DEFAULT_WEAPON.kind, ...EXTRA_WEAPONS.map(weapon => weapon.kind)];
}
