import type {
  Direction,
  LootKind,
  PlayerAnimation,
  PlayerDirection,
  SpriteDirection,
  WeaponKind,
} from "./types";

export const MAX_NODES = 450;
export const MAX_ROOMS_AFTER_COALESCE = 100;
export const MAX_CHILDREN_PER_ROOM = 10;

export interface PublicFetchProxy {
  name: string;
  url: string;
  parse?: "raw" | "json";
}

export const FETCH_TIMEOUT_MS = 12_000;
export const FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const PUBLIC_FETCH_PROXIES: readonly PublicFetchProxy[] = Object.freeze([
  { name: "cors.io", url: "https://cors.io/?url={url}", parse: "json" },
]);

export const WORLD_SCALE = 1.4;
export const world = (value: number): number => Math.round(value * WORLD_SCALE);
export const ENVIRONMENT_SEGMENT_SIZE = world(128);
export const ROOM_WIDTH = ENVIRONMENT_SEGMENT_SIZE * 4;
export const ROOM_HEIGHT = ENVIRONMENT_SEGMENT_SIZE * 4;
export const CAMERA_SCALE = 1.0;
export const CAMERA_FOLLOW_LERP = 0.5;
export const CAMERA_DEADZONE_WIDTH = 180;
export const CAMERA_DEADZONE_HEIGHT = 120;
export const CAMERA_TRANSITION_MS = 450;
export const CAMERA_BOSS_PADDING = world(40);
export const HIGH_SCORE_KEY = "alien-web-crawler-high-scores-v1";

export const DIRECTIONS: Record<Direction, {
  name: Direction;
  dx: number;
  dy: number;
  opposite: Direction;
}> = {
  N: { name: "N", dx: 0, dy: -1, opposite: "S" },
  E: { name: "E", dx: 1, dy: 0, opposite: "W" },
  S: { name: "S", dx: 0, dy: 1, opposite: "N" },
  W: { name: "W", dx: -1, dy: 0, opposite: "E" },
};

const asset = (path: string): string => `assets/${path}`;

export const ASSETS = {
  backgroundTechTile: asset("environment/backgrounds/background_tech_tile.png"),
  bullet: asset("bullet.png"),
  floorPlain: asset("environment/floor/floor_plain_steel.png"),
  floorComposite: asset("environment/floor/floor_plain_composite.png"),
  floorWorn: asset("environment/floor/floor_worn_slabs.png"),
  floorCracks: asset("environment/floor/floor_steel_cracks.png"),
  floorRubble: asset("environment/floor/floor_composite_rubble.png"),
  floorDented: asset("environment/floor/floor_dented_bolts.png"),
  floorCables: asset("environment/floor/floor_exposed_cables.png"),
  floorRock: asset("environment/floor/floor_rock_grit.png"),
  floorScorched: asset("environment/floor/floor_scorched.png"),
  floorPlate: asset("environment/floor/floor_plate.png"),
  floorHex: asset("environment/floor/floor_hex.png"),
  floorHatch: asset("environment/floor/floor_hatch.png"),
  floorTread: asset("environment/floor/floor_tread.png"),
  floorAsteroidDust: asset("environment/floor/floor_asteroid_dust.png"),
  wallHorizontalTop: asset("environment/walls/wall_plain_horizontal_top.png"),
  wallHorizontalBottom: asset("environment/walls/wall_plain_horizontal_bottom.png"),
  wallVerticalLeft: asset("environment/walls/wall_plain_vertical_left.png"),
  wallVerticalRight: asset("environment/walls/wall_plain_vertical_right.png"),
  wallCornerTopLeft: asset("environment/walls/wall_corner_top_left.png"),
  wallCornerTopRight: asset("environment/walls/wall_corner_top_right.png"),
  wallCornerBottomLeft: asset("environment/walls/wall_corner_bottom_left.png"),
  wallCornerBottomRight: asset("environment/walls/wall_corner_bottom_right.png"),
  doorOpenTop: asset("environment/doors/door_plain_horizontal_open_top.png"),
  doorOpenBottom: asset("environment/doors/door_plain_horizontal_open_bottom.png"),
  doorOpenLeft: asset("environment/doors/door_plain_vertical_open_left.png"),
  doorOpenRight: asset("environment/doors/door_plain_vertical_open_right.png"),
  pedestal: asset("scenery/pedestal.png"),
  lootCrystal: asset("pickups/crystal.png"),
  lootMedkit: asset("pickups/medkit.png"),
  lootCredit: asset("pickups/ram0.png"),
  lootCore: asset("pickups/ammo_ballistic.png"),
  lootEnergy: asset("pickups/ammo_energy.png"),
} as const;

/** Floors that may tile whole rooms and corridors: undamaged materials only. */
export const BASE_FLOOR_ASSETS = [
  ASSETS.floorPlain,
  ASSETS.floorComposite,
  ASSETS.floorPlate,
  ASSETS.floorHex,
  ASSETS.floorHatch,
  ASSETS.floorTread,
  ASSETS.floorRock,
  ASSETS.floorAsteroidDust,
] as const;

/** Broken/worn floors, reserved as sparse flavour details rather than main tiles. */
export const DAMAGED_FLOOR_ASSETS = [
  ASSETS.floorWorn,
  ASSETS.floorDented,
  ASSETS.floorCracks,
  ASSETS.floorRubble,
  ASSETS.floorCables,
  ASSETS.floorScorched,
] as const;

export const FLOOR_ASSETS = [...BASE_FLOOR_ASSETS, ...DAMAGED_FLOOR_ASSETS] as const;

export const SCENERY_ASSETS = {
  plantViolet: asset("scenery/plants/plant_large_violet.png"),
  plantGreen: asset("scenery/plants/plant_large_green.png"),
  plantMagenta: asset("scenery/plants/plant_magenta.png"),
  plantTeal: asset("scenery/plants/plant_small_teal.png"),
  plantAmber: asset("scenery/plants/plant_small_amber.png"),
  barrelRed: asset("scenery/barrels/barrel_red.png"),
  barrelCoolant: asset("scenery/barrels/barrel_coolant.png"),
  barrelHazard: asset("scenery/barrels/barrel_hazard.png"),
  crateCargo: asset("scenery/crates/crate_cargo.png"),
  crateArmored: asset("scenery/crates/crate_armored.png"),
  crateMedical: asset("scenery/crates/crate_medical.png"),
  crateAmmo: asset("scenery/crates/crate_ammo.png"),
  terminal: asset("scenery/control/terminal_front.png"),
  specimenTank: asset("scenery/lab/specimen_tank.png"),
  researchBench: asset("scenery/lab/research_bench.png"),
  analyzer: asset("scenery/escape/evacuation_kiosk.png"),
  reagentRack: asset("scenery/lab/reagent_rack.png"),
  refrigerator: asset("scenery/lab/refrigerator.png"),
  roboticManipulator: asset("scenery/lab/robotic_manipulator.png"),
  pipeValve: asset("scenery/pipes/pipe_valve.png"),
  pipeElbow: asset("scenery/pipes/pipe_elbow.png"),
  coiledCables: asset("scenery/wires/coiled_cables.png"),
  monitorBank: asset("scenery/control/monitor_bank.png"),
  serverRack: asset("scenery/control/server_rack.png"),
  radarDisplay: asset("scenery/control/radar_display.png"),
  operatorTerminal: asset("scenery/control/operator_terminal.png"),
  communicationsCabinet: asset("scenery/control/communications_cabinet.png"),
  hologramTable: asset("scenery/control/hologram_table.png"),
  conduitJunction: asset("scenery/wires/conduit_junction.png"),
  powerCabinet: asset("scenery/engine/power_cabinet.png"),
  floorCables: asset("scenery/wires/floor_cables.png"),
  reactorPylon: asset("scenery/arena/reactor_pylon.png"),
  coolantPump: asset("scenery/engine/coolant_pump.png"),
  energyCapacitor: asset("scenery/arena/energy_capacitor.png"),
  barricade: asset("scenery/arena/barricade.png"),
  maintenanceRack: asset("scenery/arena/maintenance_rack.png"),
  hydraulicSupport: asset("scenery/arena/hydraulic_support.png"),
  pipeManifold: asset("scenery/pipes/pipe_manifold.png"),
  damagedFuseCabinet: asset("scenery/engine/damaged_fuse_cabinet.png"),
  cableTrunk: asset("scenery/wires/cable_trunk.png"),
  spawnerDormant: asset("scenery/spawner/dormant.png"),
  spawnerCharging: asset("scenery/spawner/charging.png"),
  spawnerDischarge: asset("scenery/spawner/discharge.png"),
  spawnerReady: asset("scenery/spawner/ready.png"),
  contentBrowserOff: asset("scenery/content/hologram_table_off.png"),
  contentBrowserTurning: asset("scenery/content/hologram_table_turning.png"),
  contentBrowserOn: asset("scenery/content/hologram_table_on.png"),
} as const;

export const DEBRIS_ASSETS = {
  barrelRedCrushed: asset("debris/barrel_red_crushed.png"),
  barrelCoolantRuptured: asset("debris/barrel_coolant_ruptured.png"),
  barrelHazardBands: asset("debris/barrel_hazard_bands.png"),
  barrelRedShards: asset("debris/barrel_red_shards.png"),
  plantGreenPot: asset("debris/plant_green_pot.png"),
  plantMagentaPot: asset("debris/plant_magenta_pot.png"),
  plantDryLeaves: asset("debris/plant_dry_leaves.png"),
  plantRoots: asset("debris/plant_roots.png"),
  crateCargo: asset("debris/crate_cargo.png"),
  crateArmored: asset("debris/crate_armored.png"),
  crateAmmo: asset("debris/crate_ammo.png"),
  crateMedical: asset("debris/crate_medical.png"),
  robotTorso: asset("debris/robot_torso.png"),
  robotLimbs: asset("debris/robot_limbs.png"),
  genericCircuit: asset("debris/generic_cables_circuit.png"),
  genericMetal: asset("debris/generic_rock_metal.png"),
} as const;

const walkFramePaths = (direction: string): string[] =>
  Array.from({ length: 4 }, (_, index) =>
    asset(`player/walk/${direction}/walk_${direction}_${String(index + 1).padStart(2, "0")}.png`),
  );

const playerIdleAssets = {
  up: asset("player/idle/player_back.png"),
  right: asset("player/idle/player_right.png"),
  down: asset("player/idle/player_front.png"),
  left: asset("player/idle/player_left.png"),
} as const;

const playerFrames = (direction: string, normalAsset: string): Record<PlayerAnimation, string[]> => {
  const walk = walkFramePaths(direction);
  return { normal: [normalAsset], walk };
};

export const PLAYER_DEFAULT_ASSETS: Record<PlayerDirection, string> = {
  up: playerIdleAssets.up,
  upRight: walkFramePaths("NE")[0]!,
  right: playerIdleAssets.right,
  downRight: walkFramePaths("SE")[0]!,
  down: playerIdleAssets.down,
  downLeft: walkFramePaths("SW")[0]!,
  left: playerIdleAssets.left,
  upLeft: walkFramePaths("NW")[0]!,
};

export const PLAYER_FRAMES: Record<PlayerDirection, Record<PlayerAnimation, string[]>> = {
  up: playerFrames("N", PLAYER_DEFAULT_ASSETS.up),
  upRight: playerFrames("NE", PLAYER_DEFAULT_ASSETS.upRight),
  right: playerFrames("E", PLAYER_DEFAULT_ASSETS.right),
  downRight: playerFrames("SE", PLAYER_DEFAULT_ASSETS.downRight),
  down: playerFrames("S", PLAYER_DEFAULT_ASSETS.down),
  downLeft: playerFrames("SW", PLAYER_DEFAULT_ASSETS.downLeft),
  left: playerFrames("W", PLAYER_DEFAULT_ASSETS.left),
  upLeft: playerFrames("NW", PLAYER_DEFAULT_ASSETS.upLeft),
};

export interface MonsterDirectionFrames {
  normal: readonly string[];
  walk?: readonly string[];
  melee?: readonly string[];
  ranged?: readonly string[];
}

export type MonsterFrameSet = Record<SpriteDirection, MonsterDirectionFrames>;

const enemyActionFrames = (directory: string, action: "walk" | "attack/melee" | "attack/shoot", direction: "front" | "back" | "right" | "left"): string[] =>
  Array.from({ length: 4 }, (_, index) =>
    asset(`enemies/${directory}/${action}/${direction}/frame_${String(index + 1).padStart(2, "0")}.png`),
  );

const enemyFrames = (
  directory: string,
  sentry = false,
): MonsterFrameSet => {
  const directionalFrames = (
    assetDirection: "front" | "back" | "right" | "left",
  ): MonsterDirectionFrames => {
    const ranged = enemyActionFrames(directory, "attack/shoot", assetDirection);
    if (sentry) return { normal: [ranged[0]!], ranged };
    const walk = enemyActionFrames(directory, "walk", assetDirection);
    return {
      normal: [walk[0]!],
      walk,
      melee: enemyActionFrames(directory, "attack/melee", assetDirection),
      ranged,
    };
  };
  return {
    up: directionalFrames("back"),
    right: directionalFrames("right"),
    left: directionalFrames("left"),
    down: directionalFrames("front"),
  };
};

export const MONSTER_FRAMES = {
  scout: enemyFrames("scout"),
  heavy: enemyFrames("heavy"),
  sentryBallistic: enemyFrames("sentry_ballistic", true),
  sentryTwin: enemyFrames("sentry_twin", true),
  sentryEnergy: enemyFrames("sentry_energy", true),
  bossArc: enemyFrames("boss_arc"),
  bossMissile: enemyFrames("boss_missile"),
  bossFortress: enemyFrames("boss_fortress"),
  bossLaser: enemyFrames("boss_laser"),
  bossSiege: enemyFrames("boss_siege"),
} as const satisfies Record<string, MonsterFrameSet>;

export const PORTAL_FRAMES = {
  up: [
    asset("portals/portal_up_inactive.png"),
    asset("portals/portal_up_activation_01.png"),
    asset("portals/portal_up_activation_02.png"),
    asset("portals/portal_up_active.png"),
  ],
  down: [
    asset("portals/portal_down_inactive.png"),
    asset("portals/portal_down_activation_01.png"),
    asset("portals/portal_down_activation_02.png"),
    asset("portals/portal_down_active.png"),
  ],
} as const;

export const WEAPON_ASSETS: Record<WeaponKind, string> = {
  "pulse-rifle": asset("pickups/weapons/assault_rifle.png"),
  "byte-repeater": asset("pickups/weapons/smg.png"),
  "scatter-array": asset("pickups/weapons/shotgun.png"),
  "fork-driver": asset("pickups/weapons/assault_rifle.png"),
  trident: asset("pickups/weapons/plasma.png"),
  "needle-rail": asset("pickups/weapons/sniper.png"),
  "packet-lobber": asset("pickups/weapons/rocket.png"),
  "cross-compiler": asset("pickups/weapons/laser.png"),
  "nova-cache": asset("pickups/weapons/flamer.png"),
  "helix-emitter": asset("pickups/weapons/arc.png"),
  "sideband-projector": asset("pickups/weapons/pistol.png"),
};

export const EXPLOSION_FRAMES = Array.from({ length: 6 }, (_, index) =>
  asset(`effects/explosion/explosion_${String(index + 1).padStart(2, "0")}.png`),
);

export const BARREL_EXPLOSION_FRAMES = Array.from({ length: 8 }, (_, index) =>
  asset(`effects/barrel_explosion/frame_${String(index + 1).padStart(2, "0")}.png`),
);

const effectFrames = (directory: string): string[] =>
  Array.from({ length: 4 }, (_, index) =>
    asset(`effects/${directory}/frame_${String(index + 1).padStart(2, "0")}.png`),
  );

export const EFFECT_FRAMES = {
  damage: effectFrames("damage"),
  healing: effectFrames("healing"),
  plantBreak: effectFrames("plant_break"),
  teleport: effectFrames("teleport"),
} as const;

export const LOOT_ASSETS: Partial<Record<LootKind, string>> = {
  credit: ASSETS.lootCredit,
  crystal: ASSETS.lootCrystal,
  core: ASSETS.lootCore,
  energy: ASSETS.lootEnergy,
  medkit: ASSETS.lootMedkit,
};

export const LOOT_RAM_FRAMES = [
  asset("pickups/ram0.png"),
  asset("pickups/ram1.png"),
  asset("pickups/ram2.png"),
  asset("pickups/ram3.png"),
] as const;
