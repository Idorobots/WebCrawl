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
// Keep each environment segment exactly two floor tiles wide after integer scaling.
export const ENVIRONMENT_SEGMENT_SIZE = world(64) * 2;
export const ROOM_WIDTH = ENVIRONMENT_SEGMENT_SIZE * 4;
export const ROOM_HEIGHT = ENVIRONMENT_SEGMENT_SIZE * 4;
export const CAMERA_SCALE = 1.0;
export const MOBILE_CAMERA_SCALE = 0.6;
export const BOSS_CAMERA_SCALE = 0.8;
export const MOBILE_LAYOUT_QUERY = "(max-width: 1230px)";
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
  wallHorizontal: asset("environment/walls/wall_plain_horizontal.png"),
  wallVertical: asset("environment/walls/wall_plain_vertical.png"),
  wallCornerTopLeft: asset("environment/walls/wall_corner_top_left.png"),
  wallCornerTopRight: asset("environment/walls/wall_corner_top_right.png"),
  wallCornerBottomLeft: asset("environment/walls/wall_corner_bottom_left.png"),
  wallCornerBottomRight: asset("environment/walls/wall_corner_bottom_right.png"),
  doorHorizontal: asset("environment/doors/door_plain_horizontal_open.png"),
  doorVertical: asset("environment/doors/door_plain_vertical_open.png"),
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
  ASSETS.floorTread,
  ASSETS.floorAsteroidDust,
] as const;

/** Floors reserved as sparse decoration details rather than main tiles. */
export const FLOOR_DAMAGE_CHANCE_PERCENT = 12;

export const DAMAGED_FLOOR_ASSETS = [
  ASSETS.floorWorn,
  ASSETS.floorDented,
  ASSETS.floorCracks,
  ASSETS.floorRubble,
  ASSETS.floorCables,
  ASSETS.floorScorched,
  ASSETS.floorRock,
  ASSETS.floorHatch,
] as const;

export const FLOOR_ASSETS = [...BASE_FLOOR_ASSETS, ...DAMAGED_FLOOR_ASSETS] as const;

export const SCENERY_ASSETS = {
  plantViolet: asset("scenery/plants/plant_large_violet.png"),
  plantGreen: asset("scenery/plants/plant_large_green.png"),
  plantMagenta: asset("scenery/plants/plant_magenta.png"),
  plantTeal: asset("scenery/plants/plant_small_teal.png"),
  plantAmber: asset("scenery/plants/plant_small_amber.png"),
  planterDivider: asset("scenery/plants/planter_divider_with_green_foliage.png"),
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
  reagentRack: asset("scenery/lab/reagent_rack.png"),
  refrigerator: asset("scenery/lab/refrigerator.png"),
  roboticManipulator: asset("scenery/lab/robotic_manipulator.png"),
  medicalCabinet: asset("scenery/medical/sealed_medical_cabinet.png"),
  diagnosticScanner: asset("scenery/medical/diagnostic_scanner_arch_on_compact_base.png"),
  medicalBed: asset("scenery/medical/medical_bed_with_white_mattress_and_red_cross_panel.png"),
  vitalsMonitor: asset("scenery/medical/wall_vitals_monitor_in_armored_frame.png"),
  ivStand: asset("scenery/medical/iv_stand_with_blue_bag.png"),
  surgicalCart: asset("scenery/medical/surgical_instrument_cart.png"),
  resuscitationUnit: asset("scenery/medical/emergency_resuscitation_unit.png"),
  decontaminationShower: asset("scenery/medical/decontamination_shower_stall.png"),
  supplyTrolley: asset("scenery/medical/white_medical_supply_trolley.png"),
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
  batteryBank: asset("scenery/engine/battery_bank.png"),
  coolantReservoir: asset("scenery/engine/coolant_reservoir_with_blue_liquid.png"),
  fuelPumpSkid: asset("scenery/engine/fuel_pump_skid_with_green_tanks.png"),
  heavyMotor: asset("scenery/engine/heavy_motor_assembly.png"),
  engineToolCart: asset("scenery/engine/maintenance_tool_cart.png"),
  pressureGauge: asset("scenery/engine/pressure_gauge_console.png"),
  turbineGenerator: asset("scenery/engine/turbine_generator.png"),
  ventilationBlower: asset("scenery/engine/ventilation_blower.png"),
  heatExchanger: asset("scenery/engine/vertical_heat_exchanger.png"),
  evacuationKiosk: asset("scenery/escape/evacuation_kiosk.png"),
  dockingClamp: asset("scenery/escape/docking_clamp_fixture.png"),
  oxygenTankRack: asset("scenery/escape/life_support_oxygen_tank_rack.png"),
  openEscapeCapsule: asset("scenery/escape/same_style_escape_capsule_with_hatch_open_and_empty_seat_visible.png"),
  sealedEscapeCapsule: asset("scenery/escape/sealed_vertical_orange_escape_capsule.png"),
  emergencyBeacon: asset("scenery/escape/emergency_beacon_post.png"),
  lifeboatPod: asset("scenery/escape/low_horizontal_lifeboat_pod.png"),
  survivalCase: asset("scenery/escape/survival_supply_case.png"),
  boardingSteps: asset("scenery/escape/boarding_step_platform.png"),
  cargoPallet: asset("scenery/storage/flat_empty_cargo_pallet.png"),
  cargoShelf: asset("scenery/storage/metal_shelf_with_brown_cargo_containers.png"),
  loadingGantry: asset("scenery/storage/folding_loading_gantry.png"),
  steelCrateStack: asset("scenery/storage/stack_of_blue_steel_crates.png"),
  toolLocker: asset("scenery/storage/tool_locker_with_small_hazard_markings.png"),
  weighingPlatform: asset("scenery/storage/industrial_weighing_platform.png"),
  canisterRack: asset("scenery/storage/rack_of_colored_supply_canisters.png"),
  palletJack: asset("scenery/storage/hand_pallet_jack.png"),
  luggageStack: asset("scenery/storage/strap_secured_luggage_stack.png"),
  entertainmentScreen: asset("scenery/living/small_entertainment_screen_on_low_cabinet.png"),
  bunkBed: asset("scenery/living/two_level_bunk_bed_with_teal_bedding.png"),
  metalChair: asset("scenery/living/small_metal_chair.png"),
  showerSink: asset("scenery/living/wall_shower_and_sink_pod.png"),
  personalLocker: asset("scenery/living/personal_locker.png"),
  sofa: asset("scenery/living/sofa_with_blue_padded_seats.png"),
  kitchenette: asset("scenery/living/wall_kitchenette_unit.png"),
  messTable: asset("scenery/living/compact_mess_table_with_trays.png"),
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
  medicalMonitor: asset("debris/shattered_medical_monitor_and_vials.png"),
  medicalBed: asset("debris/broken_medical_bed_and_white_panels.png"),
  turbine: asset("debris/wrecked_turbine_with_green_tank_fragments.png"),
  motor: asset("debris/crushed_coolant_motor_and_pipe_fragments.png"),
  escapePod: asset("debris/damaged_orange_escape_pod_hull.png"),
  dockingClamp: asset("debris/broken_docking_clamp_and_oxygen_bottles.png"),
  storageShelf: asset("debris/collapsed_storage_shelf_with_splintered_boxes.png"),
  pallet: asset("debris/broken_pallet_and_spilled_packing_scraps.png"),
  bunk: asset("debris/torn_blue_bunk_mattress_and_metal_frame.png"),
  kitchenette: asset("debris/wrecked_kitchenette_and_chair_fragments.png"),
  redBarrelWreck: asset("debris/crushed_red_barrel_with_torn_lid.png"),
  blueBarrelWreck: asset("debris/ruptured_blue_coolant_barrel.png"),
  turquoiseBarrelShards: asset("debris/turquoise_barrel_shards.png"),
  yellowBarrelWreck: asset("debris/collapsed_yellow_hazard_barrel.png"),
  mixedBarrelParts: asset("debris/mixed_colored_barrel_lids_and_bands.png"),
  whiteMedicalBarrel: asset("debris/crushed_white_medical_barrel.png"),
  purpleStorageBarrel: asset("debris/dented_purple_storage_barrel.png"),
  greenChemicalBarrel: asset("debris/torn_green_chemical_barrel.png"),
  orangeFuelBarrel: asset("debris/broken_orange_fuel_barrel.png"),
  purpleEnergyCoil: asset("debris/broken_purple_energy_coil.png"),
  burntCircuits: asset("debris/burnt_circuit_boards_and_chips.png"),
  cyanMonitor: asset("debris/shattered_cyan_monitor_and_frame.png"),
  electronicsCabinet: asset("debris/split_electronics_cabinet_shell.png"),
  servoMotors: asset("debris/torn_servo_motors_and_gears.png"),
  spiderChassis: asset("debris/broken_spider_chassis_with_dark_eye.png"),
  robotLegs: asset("debris/three_severed_robot_legs.png"),
  turretHousing: asset("debris/wrecked_turret_housing.png"),
  missilePod: asset("debris/broken_missile_pod_casing.png"),
  scoutWreck: asset("debris/enemies__scout__wreck.png"),
  scoutParts: asset("debris/enemies__scout__parts.png"),
  heavyWreck: asset("debris/enemies__heavy__wreck.png"),
  heavyParts: asset("debris/enemies__heavy__parts.png"),
  sentryBallisticWreck: asset("debris/enemies__sentry_ballistic__wreck.png"),
  sentryBallisticParts: asset("debris/enemies__sentry_ballistic__parts.png"),
  sentryTwinWreck: asset("debris/enemies__sentry_twin__wreck.png"),
  sentryTwinParts: asset("debris/enemies__sentry_twin__parts.png"),
  sentryEnergyWreck: asset("debris/enemies__sentry_energy__wreck.png"),
  sentryEnergyParts: asset("debris/enemies__sentry_energy__parts.png"),
  bossArcWreck: asset("debris/enemies__boss_arc__wreck.png"),
  bossArcParts: asset("debris/enemies__boss_arc__parts.png"),
  bossMissileWreck: asset("debris/enemies__boss_missile__wreck.png"),
  bossMissileParts: asset("debris/enemies__boss_missile__parts.png"),
  bossFortressWreck: asset("debris/enemies__boss_fortress__wreck.png"),
  bossFortressParts: asset("debris/enemies__boss_fortress__parts.png"),
  bossLaserWreck: asset("debris/enemies__boss_laser__wreck.png"),
  bossLaserParts: asset("debris/enemies__boss_laser__parts.png"),
  bossSiegeWreck: asset("debris/enemies__boss_siege__wreck.png"),
  bossSiegeParts: asset("debris/enemies__boss_siege__parts.png"),
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
  "pulse-rifle": asset("pickups/weapons/pistol.png"),
  "byte-repeater": asset("pickups/weapons/smg.png"),
  "scatter-array": asset("pickups/weapons/shotgun.png"),
  "fork-driver": asset("pickups/weapons/assault_rifle.png"),
  trident: asset("pickups/weapons/plasma.png"),
  "needle-rail": asset("pickups/weapons/sniper.png"),
  "packet-lobber": asset("pickups/weapons/rocket.png"),
  "cross-compiler": asset("pickups/weapons/laser.png"),
  "nova-cache": asset("pickups/weapons/flamer.png"),
  "helix-emitter": asset("pickups/weapons/arc.png"),
  "sideband-projector": asset("pickups/weapons/assault_rifle.png"),
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
