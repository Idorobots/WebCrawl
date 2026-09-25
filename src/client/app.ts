import { fetchHtml, normalizeUrl } from "./api/fetch-html";
import {
  playButtonClick,
  playWelcomeAmbient,
  startInterfaceTextLoop,
  startLoadingElevator,
  stopAllMusic,
  stopInterfaceTextLoop,
  stopLoadingElevator,
} from "./audio/sfx";
import {
  LOOT_ASSETS,
  MAX_NODES,
  MOBILE_LAYOUT_QUERY,
  PLAYER_DEFAULT_ASSETS,
  PLAYER_FRAMES,
  WEAPON_ASSETS,
  world,
} from "./config";
import {
  actorAimDirection,
  actorCollisionCenter,
  actorProjectileOrigin,
  applyObstacleDamage,
  barrelExplosionTargets,
  energyDashPower,
  enemyVolleyProjectiles,
  monsterAttackIsReady,
  MONSTER_ATTACK_WARMUP_MS,
  monsterEngagementRange,
  projectileHitsCircle,
  projectileHitsDecoration,
  steerDashDirection,
  visiblePlayerHitPoint,
} from "./domain/combat";
import {
  distanceSquared,
  pointInCorridor,
  pointInRoomFloor,
  roomContainingFloorPoint,
  slideAlongObstacles,
  type CircleObstacle,
} from "./domain/geometry";
import {
  buildDecorations as createDecorations,
  buildInteractiveObjects as createInteractiveObjects,
  buildMonsters as createMonsters,
  buildSceneryDrops as createSceneryDrops,
  bossLootDrops,
  lootKindForSeed,
  monsterSpecForBossSummon,
  monsterSpecForSpawner,
  weaponPedestalForRoom,
} from "./domain/generation";
import { domToGraph } from "./domain/graph";
import { layoutOrthogonal } from "./domain/layout";
import { chooseReachablePath, monsterEscapeStep, walkableApproachPoint, walkableProjectileLine, walkableSegment } from "./domain/pathfinding";
import { closestPortalWithUrl, entryPortalFor, initialPlayerPosition, updatePortalAvailability, updatePortalContacts } from "./domain/portals";
import { scoreForRun, timedShieldState, type LootInventory } from "./domain/scoring";
import {
  BARREL_EXPLOSION_DAMAGE,
  CRYSTAL_INVULNERABILITY_BLINK_START_MS,
  CRYSTAL_INVULNERABILITY_DURATION_MS,
  DEFAULT_BULLET_SPEC,
  ENERGY_DASH_SPEED,
  ENERGY_DASH_TURN_RATE,
  HEAP_TITAN_WAVE,
  LOOT_DEFINITIONS,
  monsterVisualCenterOffsetY,
  PLAYER_DAMAGE_INVULNERABILITY_MS,
  PLAYER_ENERGY_MAX,
  PLAYER_SPEC,
  PORTAL_DEFINITION,
  WEAPON_PICKUP_DEFINITIONS,
  WORLD_GEOMETRY,
} from "./domain/specs";
import {
  DEFAULT_WEAPON,
  monsterDropsWeapon,
  projectilesForWeapon,
  replenishWeaponAmmo,
  weaponForMonster,
} from "./domain/weapons";
import type { PhaserRenderer } from "./render/phaser-renderer";
import { loadHighScores, rankHighScore, storeHighScores } from "./storage/high-scores";
import type {
  Bullet,
  BulletStyle,
  Decoration,
  DungeonGraph,
  DungeonLayout,
  GraphNode,
  HighScore,
  LayoutLink,
  LoadPageOptions,
  LootItem,
  Monster,
  MonsterState,
  ObstacleState,
  PlayerAnimation,
  PlayerDirection,
  Point,
  RunStats,
  SpriteDirection,
  Stair,
  WeaponSpec,
} from "./types";
import { requireElement } from "./ui/elements";
import { requestMobileFullscreen } from "./ui/fullscreen";
import { createThoughtPicker } from "./ui/loading-texts";
import { setupWelcomePrompt, type WelcomePromptHandle } from "./ui/welcome-prompt";

const runtimeConfig = (window as Window & {
  __WEBCRAWL_RUNTIME_CONFIG__?: { debug?: boolean };
}).__WEBCRAWL_RUNTIME_CONFIG__;
const DEBUG_MODE = runtimeConfig?.debug === true;
const MONSTERS_ENABLED = import.meta.env.VITE_NO_MONSTERS !== "true";
const PLAYER_MAX_HP = DEBUG_MODE ? 1_000 : PLAYER_SPEC.maxHp;

const gameViewport = requireElement<HTMLElement>("#gameViewport");
const gameCanvasHost = requireElement<HTMLElement>("#gameCanvas");
const moveStick = requireElement<HTMLElement>("#moveStick");
const aimStick = requireElement<HTMLElement>("#aimStick");
const bailoutButton = requireElement<HTMLButtonElement>("#bailoutButton");
const captureButton = requireElement<HTMLButtonElement>("#captureButton");
gameCanvasHost.dataset.debugMode = String(DEBUG_MODE);
gameCanvasHost.dataset.monstersEnabled = String(MONSTERS_ENABLED);
gameCanvasHost.dataset.playerMaxHp = String(PLAYER_MAX_HP);
// Start this while the welcome screen is visible so the first floor textures
// are drawn with Prefix instead of being regenerated after a fallback render.
const prefixFontReady = document.fonts?.load(`900 ${world(34)}px Prefix`).catch(() => undefined) ?? Promise.resolve();
let renderer!: PhaserRenderer;
const linkMenu = requireElement<HTMLDivElement>("#linkMenu");
const contentBrowserEl = requireElement<HTMLElement>("#contentBrowser");
const portalPreviewEl = requireElement<HTMLElement>("#portalPreview");
const portalPreviewUrlEl = requireElement<HTMLElement>("#portalPreviewUrl");
const CONTENT_BROWSER_RADIUS = world(112);
const PORTAL_PREVIEW_RADIUS = world(112);
let visibleContentPointId: string | null = null;
let visiblePortalId: string | null = null;

const welcomeScreen = requireElement<HTMLDivElement>("#welcomeScreen");
const welcomeForm = requireElement<HTMLFormElement>("#welcomeForm");
const welcomeUrlInput = requireElement<HTMLInputElement>("#welcomeUrlInput");
const luckyButton = requireElement<HTMLButtonElement>("#luckyButton");
const welcomePromptBody = requireElement<HTMLElement>("#welcomePromptBody");
const gameUi = requireElement<HTMLDivElement>("#gameUi");

const loginLayout = requireElement<HTMLDivElement>("#loginLayout");
const promptLayout = requireElement<HTMLDivElement>("#promptLayout");
const loginForm = requireElement<HTMLFormElement>("#loginForm");
const loginFields = [
  requireElement<HTMLInputElement>("#loginUsername"),
  requireElement<HTMLInputElement>("#loginPassword"),
];

let welcomePrompt: WelcomePromptHandle | null = null;
let welcomeSessionStarted = false;

// The welcome screen (login panel first) fades in once fonts and images have
// settled, so early interactions do not hit mid-layout elements.
const imagesReady = Promise.all(
  Array.from(document.images, (img) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      }),
  ),
);
void Promise.race([
  Promise.all([document.fonts?.ready ?? Promise.resolve(), imagesReady]),
  new Promise<void>((resolve) => window.setTimeout(resolve, 1200)),
]).then(() => {
  welcomeScreen.classList.add("welcome-ready");
});

const sideMinimapCanvas = requireElement<HTMLCanvasElement>("#sideMinimapCanvas");
const sideFloorLabelEl = requireElement<HTMLElement>("#sideFloorLabel");

let currentRequest = 0;
let currentPageUrl: string | null = null;
let currentStateId: string | null = null;
let gameStarted = false;
let initialFloorPortalIntroPending = true;
const navigationHistory: string[] = [];
const navigationReturnRooms: Array<number | null> = [];

let currentLayout: DungeonLayout | null = null;
let currentGraph: DungeonGraph | null = null;
interface FloorSnapshot {
  graph: DungeonGraph;
  layout: DungeonLayout;
  url: string;
}
const floorSnapshots = new Map<string, FloorSnapshot>();
let currentRoomsById = new Map<number, GraphNode>();
let currentStairs: Stair[] = [];
let currentLoot: LootItem[] = [];
let currentMonsters: Monster[] = [];
let currentDecorations: Decoration[] = [];
let currentSpawners: Decoration[] = [];
const destroyedObstaclesByPage = new Map<string, Map<string, ObstacleState>>();
let visitedRooms = new Set<number>();
let roomRoutingDirty = true;
let nextRoomTowardPlayer = new Map<number, number>();
const SPATIAL_CELL_SIZE = WORLD_GEOMETRY.spatialCellSize;
interface GeometryCell {
  rooms: Set<GraphNode>;
  links: Set<LayoutLink>;
}
let geometryCells = new Map<string, GeometryCell>();
let obstacleCells = new Map<string, Set<Decoration>>();
let damageableCells = new Map<string, Set<Decoration>>();
const discoveredRoomsByPage = new Map<string, Set<number>>();
const monsterStatesByPage = new Map<string, Map<string, MonsterState>>();

let currentRoomId: number | null = null;
let player: Point = { x: 0, y: 0 };
let playerFacing: Point = { x: 0, y: -1 };
let playerHp: number = PLAYER_MAX_HP;
let playerAlive = true;
let playerInvulnerable = false;
let crystalInvulnerableUntil = 0;
let crystalShieldSoundActive = false;
let playerDamageInvulnerableUntil = 0;
let energyDash: {
  dirX: number;
  dirY: number;
  traveled: number;
  maxDistance: number;
  damage: number;
  hitTargets: Set<string>;
  playerInvulnerableBefore: boolean;
} | null = null;
let lastPlayerShotAt = -Infinity;
let currentWeapon: WeaponSpec = { ...DEFAULT_WEAPON };
let currentWeaponAmmo: number | null = null;
let weaponShotSequence = 0;

let bullets: Bullet[] = [];
const extraLootByPage = new Map<string, LootItem[]>();
const extraLootSerialByPage = new Map<string, number>();
let lastDroppedWeapon: LootItem | null = null;
let queuedLootDrops: LootItem[] = [];
const temporarilyBlockedLoot = new Set<string>();

const GAME_TICK_INTERVAL_MS = 1_000 / 60;
let gameAnimationFrame: number | null = null;
let lastGameTick: number | null = null;
let nextGameTick: number | null = null;
let gameLoopSuspended = false;

const lootInventory: LootInventory = { credits: 0, crystals: 0, cores: 0, energy: 0, medkits: 0 };
const collectedLoot = new Set<string>();

const runStats: RunStats = {
  kills: 0,
  fastKills: 0,
  slowKills: 0,
  sentryKills: 0,
  bossKills: 0,
  shotsFired: 0
};

let playerWalkFrameIndex = 0;
let lastPlayerWalkFrameAt = -Infinity;
let playerSpriteAnimationToken = 0;
let playerMoving = false;
let playerShooting = false;
let currentPlayerSpriteAsset = PLAYER_DEFAULT_ASSETS.up;
let primaryPointerDown = false;
let pointerInViewport = false;
let pointerClientPosition: Point | null = null;
let playerAimDirty = false;
let lastAimCamera: Point | null = null;
let portalTransitioning = false;
let teleportPauseActive = false;
const portalContacts = new Set<string>();
const PORTAL_INTRO_DURATION_MS = 2_000;
const PORTAL_INTRO_SOUND_DELAY_MS = 1_000;
let portalIntroTimer: number | null = null;
let portalIntroSoundTimer: number | null = null;
const PORTAL_ACTIVATION_SOUND_DELAY_MS = 1_000;
let portalActivationSoundTimer: number | null = null;

function setTeleportPaused(active: boolean): void {
  teleportPauseActive = active;
  gameCanvasHost.dataset.gamePaused = String(active);
}
const heldMovementKeys = new Set<string>();

const killsCountEl = document.querySelector<HTMLElement>("#killsCount");
const hudHealthFillEl = requireElement<HTMLElement>("#hudHealthFill");
const creditCountEl = requireElement<HTMLElement>("#creditCount");
const crystalCountEl = requireElement<HTMLElement>("#crystalCount");
const coreCountEl = requireElement<HTMLElement>("#coreCount");
const energyLootCountEl = requireElement<HTMLElement>("#energyLootCount");
const medkitCountEl = requireElement<HTMLElement>("#medkitCount");
const hudEnergyFillEl = requireElement<HTMLElement>("#hudEnergyFill");
const weaponNameEl = requireElement<HTMLElement>("#weaponName");
const hudAmmoFillEl = requireElement<HTMLElement>("#hudAmmoFill");
const weaponHudIconEl = requireElement<HTMLImageElement>("#weaponHudIcon");
const hudHealthFillMiniEl = requireElement<HTMLElement>("#hudHealthFillMini");
const hudEnergyFillMiniEl = requireElement<HTMLElement>("#hudEnergyFillMini");
const hudAmmoFillMiniEl = requireElement<HTMLElement>("#hudAmmoFillMini");
const creditCountMiniEl = requireElement<HTMLElement>("#creditCountMini");
const crystalCountMiniEl = requireElement<HTMLElement>("#crystalCountMini");
const coreCountMiniEl = requireElement<HTMLElement>("#coreCountMini");
const energyLootCountMiniEl = requireElement<HTMLElement>("#energyLootCountMini");
const medkitCountMiniEl = requireElement<HTMLElement>("#medkitCountMini");
const rightHud = requireElement<HTMLElement>("#rightHud");

const deathModal = requireElement<HTMLDivElement>("#deathModal");
const deathScoreEl = requireElement<HTMLElement>("#deathScore");
const newHighScoreEl = requireElement<HTMLElement>("#newHighScore");
const deathKillsEl = requireElement<HTMLElement>("#deathKills");
const deathFastKillsEl = requireElement<HTMLElement>("#deathFastKills");
const deathSlowKillsEl = requireElement<HTMLElement>("#deathSlowKills");
const deathSentryKillsEl = requireElement<HTMLElement>("#deathSentryKills");
const deathBossKillsEl = requireElement<HTMLElement>("#deathBossKills");
const deathShotsEl = requireElement<HTMLElement>("#deathShots");
const deathLootCreditsEl = requireElement<HTMLElement>("#deathLootCredits");
const deathLootCrystalsEl = requireElement<HTMLElement>("#deathLootCrystals");
const deathLootCoresEl = requireElement<HTMLElement>("#deathLootCores");
const deathLootEnergyEl = requireElement<HTMLElement>("#deathLootEnergy");
const deathLootMedkitsEl = requireElement<HTMLElement>("#deathLootMedkits");
const highScoreRowsEl = requireElement<HTMLTableSectionElement>("#highScoreRows");
const restartButton = requireElement<HTMLButtonElement>("#restartButton");

const urlBar = requireElement<HTMLDivElement>("#urlBar");
const urlBarText = requireElement<HTMLElement>("#urlBarText");

const fetchErrorModal = requireElement<HTMLDivElement>("#fetchErrorModal");
const fetchErrorMessageEl = requireElement<HTMLElement>("#fetchErrorMessage");
const fetchErrorDetailEl = requireElement<HTMLElement>("#fetchErrorDetail");
const fetchErrorDismissButton = requireElement<HTMLButtonElement>("#fetchErrorDismissButton");

function setStatus(message: string, isError = false): void {
  if (isError) {
    console.error(`[WebCrawl] ${message}`);
  } else {
    console.log(`[WebCrawl] ${message}`);
  }
}

const URL_BAR_MAX_LENGTH = 64;

function elideUrl(url: string): string {
  if (url.length <= URL_BAR_MAX_LENGTH) return url;
  const head = Math.ceil((URL_BAR_MAX_LENGTH - 1) / 2);
  const tail = Math.floor((URL_BAR_MAX_LENGTH - 1) / 2);
  return `${url.slice(0, head)}…${url.slice(url.length - tail)}`;
}

function updateUrlBar(): void {
  if (!currentPageUrl) return;
  urlBar.hidden = false;
  urlBarText.textContent = elideUrl(currentPageUrl);
  urlBar.title = currentPageUrl;
}

function hideLinkMenu(): void {
  linkMenu.hidden = true;
  linkMenu.replaceChildren();
}

let dismissedContentPointId: string | null = null;

function dismissContentBrowser(): void {
  dismissedContentPointId = visibleContentPointId;
  contentBrowserEl.hidden = true;
}

function hideContentBrowser(): void {
  contentBrowserEl.hidden = true;
  visibleContentPointId = null;
  dismissedContentPointId = null;
}

function hidePortalPreview(): void {
  portalPreviewEl.hidden = true;
  visiblePortalId = null;
}

function renderPortalPreview(): void {
  const closest = closestPortalWithUrl(
    currentStairs.filter(stair => visitedRooms.has(stair.roomId)),
    player,
    PORTAL_PREVIEW_RADIUS,
  );
  if (!closest) {
    hidePortalPreview();
    return;
  }
  if (visiblePortalId !== closest.id) {
    portalPreviewUrlEl.textContent = closest.url;
    visiblePortalId = closest.id;
  }
  portalPreviewEl.hidden = false;
}

function renderContentBrowser(): void {
  const point = currentDecorations.find(item =>
    item.contentPoint &&
    item.contentEnabled &&
    !item.destroyed &&
    distanceSquared(player, item) <= CONTENT_BROWSER_RADIUS * CONTENT_BROWSER_RADIUS
  );
  const room = point ? currentRoomsById.get(point.roomId) : undefined;
  if (!point || !room?.contentHtml) {
    hideContentBrowser();
    return;
  }
  if (visibleContentPointId === point.id) {
    if (dismissedContentPointId !== point.id) contentBrowserEl.hidden = false;
    return;
  }

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "content-browser-close";
  closeButton.setAttribute("aria-label", "Close recovered content");
  closeButton.textContent = "×";

  const heading = document.createElement("h2");
  heading.textContent = room.floorLabel;
  const content = document.createElement("div");
  content.className = "content-browser-body";
  // contentHtml is reduced to a fixed allowlist while the fetched page is parsed.
  content.innerHTML = room.contentHtml;
  closeButton.addEventListener("click", dismissContentBrowser);
  contentBrowserEl.replaceChildren(closeButton, heading, content);
  contentBrowserEl.hidden = false;
  visibleContentPointId = point.id;
  dismissedContentPointId = null;
}

function navigateTo(url: string, returnRoomId = currentRoomId): Promise<void> {
  hideLinkMenu();
  const nextStateId = stateIdForPage(url, floorNumber() + 1);
  return loadPage(url, {
    pushCurrent: true,
    returnRoomId,
    stateId: nextStateId,
  });
}

function goBack(): Promise<void> {
  const previous = navigationHistory[navigationHistory.length - 1];
  if (!previous) return Promise.resolve();

  const returnRoomId =
    navigationReturnRooms[navigationReturnRooms.length - 1] ?? null;

  hideLinkMenu();
  const previousStateId = stateIdForPage(previous, Math.max(1, floorNumber() - 1));
  return loadPage(previous, {
    popBack: true,
    spawnRoomId: returnRoomId,
    stateId: previousStateId,
  });
}

document.addEventListener("click", (event) => {
  if (event.target instanceof Node && !linkMenu.contains(event.target)) hideLinkMenu();
});

function roomContainingPoint(x: number, y: number): GraphNode | null {
  if (!currentLayout) return null;
  return roomContainingFloorPoint(currentLayout.nodes, { x, y });
}

function updateFogOfWar(): void {
  renderer.setFog(visitedRooms);

  if (!gameUi.hidden) {
    updateHudPanels();
  }
}

function markVisited(room: GraphNode | null): void {
  if (!room || visitedRooms.has(room.id)) return;

  visitedRooms.add(room.id);
  roomRoutingDirty = true;

  if (currentPageUrl) {
    discoveredRoomsByPage.set(currentStateId ?? currentPageUrl, new Set(visitedRooms));
  }

  updateFogOfWar();
  activateMonstersInRoom(room.id);
  renderDecorations();
  renderInteractiveObjects();
}

function pointInCommittedForkBranch(x: number, y: number, link: LayoutLink): boolean {
  if (link.forkPointIndex === undefined) return pointInCorridor(x, y, link, 0);
  const fork = link.points[link.forkPointIndex];
  const next = link.points[link.forkPointIndex + 1];
  if (!fork || !next) return false;
  const length = Math.hypot(next.x - fork.x, next.y - fork.y);
  if (!length) return false;
  const branchProgress = (
    (x - fork.x) * (next.x - fork.x) +
    (y - fork.y) * (next.y - fork.y)
  ) / length;
  if (branchProgress <= link.width / 2) return false;
  return pointInCorridor(x, y, { ...link, points: link.points.slice(link.forkPointIndex) }, 0);
}

function revealRoomsFromCorridor(x: number, y: number): void {
  const link = currentLayout?.links.find(candidate => pointInCommittedForkBranch(x, y, candidate)) ?? null;
  if (!link) return;

  // If either end of this corridor is already known, reveal the other end.
  // This lets the player see/activate the destination before crossing a
  // doorway that might be obstructed by generated room props.
  const sourceVisited = visitedRooms.has(link.source.id);
  const targetVisited = visitedRooms.has(link.target.id);

  if (sourceVisited && !targetVisited) {
    markVisited(link.target);
  } else if (targetVisited && !sourceVisited) {
    markVisited(link.source);
  }
}

function updateCurrentRoom(): void {
  const room = roomContainingPoint(player.x, player.y);

  if (room) {
    const roomChanged = currentRoomId !== room.id;
    const alreadyVisited = visitedRooms.has(room.id);
    currentRoomId = room.id;
    gameCanvasHost.dataset.currentRoomTag = room.tag;
    if (roomChanged) roomRoutingDirty = true;
    markVisited(room);
    if (roomChanged && alreadyVisited && !gameUi.hidden) updateHudPanels();
  }
}

function updateCameraForPlayer(immediate = false): void {
  if (immediate) renderer.setCameraTarget(player, true);
  renderer.setCameraRoom(roomContainingPoint(player.x, player.y), immediate);
}

function minimapVisibleLayout(): Pick<DungeonLayout, "nodes" | "links"> {
  if (!currentLayout) return { nodes: [], links: [] };

  const visibleIds = new Set(
    currentLayout.nodes
      .filter(room => visitedRooms.has(room.id))
      .map(room => room.id)
  );

  return {
    nodes: currentLayout.nodes.filter(room => visibleIds.has(room.id)),
    links: currentLayout.links.filter(link =>
      visibleIds.has(link.source.id) || visibleIds.has(link.target.id)
    )
  };
}

function renderSideMinimap(): void {
  const { nodes, links } = minimapVisibleLayout();
  const visibleIds = new Set(nodes.map(node => node.id));
  const boundsRect = sideMinimapCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(boundsRect.width || sideMinimapCanvas.clientWidth || 320));
  const height = Math.max(1, Math.round(boundsRect.height || sideMinimapCanvas.clientHeight || 220));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  sideMinimapCanvas.width = Math.round(width * ratio);
  sideMinimapCanvas.height = Math.round(height * ratio);
  const context = sideMinimapCanvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(7, 16, 24, 0.6)";
  context.fillRect(0, 0, width, height);
  if (!nodes.length) return;

  const bounds = nodes.reduce((acc, node) => ({
    minX: Math.min(acc.minX, node.x - node.width / 2),
    maxX: Math.max(acc.maxX, node.x + node.width / 2),
    minY: Math.min(acc.minY, node.y - node.height / 2),
    maxY: Math.max(acc.maxY, node.y + node.height / 2)
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity
  });

  for (const link of links) {
    for (const point of link.points) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
  }
  const pad = Math.min(18, Math.round(width * 0.06));
  const compact = width < 200;
  const scale = Math.min(
    (width - pad * 2) / Math.max(1, bounds.maxX - bounds.minX),
    (height - pad * 2) / Math.max(1, bounds.maxY - bounds.minY),
  );
  const mapX = (x: number): number => pad + (x - bounds.minX) * scale;
  const mapY = (y: number): number => pad + (y - bounds.minY) * scale;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#315267";
  context.lineWidth = Math.max(compact ? 1.5 : 2, 20 * scale);
  for (const link of links) {
    context.beginPath();
    link.points.forEach((point, index) => index
      ? context.lineTo(mapX(point.x), mapY(point.y))
      : context.moveTo(mapX(point.x), mapY(point.y))
    );
    context.stroke();
  }
  for (const room of nodes) {
    const x = mapX(room.x - room.width / 2);
    const y = mapY(room.y - room.height / 2);
    const roomWidth = Math.max(compact ? 2 : 3, room.width * scale);
    const roomHeight = Math.max(compact ? 2 : 3, room.height * scale);
    context.fillStyle = room.id === currentRoomId ? "#57d9c1" : room.isRoot ? "#244d59" : "#1a303e";
    context.fillRect(x, y, roomWidth, roomHeight);
    context.strokeStyle = room.id === currentRoomId ? "#bafff1" : "#568198";
    context.lineWidth = 1;
    context.strokeRect(x, y, roomWidth, roomHeight);
  }
  for (const stair of currentStairs.filter(item => visibleIds.has(item.roomId))) {
    context.fillStyle = stair.type === "up" ? "#62e6c8" : "#c07cff";
    context.beginPath();
    context.arc(mapX(stair.x), mapY(stair.y), compact ? 2 : 3, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(mapX(player.x), mapY(player.y), compact ? 3 : 4, 0, Math.PI * 2);
  context.fill();
}

const MINIMAP_SHOW_DELAY_MS = 1600;
const mobileLayoutQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
let minimapActivityHidden = false;
let lastPlayerActivityAt = 0;
let lastActivityPlayerPos: Point | null = null;

function updateMinimapVisibility(now: number): void {
  if (
    lastActivityPlayerPos === null ||
    player.x !== lastActivityPlayerPos.x ||
    player.y !== lastActivityPlayerPos.y
  ) {
    lastActivityPlayerPos = { x: player.x, y: player.y };
    lastPlayerActivityAt = now;
  }
  const shouldHide = mobileLayoutQuery.matches
    && lastPlayerActivityAt > 0
    && now - lastPlayerActivityAt < MINIMAP_SHOW_DELAY_MS;
  if (shouldHide === minimapActivityHidden) return;
  minimapActivityHidden = shouldHide;
  rightHud.classList.toggle("minimap-hidden", minimapActivityHidden);
}

function updateHudPanels(): void {
  const floor = navigationHistory.length + 1;
  const rooms = visitedRooms.size;

  sideFloorLabelEl.textContent = `FLOOR ${floor}`;
  gameCanvasHost.dataset.visitedRooms = String(rooms);
  gameCanvasHost.dataset.floor = String(floor);
  gameCanvasHost.dataset.kills = String(runStats.kills);
  gameCanvasHost.dataset.shotsFired = String(runStats.shotsFired);
  renderSideMinimap();
}

function floorNumber(): number {
  return navigationHistory.length + 1;
}

function stateIdForPage(url: string, floor = floorNumber()): string {
  return `${url}::floor-${floor}`;
}

function floorIdentity(pageUrl: string): string {
  return currentStateId ?? stateIdForPage(pageUrl);
}

const hudBarPulseAnimations = new WeakMap<HTMLElement, Animation>();

function updateHudBarFill(fill: HTMLElement, miniFill: HTMLElement, ratio: number): void {
  const width = `${ratio * 100}%`;
  const changed = fill.style.width !== "" && fill.style.width !== width;
  const reduceMotion = changed && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (const element of [fill, miniFill]) {
    element.style.width = width;
    if (!changed) continue;

    const track = element.parentElement;
    if (!track) continue;
    hudBarPulseAnimations.get(track)?.cancel();
    if (reduceMotion) continue;

    hudBarPulseAnimations.set(track, track.animate([
      { filter: "brightness(1)" },
      { filter: "brightness(1.65)" },
      { filter: "brightness(1)" },
    ], { duration: 380, easing: "ease-out" }));
  }
}

function updateHealthUi(): void {
  const ratio = Math.max(0, Math.min(1, playerHp / PLAYER_MAX_HP));
  updateHudBarFill(hudHealthFillEl, hudHealthFillMiniEl, ratio);
  hudHealthFillEl.parentElement?.classList.toggle("is-critical", ratio < 0.2);
  hudHealthFillMiniEl.parentElement?.classList.toggle("is-critical", ratio < 0.2);
  gameCanvasHost.dataset.playerHp = String(playerHp);

  renderer.setPlayer(player, playerHp, PLAYER_MAX_HP, currentPlayerSpriteAsset);
}

function updateWeaponUi(): void {
  weaponNameEl.textContent = currentWeapon.name;
  weaponHudIconEl.src = WEAPON_ASSETS[currentWeapon.kind];
  const ammoRatio = currentWeaponAmmo === null
    ? 1
    : Math.max(0, Math.min(1, currentWeaponAmmo / Math.max(1, currentWeapon.maxAmmo ?? currentWeaponAmmo)));
  updateHudBarFill(hudAmmoFillEl, hudAmmoFillMiniEl, ammoRatio);
  gameCanvasHost.dataset.weaponKind = currentWeapon.kind;
  gameCanvasHost.dataset.weaponAmmo = currentWeaponAmmo === null ? "infinite" : String(currentWeaponAmmo);
}

function updateLootUi(): void {
  creditCountEl.textContent = String(lootInventory.credits);
  crystalCountEl.textContent = String(lootInventory.crystals);
  coreCountEl.textContent = String(lootInventory.cores);
  energyLootCountEl.textContent = String(lootInventory.energy);
  medkitCountEl.textContent = String(lootInventory.medkits);
  creditCountMiniEl.textContent = String(lootInventory.credits);
  crystalCountMiniEl.textContent = String(lootInventory.crystals);
  coreCountMiniEl.textContent = String(lootInventory.cores);
  energyLootCountMiniEl.textContent = String(lootInventory.energy);
  medkitCountMiniEl.textContent = String(lootInventory.medkits);
  gameCanvasHost.dataset.credits = String(lootInventory.credits);
  gameCanvasHost.dataset.crystals = String(lootInventory.crystals);
  gameCanvasHost.dataset.cores = String(lootInventory.cores);
  gameCanvasHost.dataset.energy = String(lootInventory.energy);
  gameCanvasHost.dataset.medkits = String(lootInventory.medkits);
  updateEnergyUi();
  updateHudPanels();
}

function updateEnergyUi(): void {
  const fill = Math.min(PLAYER_ENERGY_MAX, lootInventory.energy);
  updateHudBarFill(hudEnergyFillEl, hudEnergyFillMiniEl, fill / PLAYER_ENERGY_MAX);
  const full = lootInventory.energy >= PLAYER_ENERGY_MAX;
  hudEnergyFillEl.parentElement?.classList.toggle("is-full", full);
  hudEnergyFillMiniEl.parentElement?.classList.toggle("is-full", full);
}

function isPlayerInvulnerable(now = performance.now()): boolean {
  return playerInvulnerable || now < crystalInvulnerableUntil || now < playerDamageInvulnerableUntil;
}

function updatePlayerProtectionVisual(now = performance.now()): void {
  if (crystalShieldSoundActive && now >= crystalInvulnerableUntil) {
    crystalShieldSoundActive = false;
    renderer?.playInvulnerabilitySound(false);
  }
  const timedShield = timedShieldState(
    crystalInvulnerableUntil,
    now,
    CRYSTAL_INVULNERABILITY_BLINK_START_MS,
  );
  const active = playerInvulnerable || timedShield.active;
  const tintVisible = playerInvulnerable || timedShield.tintVisible;
  renderer.setPlayerProtection(active, tintVisible);
}

function activateCrystalInvulnerability(now = performance.now()): boolean {
  if (!playerAlive || lootInventory.crystals <= 0) return false;
  lootInventory.crystals -= 1;
  crystalInvulnerableUntil = now + CRYSTAL_INVULNERABILITY_DURATION_MS;
  crystalShieldSoundActive = true;
  renderer?.playInvulnerabilitySound(true);
  updateLootUi();
  updatePlayerProtectionVisual(now);
  setStatus("Crystal shield active for 10 seconds.");
  return true;
}

function equipWeapon(weapon: WeaponSpec): void {
  equipWeaponWithAmmo(weapon, weapon.maxAmmo);
}

function equipWeaponWithAmmo(weapon: WeaponSpec, ammo: number | null): void {
  currentWeapon = { ...weapon };
  currentWeaponAmmo = weapon.maxAmmo === null || ammo === null
    ? weapon.maxAmmo
    : Math.max(0, Math.min(weapon.maxAmmo, ammo));
  weaponShotSequence = 0;
  updateWeaponUi();
}

function equipDefaultWeapon(): void {
  equipWeapon(DEFAULT_WEAPON);
}

function lootReplenishesAmmo(item: LootItem): boolean {
  return item.kind === "core";
}

function extraLootForCurrentPage(): LootItem[] {
  if (!currentPageUrl) return [];
  const key = floorIdentity(currentPageUrl);
  const items = extraLootByPage.get(key);
  if (items) return items;
  const created: LootItem[] = [];
  extraLootByPage.set(key, created);
  return created;
}

function nextExtraLootId(prefix: string): string | null {
  if (!currentPageUrl) return null;
  const key = floorIdentity(currentPageUrl);
  const serial = (extraLootSerialByPage.get(key) ?? 0) + 1;
  extraLootSerialByPage.set(key, serial);
  return `${key}::${prefix}-${serial}`;
}

function persistDroppedWeapon(weapon: WeaponSpec, ammo: number, position: Point, roomId: number): void {
  if (!currentPageUrl || weapon.maxAmmo === null || ammo <= 0) return;
  const id = nextExtraLootId(`dropped-weapon::${weapon.kind}`);
  if (!id) return;
  const dropped: LootItem = {
    id,
    roomId,
    x: position.x,
    y: position.y,
    kind: "weapon",
    weapon: { ...weapon },
    weaponAmmo: ammo,
    weaponPlacement: "floor",
  };
  const items = extraLootForCurrentPage();
  if (items.some(item => item.id === dropped.id)) return;
  items.push(dropped);
  queuedLootDrops.push(dropped);
  temporarilyBlockedLoot.add(dropped.id);
  lastDroppedWeapon = dropped;
}

function recordHighScore(): { scores: HighScore[]; rank: number | null } {
  const entry: HighScore = {
    score: scoreForRun(lootInventory, runStats),
    kills: runStats.kills,
    fastKills: runStats.fastKills,
    slowKills: runStats.slowKills,
    sentryKills: runStats.sentryKills,
    bossKills: runStats.bossKills,
    shotsFired: runStats.shotsFired,
    at: new Date().toISOString()
  };

  const { scores, rank } = rankHighScore(loadHighScores(), entry);
  storeHighScores(scores);
  return { scores, rank };
}

function showDeathModal(): void {
  const { scores, rank } = recordHighScore();
  renderer?.stopStationAmbient();

  deathScoreEl.textContent = `Final score: ${scoreForRun(lootInventory, runStats)}`;
  deathKillsEl.textContent = String(runStats.kills);
  deathFastKillsEl.textContent = String(runStats.fastKills);
  deathSlowKillsEl.textContent = String(runStats.slowKills);
  deathSentryKillsEl.textContent = String(runStats.sentryKills ?? 0);
  deathBossKillsEl.textContent = String(runStats.bossKills ?? 0);
  deathShotsEl.textContent = String(runStats.shotsFired);
  deathLootCreditsEl.textContent = String(lootInventory.credits);
  deathLootCrystalsEl.textContent = String(lootInventory.crystals);
  deathLootCoresEl.textContent = String(lootInventory.cores);
  deathLootEnergyEl.textContent = String(lootInventory.energy);
  deathLootMedkitsEl.textContent = String(lootInventory.medkits);

  newHighScoreEl.textContent =
    rank === 1
      ? "New session high score."
      : rank
        ? `Run placed #${rank}.`
        : "";

  highScoreRowsEl.replaceChildren();

  scores.slice(0, 5).forEach((score, index) => {
    const tr = document.createElement("tr");
    const date = score.at
      ? new Date(score.at).toLocaleDateString()
      : "—";

    for (const value of [
      index + 1,
      score.score ?? 0,
      score.kills ?? 0,
      date
    ]) {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.appendChild(td);
    }

    highScoreRowsEl.appendChild(tr);
  });

  deathModal.hidden = false;
  gameUi.classList.remove("game-ui-ready");
  deathModal.classList.remove("closing");
  void deathModal.offsetWidth;
  deathModal.classList.add("open");
}

restartButton.addEventListener("click", () => {
  playButtonClick();
  restartButton.disabled = true;
  deathModal.classList.remove("open");
  deathModal.classList.add("closing");
  window.setTimeout(() => location.reload(), SCREEN_FADE_MS);
});

function showFetchErrorModal(pageUrl: string, message: string): void {
  fetchErrorMessageEl.textContent = `Could not load ${pageUrl}.`;
  fetchErrorDetailEl.textContent = message;
  fetchErrorModal.hidden = false;
  fetchErrorModal.classList.add("open");
}

fetchErrorDismissButton.addEventListener("click", () => {
  playButtonClick();
  fetchErrorModal.hidden = true;
  fetchErrorModal.classList.remove("open");
  if (!gameStarted) returnToWelcome();
});

function resetRunState(): void {
  cancelPortalIntro();
  renderer?.setPortalStartupPreview(false);
  cancelPortalActivationSound();
  initialFloorPortalIntroPending = true;
  currentPageUrl = null;
  currentStateId = null;
  navigationHistory.length = 0;
  navigationReturnRooms.length = 0;
  playerHp = PLAYER_MAX_HP;
  playerAlive = true;
  playerInvulnerable = false;
  visitedRooms = new Set();
  discoveredRoomsByPage.clear();
  floorSnapshots.clear();
  collectedLoot.clear();
  lootInventory.credits = 0;
  lootInventory.crystals = 0;
  lootInventory.cores = 0;
  lootInventory.energy = 0;
  lootInventory.medkits = 0;
  runStats.kills = 0;
  runStats.fastKills = 0;
  runStats.slowKills = 0;
  runStats.sentryKills = 0;
  runStats.bossKills = 0;
  runStats.shotsFired = 0;
  if (killsCountEl) killsCountEl.textContent = "0";
}

function returnToWelcome(): void {
  resetRunState();
  stopAllMusic();
  renderer?.stopStationAmbient();
  hideLinkMenu();
  hideContentBrowser();
  hidePortalPreview();
  urlBar.hidden = true;
  gameUi.hidden = true;
  gameUi.classList.remove("game-ui-ready");
  welcomeTransitioning = false;
  luckyButton.disabled = false;
  luckyButton.removeAttribute("aria-busy");
  welcomePrompt?.cancel();
  welcomePromptBody.replaceChildren();
  spawnWelcomePrompt();
  welcomeScreen.hidden = false;
  welcomeScreen.classList.remove("closing", "welcome-ready");
  void welcomeScreen.offsetWidth;
  welcomeScreen.classList.add("welcome-ready");
  playWelcomeAmbient();
}

const loadingScreen = requireElement<HTMLDivElement>("#loadingScreen");
const loadingPromptTextEl = requireElement<HTMLElement>("#loadingPromptText");
const loadingTasksEl = requireElement<HTMLElement>("#loadingTasks");
const loadingSpinnerEl = requireElement<HTMLElement>("#loadingSpinner");
const loadingThoughtEl = requireElement<HTMLElement>("#loadingThought");
const loadingElapsedEl = requireElement<HTMLElement>("#loadingElapsed");
const loadingThoughtHistoryEl = requireElement<HTMLElement>("#loadingThoughtHistory");

const LOADING_SPINNER_FRAMES = ["✻", "✳", "✶", "✽", "✢", "∗", "·"];
const LOADING_TASK_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LOADING_SCREEN_ENABLED =
  import.meta.env.VITE_LOADING_SCREEN !== "off" ||
  new URLSearchParams(window.location.search).has("loading-screen");
const SCREEN_FADE_MS = 320;
const LUCKY_REQUEST_TIMEOUT_MS = 5_000;
const WIKIPEDIA_RANDOM_URL = "https://en.wikipedia.org/wiki/Special:Random";
const WIKIPEDIA_RANDOM_API_URL =
  "https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&origin=*";
const HACKER_NEWS_TOP_STORIES_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HACKER_NEWS_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";
const nextLoadingThought = createThoughtPicker();
let loadingFrame = 0;
let loadingShownAt = 0;
let loadingSpinnerTimer: number | undefined;
let loadingThoughtTimer: number | undefined;
let loadingHideTimer: number | undefined;
let loadingBootGuardTimer: number | undefined;
let welcomeTransitioning = false;

function loadingAllTasksSettled(): boolean {
  const rows = loadingTasksEl.querySelectorAll<HTMLElement>(".loading-task");
  return rows.length > 0 && Array.from(rows).every(
    (row) => row.dataset.state === "done" || row.dataset.state === "failed",
  );
}

function showLoadingScreen(pageUrl: string): void {
  if (!LOADING_SCREEN_ENABLED) return;
  loadingPromptTextEl.textContent = `webcrawl ${pageUrl}`;
  if (!loadingScreen.hidden) return;
  stopAllMusic();
  startLoadingElevator();
  renderer?.stopStationAmbient();
  gameUi.classList.remove("game-ui-ready");
  window.clearTimeout(loadingHideTimer);
  loadingHideTimer = undefined;
  loadingScreen.classList.remove("open", "closing");
  loadingScreen.hidden = false;
  void loadingScreen.offsetWidth;
  loadingScreen.classList.add("open");
  loadingTasksEl.replaceChildren();
  loadingThoughtHistoryEl.replaceChildren();
  loadingFrame = 0;
  loadingShownAt = performance.now();
  loadingThoughtEl.textContent = nextLoadingThought();
  loadingSpinnerEl.textContent = LOADING_SPINNER_FRAMES[0]!;
  loadingSpinnerTimer = window.setInterval(() => {
    loadingFrame += 1;
    loadingSpinnerEl.textContent = LOADING_SPINNER_FRAMES[loadingFrame % LOADING_SPINNER_FRAMES.length]!;
    for (const glyph of loadingTasksEl.querySelectorAll<HTMLElement>(".loading-task-glyph")) {
      if (glyph.closest<HTMLElement>(".loading-task")?.dataset.state === "run") {
        glyph.textContent = LOADING_TASK_FRAMES[loadingFrame % LOADING_TASK_FRAMES.length]!;
      }
    }
    const elapsed = (performance.now() - loadingShownAt) / 1000;
    loadingElapsedEl.textContent = `· ${elapsed.toFixed(1)}s`;
  }, 90);
  loadingThoughtTimer = window.setInterval(() => {
    const line = document.createElement("div");
    line.className = "loading-history-line";
    line.textContent = `· ${loadingThoughtEl.textContent}`;
    loadingThoughtHistoryEl.prepend(line);
    while (loadingThoughtHistoryEl.children.length > 4) {
      loadingThoughtHistoryEl.lastChild?.remove();
    }
    loadingThoughtEl.textContent = nextLoadingThought();
  }, 2000);
}

function setLoadingTask(id: string, label: string): void {
  window.clearTimeout(loadingHideTimer);
  loadingHideTimer = undefined;
  let row = loadingTasksEl.querySelector<HTMLElement>(`.loading-task[data-task="${id}"]`);
  if (!row) {
    row = document.createElement("div");
    row.className = "loading-task";
    row.dataset.task = id;
    const glyph = document.createElement("span");
    glyph.className = "loading-task-glyph";
    const text = document.createElement("span");
    text.className = "loading-task-label";
    row.append(glyph, text);
    loadingTasksEl.append(row);
  }
  row.dataset.state = "run";
  row.querySelector<HTMLElement>(".loading-task-glyph")!.textContent = LOADING_TASK_FRAMES[0]!;
  row.querySelector<HTMLElement>(".loading-task-label")!.textContent = label;
}

function queueLoadingTask(id: string, label: string): void {
  if (loadingTasksEl.querySelector(`[data-task="${id}"]`)) return;
  const row = document.createElement("div");
  row.className = "loading-task";
  row.dataset.task = id;
  row.dataset.state = "pending";
  const glyph = document.createElement("span");
  glyph.className = "loading-task-glyph";
  glyph.textContent = "·";
  const text = document.createElement("span");
  text.className = "loading-task-label";
  text.textContent = label;
  row.append(glyph, text);
  loadingTasksEl.append(row);
}

function completeLoadingTask(id: string, ok = true): void {
  const row = loadingTasksEl.querySelector<HTMLElement>(`.loading-task[data-task="${id}"]`);
  if (!row || row.dataset.state !== "run") return;
  row.dataset.state = ok ? "done" : "failed";
  row.querySelector<HTMLElement>(".loading-task-glyph")!.textContent = ok ? "✓" : "✗";
  if (loadingAllTasksSettled() && !loadingScreen.hidden) {
    loadingHideTimer = window.setTimeout(() => {
      loadingHideTimer = undefined;
      if (loadingAllTasksSettled()) hideLoadingScreen();
    }, 400);
  }
}

function hideLoadingScreen(): void {
  if (loadingScreen.hidden) return;
  requestMobileFullscreen();
  stopLoadingElevator();
  renderer?.playStationAmbient();
  window.clearTimeout(loadingHideTimer);
  loadingHideTimer = undefined;
  window.clearInterval(loadingSpinnerTimer);
  window.clearInterval(loadingThoughtTimer);
  loadingSpinnerTimer = undefined;
  loadingThoughtTimer = undefined;
  gameUi.classList.add("game-ui-ready");
  loadingScreen.classList.remove("open");
  loadingScreen.classList.add("closing");
  window.setTimeout(() => {
    loadingScreen.classList.remove("closing");
    loadingScreen.hidden = true;
  }, 240);
}

function cardinalDirection(dx: number, dy: number): SpriteDirection {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function isBoss(monster: Monster): boolean {
  return monster.bossKind !== undefined;
}

function obstacleStateMapForPage(pageUrl: string): Map<string, ObstacleState> {
  const key = currentStateId ?? stateIdForPage(pageUrl);
  if (!destroyedObstaclesByPage.has(key)) {
    destroyedObstaclesByPage.set(key, new Map());
  }
  return destroyedObstaclesByPage.get(key)!;
}

function saveObstacleState(item: Decoration): void {
  if (!currentPageUrl || !item.destructible) return;

  obstacleStateMapForPage(currentPageUrl).set(item.id, {
    hp: item.hp,
    destroyed: item.destroyed,
    contentUnlocked: item.contentUnlocked,
    spawnedCount: item.spawnedCount,
  });
}

function buildDecorations(layout: DungeonLayout, pageUrl: string): Decoration[] {
  const pageIdentity = floorIdentity(pageUrl);
  return [
    ...createDecorations(layout, obstacleStateMapForPage(pageUrl), floorNumber()),
    ...layout.nodes.flatMap((room) => {
      const pedestal = weaponPedestalForRoom(room, pageIdentity);
      return pedestal ? [pedestal] : [];
    }),
  ];
}

function renderDecorations(): void {
  renderer.renderDecorations(currentDecorations, visitedRooms);
}

function damageObstacle(item: Decoration, amount: number, bullet?: Bullet): void {
  if (!applyObstacleDamage(item, amount)) return;

  if (item.hp <= 0) {
    item.destroyed = true;
    saveObstacleState(item);
    renderer.spawnEffect(item.visual.animations?.destroy, item.x, item.y, item.size);
    renderer.playExplosionSound();
    renderDecorations();
    if (currentPageUrl) {
      const drops = createSceneryDrops([item], floorIdentity(currentPageUrl), collectedLoot);
      currentLoot.push(...drops);
      if (drops.length) renderInteractiveObjects();
    }
    renderContentBrowser();
    if (item.kind === "barrel") {
      const targets = barrelExplosionTargets(item, currentDecorations, currentMonsters, player);
      for (const decoration of targets.decorations) damageObstacle(decoration, BARREL_EXPLOSION_DAMAGE);
      for (const monster of targets.monsters) damageMonster(monster, BARREL_EXPLOSION_DAMAGE);
      if (targets.hitsPlayer) applyPlayerDamage(BARREL_EXPLOSION_DAMAGE);
    }
  } else {
    renderer.spawnEffect(
      item.visual.animations?.damage,
      item.x,
      item.y + item.hitOffsetY,
      item.size,
      { key: `decoration:${item.id}`, lightColor: bullet ? renderer.bulletColor(bullet) : undefined },
    );
    renderer.playDamageSound();
    saveObstacleState(item);
    renderDecorations();
  }
}

function monsterStateMapForPage(pageUrl: string): Map<string, MonsterState> {
  const key = currentStateId ?? stateIdForPage(pageUrl);
  if (!monsterStatesByPage.has(key)) {
    monsterStatesByPage.set(key, new Map());
  }
  return monsterStatesByPage.get(key)!;
}

function saveMonsterState(monster: Monster): void {
  if (!currentPageUrl) return;

  const states = monsterStateMapForPage(currentPageUrl);
  states.set(monster.id, {
    x: monster.x,
    y: monster.y,
    roomId: monster.roomId,
    hp: monster.hp,
    dead: monster.dead,
    active: monster.active,
    droppedLoot: monster.droppedLoot || false,
    dropId: monster.dropId || null,
    dropX: monster.dropX ?? null,
    dropY: monster.dropY ?? null,
    dropKind: monster.dropKind ?? null,
    attackSequence: monster.attackSequence,
    summonedCount: monster.summonedCount,
  });
}

function lootDropsForMonster(monster: Monster): LootItem[] {
  if (!currentPageUrl) return [];
  const namespace = floorIdentity(currentPageUrl);
  const x = monster.dropX ?? monster.x;
  const y = monster.dropY ?? monster.y;
  if (!isBoss(monster)) {
    if (!monster.dropId || !monster.dropKind) return [];
    return [{
      id: monster.dropId,
      roomId: monster.roomId,
      x,
      y,
      kind: monster.dropKind,
      weapon: monster.dropKind === "weapon"
        ? weaponForMonster(monster.kind, monster.seed)
        : undefined,
      weaponPlacement: monster.dropKind === "weapon" ? "floor" : undefined,
    }];
  }
  return bossLootDrops(
    { ...monster, dropX: x, dropY: y },
    namespace,
    floorNumber(),
    currentRoomsById.get(monster.spawnRoomId),
  );
}

function saveCurrentFloorState(): void {
  if (!currentPageUrl || !currentStateId) return;
  discoveredRoomsByPage.set(currentStateId, new Set(visitedRooms));
  for (const item of currentDecorations) {
    if (item.destructible) saveObstacleState(item);
  }
  for (const monster of currentMonsters) saveMonsterState(monster);
}

function buildMonsters(layout: DungeonLayout, pageUrl: string): Monster[] {
  const monsters = createMonsters(
    layout,
    monsterStateMapForPage(pageUrl),
    visitedRooms,
    floorNumber(),
    currentDecorations,
  );
  for (const monster of monsters) {
    if (monster.dead && monster.droppedLoot) {
      currentLoot.push(...lootDropsForMonster(monster).filter(item => !collectedLoot.has(item.id)));
    }
  }
  return monsters;
}

function updateFloorPortals(): boolean {
  const changed = updatePortalAvailability(currentStairs, currentMonsters);
  if (changed && !currentStairs.some(stair => stair.enabled)) cancelPortalActivationSound();
  updatePortalContacts(
    currentStairs,
    player,
    PORTAL_DEFINITION.contactRadius,
    portalContacts,
    PORTAL_DEFINITION.contactOffset,
  );
  return changed;
}

function cancelPortalActivationSound(): void {
  if (portalActivationSoundTimer !== null) window.clearTimeout(portalActivationSoundTimer);
  portalActivationSoundTimer = null;
}

function cancelPortalIntro(): void {
  if (portalIntroTimer !== null) window.clearTimeout(portalIntroTimer);
  if (portalIntroSoundTimer !== null) window.clearTimeout(portalIntroSoundTimer);
  portalIntroTimer = null;
  portalIntroSoundTimer = null;
}

function schedulePortalIntroEnd(playSound: boolean): void {
  if (playSound) {
    portalIntroSoundTimer = window.setTimeout(() => {
      portalIntroSoundTimer = null;
      if (currentMonsters.some(monster => !monster.dead) &&
          currentStairs.some(stair => stair.url !== null && !stair.enabled)) {
        renderer.playPortalShutdownSound();
      }
    }, PORTAL_INTRO_SOUND_DELAY_MS);
  }
  portalIntroTimer = window.setTimeout(() => {
    portalIntroTimer = null;
    renderer.setPortalStartupPreview(false);
  }, PORTAL_INTRO_DURATION_MS);
}

function schedulePortalActivationSound(): void {
  cancelPortalActivationSound();
  portalActivationSoundTimer = window.setTimeout(() => {
    portalActivationSoundTimer = null;
    if (!playerAlive || gameUi.hidden || !currentStairs.some(stair => stair.enabled)) return;
    renderer.playPortalActivationSound();
  }, PORTAL_ACTIVATION_SOUND_DELAY_MS);
}

function activateMonstersInRoom(roomId: number): void {
  let changed = false;

  for (const monster of currentMonsters) {
    if (!monster.dead && monster.spawnRoomId === roomId && !monster.active) {
      monster.active = true;
      saveMonsterState(monster);
      changed = true;
    }
  }

  if (changed) renderMonsters();
}

const SPAWNER_CHARGE_UP_MS = 2_000;

function updateMonsterSpawners(timestamp: number): void {
  if (!MONSTERS_ENABLED) return;
  let spawned = false;
  for (const spawner of currentSpawners) {
    if (
      !spawner.spawner ||
      spawner.destroyed ||
      !visitedRooms.has(spawner.roomId)
    ) continue;

    // Charge-up sequence already running: spawn once the timeout elapses.
    if (spawner.pendingSpawnAt !== undefined) {
      if (timestamp < spawner.pendingSpawnAt) continue;
      const index = spawner.spawnedCount ?? 0;
      const monster = monsterSpecForSpawner(spawner, floorNumber(), index);
      monster.hp = monster.maxHp;
      monster.active = true;
      const position = findSpawnerSpawnPosition(monster, spawner);
      if (!position) {
        // Blocked mid-charge (something moved in): revert to dormant, retry soon.
        delete spawner.pendingSpawnAt;
        delete spawner.spawnAnimationStartedAt;
        renderDecorations();
        spawner.nextSpawnAt = timestamp + 1_000;
        continue;
      }
      monster.x = position.x;
      monster.y = position.y;
      monster.attackWarmupUntil = timestamp + MONSTER_ATTACK_WARMUP_MS;
      currentMonsters.push(monster);
      spawner.spawnedCount = index + 1;
      spawner.nextSpawnAt = timestamp + (spawner.spawnIntervalMs ?? 20_000);
      // Enter the discharge flash; the clip settles back onto the dormant frame.
      spawner.spawnAnimationStartedAt = timestamp;
      delete spawner.pendingSpawnAt;
      saveObstacleState(spawner);
      saveMonsterState(monster);
      renderer.spawnEffect(monster.visual.effects?.destroy, monster.x, monster.y, monster.size);
      spawned = true;
      continue;
    }

    if (spawner.nextSpawnAt === undefined) {
      spawner.nextSpawnAt = timestamp + (spawner.spawnIntervalMs ?? 20_000);
      continue;
    }
    if (timestamp < spawner.nextSpawnAt) continue;

    // Only start sound + animation when there is actually room to spawn.
    const index = spawner.spawnedCount ?? 0;
    const monster = monsterSpecForSpawner(spawner, floorNumber(), index);
    if (!findSpawnerSpawnPosition(monster, spawner)) {
      spawner.nextSpawnAt = timestamp + 1_000;
      continue;
    }
    spawner.spawnAnimationStartedAt = timestamp;
    spawner.pendingSpawnAt = timestamp + SPAWNER_CHARGE_UP_MS;
    renderer.playSpawnerSpawnSound();
  }
  renderer.updateDecorationAnimations(currentSpawners, timestamp);
  if (spawned) {
    renderMonsters();
    if (updateFloorPortals()) renderInteractiveObjects();
  }
}

function findSpawnerSpawnPosition(monster: Monster, spawner: Decoration): Point | null {
  const sideDistance = (spawner.footprint ?? spawner.radius) + monster.radius + world(8);
  // Stationary monsters (sentries) are placed beside the spawner so they do
  // not sit on top of it; mobile monsters emerge from the spawner itself.
  const spawnOffsets: Point[] = [
    ...(monster.speed === 0 ? [] : [{ x: 0, y: 0 }]),
    { x: sideDistance, y: 0 }, { x: -sideDistance, y: 0 },
    { x: 0, y: sideDistance }, { x: 0, y: -sideDistance },
    { x: sideDistance, y: sideDistance }, { x: -sideDistance, y: -sideDistance },
  ];
  return spawnOffsets
    .map(offset => ({ x: spawner.x + offset.x, y: spawner.y + offset.y }))
    .find(point => monsterSpawnPositionIsClear(monster, spawner, point)) ?? null;
}

function renderMonsters(): void {
  renderer.renderMonsters(currentMonsters);
}

function updateMonsterPositions(): void {
  renderer.updateMonsterPositions(currentMonsters);
}

function applyPlayerDamage(amount: number, bullet?: Bullet): void {
  if (!playerAlive) return;

  const now = performance.now();
  if (isPlayerInvulnerable(now)) return;

  renderer.spawnEffect(
    PLAYER_SPEC.visual.effects?.damage,
    player.x,
    player.y + PLAYER_SPEC.visualCenterOffsetY,
    PLAYER_SPEC.spriteSize,
    { key: "player", lightColor: bullet ? renderer.bulletColor(bullet) : undefined },
  );
  renderer.playPlayerHurtSound();

  playerHp = Math.max(0, playerHp - amount);
  playerDamageInvulnerableUntil = now + PLAYER_DAMAGE_INVULNERABILITY_MS;

  updateHealthUi();

  if (playerHp <= 0) {
    playerAlive = false;
    cancelPortalIntro();
    renderer.setPortalStartupPreview(false);
    cancelPortalActivationSound();
    renderer.playPlayerDeathSound();
    renderer.stopMovementSounds();
    resetPlayerInput();
    pauseGameLoop();
    const hud = document.querySelector("#hud");
    hud?.classList.add("game-over");
    setStatus("Agent signal lost.", true);
    showDeathModal();
  }
}

function monsterDrop(monster: Monster): void {
  if (!currentPageUrl || monster.droppedLoot) return;

  const dropsWeapon = !isBoss(monster) && monsterDropsWeapon(monster.seed, monster.miniboss);
  if (!monster.dropsLoot && !dropsWeapon) return;

  monster.droppedLoot = true;
  monster.dropX = monster.x;
  monster.dropY = monster.y;
  if (!isBoss(monster)) {
    monster.dropId = `${floorIdentity(currentPageUrl)}::${monster.id}::monster-drop`;
    monster.dropKind = dropsWeapon ? "weapon" : lootKindForSeed(monster.seed);
  }
  currentLoot.push(...lootDropsForMonster(monster).filter(item => !collectedLoot.has(item.id)));
}

function damageMonster(monster: Monster, amount: number, bullet?: Bullet): void {
  if (monster.dead) return;

  monster.hp = Math.max(0, monster.hp - amount);

  if (monster.hp <= 0) {
    monster.dead = true;
    monster.deathAnimating = true;
    renderer.spawnEffect(monster.visual.effects?.destroy, monster.x, monster.y, monster.size);
    renderer.playExplosionSound();
    runStats.kills += 1;

    if (isBoss(monster)) {
      runStats.bossKills = (runStats.bossKills ?? 0) + 1;
    } else if (monster.speed === 0) {
      runStats.sentryKills = (runStats.sentryKills ?? 0) + 1;
    } else if (monster.fast) {
      runStats.fastKills += 1;
    } else {
      runStats.slowKills += 1;
    }
    if (updateFloorPortals() && currentStairs.some(stair => stair.enabled)) {
      schedulePortalActivationSound();
    }

    if (killsCountEl) killsCountEl.textContent = String(runStats.kills);
    updateHudPanels();

    monsterDrop(monster);
    saveMonsterState(monster);
    renderMonsters();
    renderInteractiveObjects();
    updateContentPoints(performance.now());

    setTimeout(() => {
      monster.deathAnimating = false;
      renderMonsters();
    }, 460);
  } else {
    renderer.spawnEffect(
      monster.visual.effects?.damage,
      monster.x,
      monster.y + monsterVisualCenterOffsetY(monster.size, monster.visualKind),
      monster.size,
      { key: `monster:${monster.id}`, lightColor: bullet ? renderer.bulletColor(bullet) : undefined },
    );
    renderer.playDamageSound();
    saveMonsterState(monster);
    updateMonsterPositions();
  }
}

const CONTENT_TOGGLE_FRAME_MS = 180;

function contentPointFrameFor(item: Decoration, now: number): string {
  const spawn = item.visual.animations?.spawn;
  const turningFrame = spawn?.frames[0];
  const onFrame = spawn?.frames[1] ?? turningFrame;
  const offFrame = item.visual.normal.frames[0]!;
  if (spawn && turningFrame !== undefined && item.spawnAnimationStartedAt !== undefined) {
    const elapsed = now - item.spawnAnimationStartedAt;
    if (item.contentTurningOff) {
      return elapsed < CONTENT_TOGGLE_FRAME_MS ? turningFrame : offFrame;
    }
    return elapsed < CONTENT_TOGGLE_FRAME_MS ? turningFrame : onFrame ?? offFrame;
  }
  return item.contentEnabled ? onFrame ?? offFrame : offFrame;
}

function updateContentPoints(timestamp: number): void {
  let changed = false;
  const occupiedRoomId = roomContainingPoint(player.x, player.y)?.id ?? null;
  for (const item of currentDecorations) {
    if (!item.contentPoint || item.destroyed) continue;
    const playerInRoom = occupiedRoomId === item.roomId;
    if (
      !item.contentUnlocked &&
      playerInRoom &&
      !currentMonsters.some(monster => !monster.dead && monster.spawnRoomId === item.roomId)
    ) {
      item.contentUnlocked = true;
      saveObstacleState(item);
    }
    const enabled = Boolean(item.contentUnlocked && playerInRoom);
    if (item.contentEnabled !== enabled) {
      item.contentEnabled = enabled;
      item.contentTurningOff = !enabled;
      item.spawnAnimationStartedAt = timestamp;
      changed = true;
      renderer.playContentToggleSound();
    } else if (enabled && item.spawnAnimationStartedAt === undefined) {
      item.contentTurningOff = false;
      item.spawnAnimationStartedAt = timestamp - CONTENT_TOGGLE_FRAME_MS;
    }
    renderer.applyDecorationFrame(item, contentPointFrameFor(item, timestamp));
  }
  if (changed) renderDecorations();
  renderContentBrowser();
  renderPortalPreview();
}

function queueEnemyBullet(
  monster: Monster,
  direction: Point,
  {
    speed = monster.projectileSpeed,
    damage = monster.attackDamage,
    radius = DEFAULT_BULLET_SPEC.radius,
    maxDistance = monster.projectileRange,
    style = "enemy",
    lateralOffset = 0,
  }: {
    speed?: number;
    damage?: number;
    radius?: number;
    maxDistance?: number;
    style?: BulletStyle;
    lateralOffset?: number;
  } = {},
): void {
  const muzzleDistance = Math.max(monster.radius + radius + world(5), monster.size * 0.42);
  const origin = actorProjectileOrigin(
    monster,
    direction,
    monsterVisualCenterOffsetY(monster.size, monster.visualKind),
    muzzleDistance,
    lateralOffset,
  );
  bullets.push({
    id: `${monster.id}-${performance.now()}-${bullets.length}`,
    owner: "enemy",
    damage,
    ...origin,
    vx: direction.x * speed,
    vy: direction.y * speed,
    depthOffsetY: -monsterVisualCenterOffsetY(monster.size, monster.visualKind),
    traveled: 0,
    radius,
    maxDistance,
    style,
  });
}

function playerCollisionCenter(): Point {
  return actorCollisionCenter(player, PLAYER_SPEC.visualCenterOffsetY);
}

function shootEnemyVolley(monster: Monster, direction: Point, timestamp: number): void {
  for (const projectile of enemyVolleyProjectiles(direction, monster.attackPattern, world(15))) {
    queueEnemyBullet(monster, projectile.direction, { lateralOffset: projectile.lateralOffset });
  }
  monster.attackKind = "ranged";
  monster.lastAttackAt = timestamp;
  renderer.playEnemyShotSound(monster.kind);
  renderBullets();
}

function rotatedDirection(direction: Point, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: direction.x * cosine - direction.y * sine,
    y: direction.x * sine + direction.y * cosine,
  };
}

function fireBossVolley(monster: Monster, target: Point, timestamp: number): void {
  const sequence = monster.attackSequence ?? 0;
  const enraged = monster.hp <= monster.maxHp / 2;
  const aimed = actorAimDirection(
    monster,
    monsterVisualCenterOffsetY(monster.size, monster.visualKind),
    target,
  );

  if (monster.bossKind === "packet-storm" && sequence % 2 === 0) {
    const count = 10 + Math.min(6, floorNumber()) + (enraged ? 4 : 0);
    const offset = sequence * 0.19;
    for (let index = 0; index < count; index += 1) {
      const angle = offset + index / count * Math.PI * 2;
      queueEnemyBullet(monster, { x: Math.cos(angle), y: Math.sin(angle) }, {
        radius: world(6),
        style: "boss",
      });
    }
  } else {
    const count = monster.bossKind === "fork-bomb" ? (enraged ? 5 : 3) : (enraged ? 7 : 5);
    const spread = monster.bossKind === "fork-bomb" ? 0.19 : 0.14;
    for (let index = 0; index < count; index += 1) {
      queueEnemyBullet(monster, rotatedDirection(aimed, (index - (count - 1) / 2) * spread), {
        radius: world(6),
        style: "boss",
      });
    }
  }
  monster.attackSequence = sequence + 1;
  monster.attackKind = "ranged";
  monster.lastAttackAt = timestamp;
  saveMonsterState(monster);
  renderer.playEnemyShotSound(monster.kind);
  renderBullets();
}

function summonBossMinions(boss: Monster, timestamp: number): void {
  const totalLimit = 7 + Math.min(9, floorNumber());
  const aliveLimit = 3 + Math.min(4, Math.floor(floorNumber() / 3));
  const prefix = `${boss.id}::summon-`;
  const alive = currentMonsters.filter(monster => monster.id.startsWith(prefix) && !monster.dead).length;
  const summonedCount = boss.summonedCount ?? 0;
  if (alive >= aliveLimit || summonedCount >= totalLimit) {
    boss.nextSpecialAt = timestamp + 1_500;
    return;
  }
  const waveSize = boss.hp <= boss.maxHp / 2 ? 2 : 1;
  let added = 0;
  for (let offset = 0; offset < waveSize && alive + added < aliveLimit && summonedCount + added < totalLimit; offset += 1) {
    const index = summonedCount + added;
    const minion = monsterSpecForBossSummon(boss, floorNumber(), index);
    if (!isWalkable(minion.x, minion.y, minion.radius)) continue;
    if (currentMonsters.some(other => !other.dead &&
      Math.hypot(minion.x - other.x, minion.y - other.y) < minion.radius + other.radius)
    ) continue;
    minion.hp = minion.maxHp;
    minion.active = true;
    minion.attackWarmupUntil = timestamp + MONSTER_ATTACK_WARMUP_MS;
    currentMonsters.push(minion);
    saveMonsterState(minion);
    renderer.spawnEffect(minion.visual.effects?.destroy, minion.x, minion.y, minion.size);
    added += 1;
  }
  boss.summonedCount = summonedCount + added;
  boss.nextSpecialAt = timestamp + Math.max(2_800, 6_500 - floorNumber() * 260);
  saveMonsterState(boss);
  if (added) {
    renderMonsters();
    if (updateFloorPortals()) renderInteractiveObjects();
  }
}

function hasWalkableLine(from: Point, to: Point, radius: number, step: number): boolean {
  return walkableSegment(
    from,
    to,
    point => isWalkable(point.x, point.y, radius),
    Math.min(step, WORLD_GEOMETRY.wallThickness / 2),
  );
}

function hasLineOfSight(from: Point, to: Point): boolean {
  return walkableProjectileLine(
    from, to, PLAYER_SPEC.visualCenterOffsetY,
    point => isWalkable(point.x, point.y, DEFAULT_BULLET_SPEC.radius),
  );
}

function visiblePlayerAimPoint(from: Point): Point | null {
  return visiblePlayerHitPoint(
    playerCollisionCenter(), PLAYER_SPEC.radius,
    point => hasLineOfSight(from, point),
  );
}

function monsterApproachPoint(monster: Monster): Point | null {
  return walkableApproachPoint(
    player,
    monster,
    point => isMonsterWalkable(monster, point.x, point.y),
    point => hasWalkableLine(point, player, DEFAULT_BULLET_SPEC.radius, WORLD_GEOMETRY.pathLineStep),
    monster.radius + PLAYER_SPEC.radius,
  );
}

function monsterPathBounds(monster: Monster, target: Point, via?: Point): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return {
    minX: Math.min(monster.x, target.x, via?.x ?? target.x) - WORLD_GEOMETRY.pathBoundsPadding,
    maxX: Math.max(monster.x, target.x, via?.x ?? target.x) + WORLD_GEOMETRY.pathBoundsPadding,
    minY: Math.min(monster.y, target.y, via?.y ?? target.y) - WORLD_GEOMETRY.pathBoundsPadding,
    maxY: Math.max(monster.y, target.y, via?.y ?? target.y) + WORLD_GEOMETRY.pathBoundsPadding,
  };
}

function updateMonsterPath(
  monster: Monster,
  target: Point,
  targetRoomId: number | null,
  timestamp: number,
  fallback?: GraphNode,
): void {
  if (monster.speed === 0) return;
  if (monster.pathPursuitRoomId !== targetRoomId) monster.nextPathRefreshAt = 0;
  if (timestamp < (monster.nextPathRefreshAt ?? 0)) return;

  const start = { x: monster.x, y: monster.y };
  const walkable = (point: Point): boolean => isMonsterWalkable(monster, point.x, point.y);
  const route = chooseReachablePath(
    start, fallback ? [target, fallback] : [target], walkable,
    WORLD_GEOMETRY.pathGridStep, 1800,
    destination => monsterPathBounds(monster, destination, fallback),
  );
  const destination = route?.targetIndex === 1 ? fallback! : target;
  monster.path = route?.path ?? [];
  monster.pathIndex = route && route.path.length > 1 ? 1 : 0;
  monster.pathPursuitRoomId = targetRoomId;
  monster.pathTargetRoomId = route?.targetIndex === 1 ? fallback!.id : targetRoomId;
  monster.pathTargetX = destination.x;
  monster.pathTargetY = destination.y;
  monster.nextPathRefreshAt = timestamp + 420;
}

function moveMonsterTowards(monster: Monster, target: Point, dt: number, timestamp: number): void {
  const waypoint = monster.path?.[monster.pathIndex ?? 0];
  if (!waypoint) {
    monster.moveDir = null;
    return;
  }
  const dx = waypoint.x - monster.x;
  const dy = waypoint.y - monster.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= 10 && monster.path && (monster.pathIndex ?? 0) < monster.path.length - 1) {
    monster.pathIndex = (monster.pathIndex ?? 0) + 1;
    moveMonsterTowards(monster, target, dt, timestamp);
    return;
  }

  if (distance <= 0.001) {
    monster.moveDir = null;
    monster.moving = false;
    monster.blockedMoveCount = 0;
    return;
  }

  const step = Math.min(distance, monster.speed * dt);
  monster.escapeDirection = undefined;
  monster.escapeUntil = undefined;
  const nextX = monster.x + dx / distance * step;
  const nextY = monster.y + dy / distance * step;

  monster.moveDir =
    Math.abs(dx) > Math.abs(dy)
      ? (dx < 0 ? "left" : "right")
      : (dy < 0 ? "up" : "down");

  const walkable = (point: Point): boolean => isMonsterWalkable(monster, point.x, point.y);
  if (walkableSegment(monster, { x: nextX, y: nextY }, walkable)) {
    monster.x = nextX;
    monster.y = nextY;
    monster.moving = true;
    monster.blockedMoveCount = 0;
    return;
  }

  const horizontalStep = { x: nextX, y: monster.y };
  const verticalStep = { x: monster.x, y: nextY };
  const axisSteps = Math.abs(dx) > Math.abs(dy)
    ? [horizontalStep, verticalStep]
    : [verticalStep, horizontalStep];
  for (const candidate of axisSteps) {
    if (Math.hypot(candidate.x - monster.x, candidate.y - monster.y) <= 0.001) continue;
    if (!walkableSegment(monster, candidate, walkable)) continue;
    monster.moveDir = cardinalDirection(candidate.x - monster.x, candidate.y - monster.y);
    monster.x = candidate.x;
    monster.y = candidate.y;
    monster.moving = true;
    monster.blockedMoveCount = 0;
    return;
  }

  monster.path = [];
  monster.nextPathRefreshAt = 0;
  monster.blockedMoveCount = (monster.blockedMoveCount ?? 0) + 1;
  if (monster.blockedMoveCount < 4) return;
  const escaped = monsterEscapeStep(
    monster,
    { x: dx, y: dy },
    Math.max(step, world(6)),
    point => walkableSegment(monster, point, walkable),
    monster.seed + monster.blockedMoveCount,
  );
  if (escaped) {
    const escapeDx = escaped.x - monster.x;
    const escapeDy = escaped.y - monster.y;
    monster.moveDir = cardinalDirection(escapeDx, escapeDy);
    monster.x = escaped.x;
    monster.y = escaped.y;
    monster.moving = true;
    monster.blockedMoveCount = 0;
  }
}

function updateBoss(monster: Monster, dt: number, timestamp: number): void {
  if (currentRoomId === null) return;
  const playerRoom = roomContainingPoint(player.x, player.y);
  const sharesPlayerRoom = playerRoom?.id === monster.roomId;
  let nextRoom: GraphNode | undefined;
  if (!sharesPlayerRoom && playerRoom) {
    const nextRoomId = nextRoomTowardPlayer.get(monster.roomId);
    nextRoom = nextRoomId === undefined ? undefined : currentRoomsById.get(nextRoomId);
    if (!nextRoom) return;
  }
  const approach = monsterApproachPoint(monster);
  if (monster.bossKind === "heap-titan") {
    if (approach || nextRoom) {
      updateMonsterPath(monster, approach ?? nextRoom!, playerRoom?.id ?? currentRoomId, timestamp, nextRoom);
      moveMonsterTowards(monster, approach ?? nextRoom!, dt, timestamp);
    }
  } else if (!sharesPlayerRoom) {
    const destination = approach ?? nextRoom;
    if (destination) {
      updateMonsterPath(monster, destination, playerRoom?.id ?? currentRoomId, timestamp, nextRoom);
      moveMonsterTowards(monster, destination, dt, timestamp);
    }
  }
  const playerDistance = Math.hypot(player.x - monster.x, player.y - monster.y);
  monster.moveDir = cardinalDirection(player.x - monster.x, player.y - monster.y);
  const aimPoint = playerDistance <= monster.projectileRange
    ? visiblePlayerAimPoint(actorCollisionCenter(monster,
      monsterVisualCenterOffsetY(monster.size, monster.visualKind))) : null;

  if (monster.bossKind === "packet-storm") {
    if (aimPoint && monsterAttackIsReady(monster, timestamp)) fireBossVolley(monster, aimPoint, timestamp);
    return;
  }

  if (monster.bossKind === "fork-bomb") {
    if (monster.nextSpecialAt === undefined) monster.nextSpecialAt = timestamp + 2_800;
    if (sharesPlayerRoom && timestamp >= monster.nextSpecialAt) summonBossMinions(monster, timestamp);
    if (aimPoint && monsterAttackIsReady(monster, timestamp)) fireBossVolley(monster, aimPoint, timestamp);
    return;
  }

  if (playerDistance <= monster.attackRange && monsterAttackIsReady(monster, timestamp)) {
    monster.attackKind = "melee";
    monster.lastAttackAt = timestamp;
    renderer.playMeleeSound();
    applyPlayerDamage(monster.attackDamage);
  }
  if (monster.nextSpecialAt === undefined) monster.nextSpecialAt = timestamp + HEAP_TITAN_WAVE.initialDelayMs;
  if (timestamp >= monster.nextSpecialAt && playerDistance <= monster.projectileRange) {
    const count = monster.hp <= monster.maxHp / 2
      ? HEAP_TITAN_WAVE.enragedBulletCount
      : HEAP_TITAN_WAVE.bulletCount;
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2;
      queueEnemyBullet(monster, { x: Math.cos(angle), y: Math.sin(angle) }, {
        damage: Math.max(1, Math.floor(monster.attackDamage / 2)),
      radius: world(8),
        maxDistance: monster.projectileRange,
        style: "shockwave",
      });
    }
    monster.nextSpecialAt = timestamp + Math.max(
      HEAP_TITAN_WAVE.minIntervalMs,
      HEAP_TITAN_WAVE.baseIntervalMs - floorNumber() * HEAP_TITAN_WAVE.floorReductionMs,
    );
    monster.attackSequence = (monster.attackSequence ?? 0) + 1;
    monster.attackKind = "ranged";
    monster.lastAttackAt = timestamp;
    saveMonsterState(monster);
    renderer.playEnemyShotSound(monster.kind);
    renderBullets();
  }
}

function renderBullets(): void {
  renderer.renderBullets(bullets);
}

function shootBullet(): void {
  if (!playerAlive) return;

  const now = performance.now();
  if (now - lastPlayerShotAt < currentWeapon.fireCooldownMs) return;
  lastPlayerShotAt = now;
  lastPlayerActivityAt = now;
  runStats.shotsFired += 1;
  gameCanvasHost.dataset.shotsFired = String(runStats.shotsFired);
  playPlayerShootFrames();
  renderer.playWeaponShotSound(currentWeapon.kind);

  const projectiles = projectilesForWeapon(currentWeapon, playerFacing, weaponShotSequence);
  for (const [index, projectile] of projectiles.entries()) {
    const muzzleDistance = Math.max(
      PLAYER_SPEC.radius + projectile.radius + world(7),
      PLAYER_SPEC.muzzleDistance,
    );
    const origin = actorProjectileOrigin(
      player,
      playerFacing,
      PLAYER_SPEC.visualCenterOffsetY,
      muzzleDistance,
      projectile.lateralOffset,
    );
    bullets.push({
      id: `${now}-${weaponShotSequence}-${index}`,
      owner: "player",
      damage: projectile.damage,
      ...origin,
      vx: projectile.direction.x * projectile.speed,
      vy: projectile.direction.y * projectile.speed,
      depthOffsetY: -PLAYER_SPEC.visualCenterOffsetY,
      traveled: 0,
      radius: projectile.radius,
      maxDistance: projectile.range,
      style: "player",
      weaponKind: currentWeapon.kind,
    });
  }
  gameCanvasHost.dataset.lastPlayerVolley = String(projectiles.length);
  weaponShotSequence += 1;
  if (currentWeaponAmmo !== null) {
    currentWeaponAmmo -= 1;
    if (currentWeaponAmmo <= 0) equipDefaultWeapon();
    else updateWeaponUi();
  }

  renderBullets();
}

function updateBullets(dt: number): void {
  if (!bullets.length) return;

  const survivors = [];

  for (const bullet of bullets) {
    const stepX = bullet.vx * dt;
    const stepY = bullet.vy * dt;
    const stepDistance = Math.hypot(stepX, stepY);

    // Sub-step fast bullets so they do not tunnel through monsters/walls.
    const segments = Math.max(1, Math.ceil(stepDistance / world(8)));
    const dx = stepX / segments;
    const dy = stepY / segments;
    let alive = true;

    for (let i = 0; i < segments && alive; i++) {
      bullet.x += dx;
      bullet.y += dy;
      bullet.traveled += Math.hypot(dx, dy);
      const bulletRadius = bullet.radius ?? DEFAULT_BULLET_SPEC.radius;

      if (bullet.traveled >= (bullet.maxDistance ?? DEFAULT_BULLET_SPEC.maxDistance)) {
        alive = false;
        break;
      }
      const movementAlignedBulletY = bullet.y - PLAYER_SPEC.visualCenterOffsetY;
      if (!isGeometryWalkable(bullet.x, movementAlignedBulletY, bulletRadius)) {
        renderer.spawnEffect(
          PLAYER_SPEC.visual.effects?.damage,
          bullet.x,
          bullet.y,
          PLAYER_SPEC.spriteSize,
          { lightColor: renderer.bulletColor(bullet) },
        );
        renderer.playDamageSound();
        alive = false;
        break;
      }

      if (bullet.owner === "player") {
        for (const monster of currentMonsters) {
          if (!monster.active || monster.dead) continue;

          if (projectileHitsCircle(
            { x: monster.x, y: monster.y + monsterVisualCenterOffsetY(monster.size, monster.visualKind) },
            monster.radius,
            bullet,
            bulletRadius,
          )) {
            damageMonster(monster, bullet.damage, bullet);
            alive = false;
            break;
          }
        }
      }

      if (!alive) break;

      if (bullet.owner === "enemy") {
        if (projectileHitsCircle(playerCollisionCenter(), PLAYER_SPEC.radius, bullet, bulletRadius)) {
          applyPlayerDamage(bullet.damage, bullet);
          alive = false;
          break;
        }
      }

      for (const item of damageableCells.get(spatialCellKey(bullet.x, bullet.y)) ?? []) {
        if (!item.destructible || item.destroyed) continue;

        if (projectileHitsDecoration(item, bullet, bulletRadius)) {
          damageObstacle(item, bullet.damage, bullet);
          alive = false;
          break;
        }
      }
    }

    if (alive) survivors.push(bullet);
  }

  bullets = survivors;
  renderBullets();
}

function rebuildRoomRouting(): void {
  if (!roomRoutingDirty || !currentLayout || currentRoomId === null) return;
  roomRoutingDirty = false;
  nextRoomTowardPlayer = new Map([[currentRoomId, currentRoomId]]);
  const adjacency = new Map<number, number[]>();
  for (const room of currentLayout.nodes) {
    if (visitedRooms.has(room.id)) adjacency.set(room.id, []);
  }
  for (const link of currentLayout.links) {
    if (!visitedRooms.has(link.source.id) || !visitedRooms.has(link.target.id)) continue;
    adjacency.get(link.source.id)?.push(link.target.id);
    adjacency.get(link.target.id)?.push(link.source.id);
  }
  const queue = [currentRoomId];
  for (let index = 0; index < queue.length; index += 1) {
    const roomId = queue[index]!;
    for (const neighbor of adjacency.get(roomId) ?? []) {
      if (nextRoomTowardPlayer.has(neighbor)) continue;
      nextRoomTowardPlayer.set(neighbor, roomId);
      queue.push(neighbor);
    }
  }
}


function gameTick(timestamp: number): void {
  gameAnimationFrame = requestAnimationFrame(gameTick);
  if (nextGameTick !== null && timestamp + 0.25 < nextGameTick) return;
  nextGameTick = nextGameTick === null
    ? timestamp + GAME_TICK_INTERVAL_MS
    : Math.max(timestamp + GAME_TICK_INTERVAL_MS, nextGameTick + GAME_TICK_INTERVAL_MS);
  renderer.updateLighting(timestamp);
  renderer.updateFootsteps(timestamp);
  updateMinimapVisibility(timestamp);

  if (teleportPauseActive || !playerAlive || !currentLayout) {
    lastGameTick = timestamp;
    setPlayerMoving(false, timestamp);
    return;
  }

  if (lastGameTick == null) {
    lastGameTick = timestamp;
    return;
  }

  const dt = Math.min(0.05, Math.max(0, (timestamp - lastGameTick) / 1000));
  lastGameTick = timestamp;

  updatePlayerProtectionVisual(timestamp);
  if (touchAimActive) updateTouchAim(dt);
  updateEnergyDash(dt, timestamp);
  if (!touchAimActive && playerAimNeedsUpdate()) updatePlayerAimFromPointer();
  if (!touchAimActive && (!pointerInViewport || !pointerClientPosition)) updateIdleFlashlight();
  if ((primaryPointerDown && pointerInViewport) || touchAimActive) shootBullet();
  updateBullets(dt);
  updateMonsterSpawners(timestamp);
  updateContentPoints(timestamp);
  renderer.updateShadowOffsets(currentDecorations, timestamp);
  renderer.updateLootAnimations(currentLoot, timestamp);

  rebuildRoomRouting();

  for (const monster of currentMonsters) {
    if (!monster.active || monster.dead) continue;
    monster.moving = false;
    if (!renderer.isWithinMonsterActivityRange(monster.x, monster.y)) {
      monster.path = [];
      monster.pathIndex = 0;
      monster.nextPathRefreshAt = Infinity;
      continue;
    }

    // Newly-appeared monsters stand still until their attack warmup elapses.
    if (monster.attackWarmupUntil !== undefined && timestamp < monster.attackWarmupUntil) {
      monster.path = [];
      monster.pathIndex = 0;
      monster.nextPathRefreshAt = 0;
      continue;
    }

    const containingRoom = roomContainingPoint(monster.x, monster.y);
    if (containingRoom && visitedRooms.has(containingRoom.id)) {
      monster.roomId = containingRoom.id;
    }

    if (isBoss(monster)) {
      updateBoss(monster, dt, timestamp);
      continue;
    }

    const nextRoomId = nextRoomTowardPlayer.get(monster.roomId);
    if (nextRoomId === undefined) continue;

    if (monster.speed === 0) {
      const target = playerCollisionCenter();
      const monsterCenter = actorCollisionCenter(
        monster,
        monsterVisualCenterOffsetY(monster.size, monster.visualKind),
      );
      monster.moveDir = cardinalDirection(target.x - monsterCenter.x, target.y - monsterCenter.y);
      const playerDistance = Math.hypot(target.x - monsterCenter.x, target.y - monsterCenter.y);
      const aimPoint = playerDistance <= monsterEngagementRange(monster)
        ? visiblePlayerAimPoint(monsterCenter) : null;
      if (
        aimPoint && monsterAttackIsReady(monster, timestamp)
      ) {
        shootEnemyVolley(monster, actorAimDirection(
          monster,
          monsterVisualCenterOffsetY(monster.size, monster.visualKind),
          aimPoint,
        ), timestamp);
      }
      continue;
    }

    const approach = monsterApproachPoint(monster);
    const targetPoint = approach ?? player;
    const nextRoom = monster.roomId !== currentRoomId
      ? currentRoomsById.get(nextRoomId) : undefined;

    const target = playerCollisionCenter();
    let monsterCenter = actorCollisionCenter(
      monster,
      monsterVisualCenterOffsetY(monster.size, monster.visualKind),
    );
    let playerDistance = Math.hypot(target.x - monsterCenter.x, target.y - monsterCenter.y);
    let aimPoint = monster.attackPattern !== "melee" && playerDistance <= monsterEngagementRange(monster)
      ? visiblePlayerAimPoint(monsterCenter) : null;
    if (!aimPoint) {
      const pathStale =
        monster.pathPursuitRoomId !== currentRoomId ||
        ![targetPoint, ...(nextRoom ? [nextRoom] : [])].some(destination =>
          Math.hypot((monster.pathTargetX ?? Infinity) - destination.x,
            (monster.pathTargetY ?? Infinity) - destination.y) <= 48);
      if (pathStale) monster.nextPathRefreshAt = 0;
      updateMonsterPath(monster, targetPoint, currentRoomId, timestamp, nextRoom);
      moveMonsterTowards(monster, targetPoint, dt, timestamp);
      monsterCenter = actorCollisionCenter(
        monster,
        monsterVisualCenterOffsetY(monster.size, monster.visualKind),
      );
      playerDistance = Math.hypot(target.x - monsterCenter.x, target.y - monsterCenter.y);
      if (monster.attackPattern !== "melee" && playerDistance <= monsterEngagementRange(monster)) {
        aimPoint = visiblePlayerAimPoint(monsterCenter);
      }
    } else {
      monster.moveDir = cardinalDirection(target.x - monsterCenter.x, target.y - monsterCenter.y);
    }

    if (
      monster.attackPattern === "melee" &&
      playerDistance <= monsterEngagementRange(monster) &&
      monsterAttackIsReady(monster, timestamp)
    ) {
      monster.attackKind = "melee";
      monster.lastAttackAt = timestamp;
      renderer.playMeleeSound();
      applyPlayerDamage(monster.attackDamage);
    } else if (
      monster.attackPattern !== "melee" &&
      aimPoint && monsterAttackIsReady(monster, timestamp)
    ) {
      shootEnemyVolley(monster, actorAimDirection(
        monster,
        monsterVisualCenterOffsetY(monster.size, monster.visualKind),
        aimPoint,
      ), timestamp);
    }
  }

  updateMonsterPositions();
}

function startGameLoop(): void {
  if (gameAnimationFrame !== null) cancelAnimationFrame(gameAnimationFrame);
  lastGameTick = null;
  nextGameTick = null;
  playerAimDirty = true;
  gameAnimationFrame = requestAnimationFrame(gameTick);
}

function pauseGameLoop(): void {
  if (gameAnimationFrame === null) return;
  cancelAnimationFrame(gameAnimationFrame);
  gameAnimationFrame = null;
  gameLoopSuspended = true;
}

function resumeGameLoop(): void {
  if (!playerAlive || !gameLoopSuspended) return;
  gameLoopSuspended = false;
  startGameLoop();
}

function spatialCellKey(x: number, y: number): string {
  return `${Math.floor(x / SPATIAL_CELL_SIZE)},${Math.floor(y / SPATIAL_CELL_SIZE)}`;
}

function forSpatialCells(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  visit: (key: string) => void,
): void {
  const firstX = Math.floor(minX / SPATIAL_CELL_SIZE);
  const lastX = Math.floor(maxX / SPATIAL_CELL_SIZE);
  const firstY = Math.floor(minY / SPATIAL_CELL_SIZE);
  const lastY = Math.floor(maxY / SPATIAL_CELL_SIZE);
  for (let cellX = firstX; cellX <= lastX; cellX += 1) {
    for (let cellY = firstY; cellY <= lastY; cellY += 1) visit(`${cellX},${cellY}`);
  }
}

function rebuildSpatialIndexes(): void {
  geometryCells = new Map();
  obstacleCells = new Map();
  damageableCells = new Map();
  if (!currentLayout) return;
  const margin = world(48);

  for (const room of currentLayout.nodes) {
    forSpatialCells(
      room.x - room.width / 2 - margin,
      room.x + room.width / 2 + margin,
      room.y - room.height / 2 - margin,
      room.y + room.height / 2 + margin,
      key => {
        const cell = geometryCells.get(key) ?? { rooms: new Set(), links: new Set() };
        cell.rooms.add(room);
        geometryCells.set(key, cell);
      },
    );
  }
  for (const link of currentLayout.links) {
    const corridorMargin = link.width / 2 + margin;
    for (let index = 1; index < link.points.length; index += 1) {
      const start = link.points[index - 1]!;
      const end = link.points[index]!;
      forSpatialCells(
        Math.min(start.x, end.x) - corridorMargin,
        Math.max(start.x, end.x) + corridorMargin,
        Math.min(start.y, end.y) - corridorMargin,
        Math.max(start.y, end.y) + corridorMargin,
        key => {
          const cell = geometryCells.get(key) ?? { rooms: new Set(), links: new Set() };
          cell.links.add(link);
          geometryCells.set(key, cell);
        },
      );
    }
  }
  for (const item of currentDecorations) {
    if (item.obstacle) {
      const extent = item.radius + margin;
      forSpatialCells(item.x - extent, item.x + extent, item.y - extent, item.y + extent, key => {
        const cell = obstacleCells.get(key) ?? new Set();
        cell.add(item);
        obstacleCells.set(key, cell);
      });
    }
    if (item.destructible) {
      const extent = item.radius + world(24);
      forSpatialCells(item.x - extent, item.x + extent, item.y - extent, item.y + extent, key => {
        const cell = damageableCells.get(key) ?? new Set();
        cell.add(item);
        damageableCells.set(key, cell);
      });
    }
  }
}

function pointBlockedByDecoration(x: number, y: number, radius = PLAYER_SPEC.radius): boolean {
  for (const item of obstacleCells.get(spatialCellKey(x, y)) ?? []) {
    if (!item.obstacle || item.destroyed) continue;

    const footprint = item.footprint ?? item.radius;
    const distance = Math.hypot(x - item.x, y - item.y);
    if (distance < radius + footprint) return true;
  }

  return false;
}

/** Circle obstacles for the sliding movement solver. */
function slideObstaclesNear(x: number, y: number): CircleObstacle[] {
  return [...(obstacleCells.get(spatialCellKey(x, y)) ?? [])]
    .filter(item => item.obstacle && !item.destroyed)
    .map(item => ({ x: item.x, y: item.y, radius: item.footprint ?? item.radius }));
}

function isGeometryWalkable(x: number, y: number, radius = PLAYER_SPEC.radius): boolean {
  if (!currentLayout) return false;
  const cell = geometryCells.get(spatialCellKey(x, y));
  if (!cell) return false;
  for (const room of cell.rooms) {
    if (pointInRoomFloor(x, y, room, radius)) return true;
  }
  for (const link of cell.links) {
    if (pointInCorridor(x, y, link, radius)) return true;
  }

  return false;
}

function isWalkable(x: number, y: number, radius = PLAYER_SPEC.radius): boolean {
  return (
    isGeometryWalkable(x, y, radius) &&
    !pointBlockedByDecoration(x, y, radius)
  );
}

function isMonsterWalkable(monster: Monster, x: number, y: number): boolean {
  if (!isGeometryWalkable(x, y, monster.radius)) return false;
  for (const item of obstacleCells.get(spatialCellKey(x, y)) ?? []) {
    if (!item.obstacle || item.destroyed) continue;
    const extent = monster.radius + (item.footprint ?? item.radius);
    const nextDistance = Math.hypot(x - item.x, y - item.y);
    if (nextDistance >= extent) continue;
    if (item.id === monster.spawnSourceId) {
      const currentDistance = Math.hypot(monster.x - item.x, monster.y - item.y);
      if (currentDistance < extent && nextDistance >= currentDistance) continue;
    }
    return false;
  }
  return true;
}

function monsterSpawnPositionIsClear(monster: Monster, spawner: Decoration, position: Point): boolean {
  if (!isGeometryWalkable(position.x, position.y, monster.radius)) return false;
  for (const item of currentDecorations) {
    if (item.id === spawner.id || !item.obstacle || item.destroyed) continue;
    if (Math.hypot(position.x - item.x, position.y - item.y) <
      monster.radius + (item.footprint ?? item.radius)) return false;
  }
  if (Math.hypot(position.x - player.x, position.y - player.y) < monster.radius + PLAYER_SPEC.radius) return false;
  return currentMonsters.every(item => item.dead || Math.hypot(position.x - item.x, position.y - item.y) >= monster.radius + item.radius);
}

function buildInteractiveObjects(layout: DungeonLayout, pageUrl: string): {
  stairs: Stair[];
  loot: LootItem[];
} {
  const base = createInteractiveObjects(
    layout,
    floorIdentity(pageUrl),
    navigationHistory[navigationHistory.length - 1] ?? null,
    collectedLoot,
  );
  return {
    stairs: base.stairs,
    loot: [...base.loot, ...extraLootForCurrentPage().filter(item => !collectedLoot.has(item.id))],
  };
}

function renderInteractiveObjects(): void {
  renderer.renderObjects(currentStairs, currentLoot, visitedRooms, LOOT_ASSETS);
  renderer.setPlayer(player, playerHp, PLAYER_MAX_HP, currentPlayerSpriteAsset);
  updatePlayerVisual();
  updatePlayerAnimationClasses();
  updateHealthUi();
}

function updatePlayerVisual(): void {
  renderer.setPlayer(player, playerHp, PLAYER_MAX_HP, currentPlayerSpriteAsset);
  updatePlayerProtectionVisual();
}

function checkLoot(): void {
  let changed = false;
  queuedLootDrops = [];

  for (const item of currentLoot) {
    const pickupRadius = item.kind === "weapon"
      ? WEAPON_PICKUP_DEFINITIONS[item.weaponPlacement ?? "floor"].pickupRadius
      : LOOT_DEFINITIONS[item.kind].pickupRadius;
    if (
      temporarilyBlockedLoot.has(item.id) &&
      distanceSquared(player, item) > pickupRadius * pickupRadius
    ) {
      temporarilyBlockedLoot.delete(item.id);
    }
  }

  currentLoot = currentLoot.filter(item => {
    const pickupRadius = item.kind === "weapon"
      ? WEAPON_PICKUP_DEFINITIONS[item.weaponPlacement ?? "floor"].pickupRadius
      : LOOT_DEFINITIONS[item.kind].pickupRadius;
    if (
      distanceSquared(player, item) <= pickupRadius * pickupRadius &&
      !temporarilyBlockedLoot.has(item.id)
    ) {
      collectedLoot.add(item.id);
      renderer.playPickupSound(
        item.kind === "weapon" ? "weapon"
        : item.kind === "credit" ? "ram"
        : "generic",
      );

      if (item.kind === "credit") lootInventory.credits += 1;
      if (item.kind === "crystal") lootInventory.crystals += 1;
      if (item.kind === "core") lootInventory.cores += 1;
      if (item.kind === "energy") lootInventory.energy = Math.min(PLAYER_ENERGY_MAX, lootInventory.energy + 1);
      if (item.kind === "medkit") lootInventory.medkits += 1;
      updateLootUi();

      if (item.kind === "weapon" && item.weapon) {
        if (currentWeapon.maxAmmo !== null && currentWeaponAmmo !== null && currentWeaponAmmo > 0) {
          persistDroppedWeapon(currentWeapon, currentWeaponAmmo, item, item.roomId);
        }
        equipWeaponWithAmmo(item.weapon, item.weaponAmmo ?? item.weapon.maxAmmo);
        setStatus(`Equipped ${item.weapon.name} · ${item.weaponAmmo ?? item.weapon.maxAmmo} / ${item.weapon.maxAmmo} ammo`);
      } else if (lootReplenishesAmmo(item)) {
        const replenishedAmmo = replenishWeaponAmmo(currentWeapon, currentWeaponAmmo);
        if (replenishedAmmo !== currentWeaponAmmo) {
          currentWeaponAmmo = replenishedAmmo;
          updateWeaponUi();
        }
      }

      if (item.kind === "medkit" && playerAlive) {
        const restored = playerHp < PLAYER_MAX_HP ? 1 : 0;

      if (restored > 0) {
        playerHp += restored;
        renderer.spawnEffect(
          PLAYER_SPEC.visual.effects?.healing,
          player.x,
          player.y,
          PLAYER_SPEC.spriteSize,
          { followPlayer: true },
        );
        renderer.playHealSound();
        updateHealthUi();
        setStatus(`Health pack restored 1 HP · ${currentPageUrl}`);
      }
      }

      changed = true;
      return false;
    }
    return true;
  });

  if (queuedLootDrops.length) {
    const existing = new Set(currentLoot.map(item => item.id));
    for (const item of queuedLootDrops) {
      if (existing.has(item.id)) continue;
      currentLoot.push(item);
      existing.add(item.id);
      changed = true;
    }
  }
  queuedLootDrops = [];

  if (changed) {
    renderInteractiveObjects();
  }
}

function checkStairs(): boolean {
  if (portalTransitioning) return true;
  const stair = updatePortalContacts(
    currentStairs,
    player,
    PORTAL_DEFINITION.contactRadius,
    portalContacts,
    PORTAL_DEFINITION.contactOffset,
  );
  if (!stair) return false;
  portalTransitioning = true;
  setTeleportPaused(true);
  renderer.stopMovementSounds();
  renderer.spawnEffect(
    PLAYER_SPEC.visual.effects?.teleport,
    player.x,
    player.y + PLAYER_SPEC.visualCenterOffsetY,
    PLAYER_SPEC.spriteSize,
  );
  renderer.playPortalSound(stair.type);
  setTimeout(() => {
    portalTransitioning = false;
    const navigation = stair.type === "up"
      ? goBack()
      : stair.url
        ? navigateTo(stair.url, stair.roomId)
        : null;
    navigation?.finally(() => setTeleportPaused(false));
  }, 400);
  return true;
}

function playerFramesFor(
  direction: PlayerDirection = playerDirectionName(),
  kind: PlayerAnimation = "walk",
): string[] {
  return PLAYER_FRAMES[direction]?.[kind] || PLAYER_FRAMES.right.walk;
}

function playerAssetForDirection(direction: PlayerDirection = playerDirectionName()): string {
  return PLAYER_DEFAULT_ASSETS[direction];
}

function setPlayerSpriteAsset(asset: string): void {
  currentPlayerSpriteAsset = asset;
  renderer.setPlayerAsset(asset);
}

function updatePlayerFacingAsset(): void {
  updatePlayerAnimationClasses();
  if (!playerShooting) {
    const direction = playerDirectionName();
    const frames = playerFramesFor(direction, "walk");
    setPlayerSpriteAsset(playerMoving
      ? frames[playerWalkFrameIndex % frames.length]!
      : playerAssetForDirection(direction));
  }
}

function advancePlayerWalkFrame(timestamp: number): void {
  if (timestamp - lastPlayerWalkFrameAt < 125) return;
  lastPlayerWalkFrameAt = timestamp;
  const frames = playerFramesFor(playerDirectionName(), "walk");
  playerWalkFrameIndex = (playerWalkFrameIndex + 1) % frames.length;
  setPlayerSpriteAsset(frames[playerWalkFrameIndex]!);
}

function playPlayerShootFrames(): void {
  // The current player pack has no shooting frames, so retain the directional movement frame.
}

function playerDirectionName(): PlayerDirection {
  const octant = Math.round(Math.atan2(playerFacing.y, playerFacing.x) / (Math.PI / 4));
  return ([
    "right",
    "downRight",
    "down",
    "downLeft",
    "left",
    "upLeft",
    "up",
    "upRight",
  ] as const)[(octant + 8) % 8]!;
}

function updatePlayerAnimationClasses(): void {
  // Frame changes are applied directly to the Phaser player sprite.
}

function setPlayerMoving(moving: boolean, timestamp: number): void {
  renderer?.setPlayerFootsteps(moving, timestamp);
  if (playerMoving !== moving) {
    playerMoving = moving;
    updatePlayerAnimationClasses();

    if (moving && !playerShooting) {
      playerWalkFrameIndex = 0;
      lastPlayerWalkFrameAt = timestamp;
      updatePlayerFacingAsset();
    } else if (!moving && !playerShooting) {
      playerWalkFrameIndex = 0;
      updatePlayerFacingAsset();
    }
  }

  if (moving && !playerShooting) advancePlayerWalkFrame(timestamp);
}

const movementDirections: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

function updatePlayerMovement(dt: number, timestamp: number): void {
  if (!playerAlive) {
    setPlayerMoving(false, timestamp);
    return;
  }

  let inputX = 0;
  let inputY = 0;
  if (touchMoveVector) {
    const stickMagnitude = Math.hypot(touchMoveVector.x, touchMoveVector.y);
    if (stickMagnitude > STICK_DEADZONE) {
      inputX = touchMoveVector.x;
      inputY = touchMoveVector.y;
    }
  } else {
    for (const code of heldMovementKeys) {
      const direction = movementDirections[code];
      if (!direction) continue;
      inputX += direction.x;
      inputY += direction.y;
    }
  }

  const magnitude = Math.hypot(inputX, inputY);
  if (magnitude === 0) {
    setPlayerMoving(false, timestamp);
    return;
  }

  const distance = PLAYER_SPEC.speed * dt * Math.min(1, magnitude);
  const dx = inputX / magnitude * distance;
  const dy = inputY / magnitude * distance;
  const next = {
    x: player.x + dx,
    y: player.y + dy,
  };

  let moved = false;
  if (isWalkable(next.x, next.y)) {
    player = next;
    moved = true;
  } else {
    const slid = slideAlongObstacles(
      player,
      { x: dx, y: dy },
      PLAYER_SPEC.radius,
      slideObstaclesNear(next.x, next.y),
      point => isWalkable(point.x, point.y),
    );
    if (slid) {
      player = slid;
      moved = true;
    }
  }
  if (!moved) {
    if (dx !== 0 && isWalkable(player.x + dx, player.y)) {
      player.x += dx;
      moved = true;
    }
    if (dy !== 0 && isWalkable(player.x, player.y + dy)) {
      player.y += dy;
      moved = true;
    }
  }

  setPlayerMoving(moved, timestamp);
  if (!moved) return;

  playerAimDirty = true;
  updatePlayerVisual();
  revealRoomsFromCorridor(player.x, player.y);
  updateCurrentRoom();
  updateCameraForPlayer();
  checkLoot();
  if (checkStairs()) heldMovementKeys.clear();
}

function startEnergyDash(clientX: number, clientY: number): void {
  const target = renderer.worldPointAt(clientX, clientY);
  if (!target) return;
  startEnergyDashTowards(target);
}

function startEnergyDashTowards(target: Point): void {
  if (!playerAlive || !currentLayout || energyDash || lootInventory.energy <= 0) return;
  const center = actorCollisionCenter(player, PLAYER_SPEC.visualCenterOffsetY);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < 1) return;
  const power = energyDashPower(lootInventory.energy);
  energyDash = {
    dirX: dx / magnitude,
    dirY: dy / magnitude,
    traveled: 0,
    maxDistance: power.maxDistance,
    damage: power.damage,
    hitTargets: new Set(),
    playerInvulnerableBefore: playerInvulnerable,
  };
  lootInventory.energy = 0;
  updateLootUi();
  playerInvulnerable = true;
  renderer.setPlayerDashTint(true);
  renderer.playEnergyDashSound();
  updatePlayerProtectionVisual();
  setStatus("Energy surge!");
}

function endEnergyDash(): void {
  const dash = energyDash;
  if (!dash) return;
  playerInvulnerable = dash.playerInvulnerableBefore;
  energyDash = null;
  renderer.setPlayerDashTint(false);
  updatePlayerProtectionVisual();
}

function applyEnergyDashDamage(): void {
  const dash = energyDash;
  if (!dash) return;
  const center = playerCollisionCenter();
  for (const monster of currentMonsters) {
    if (!monster.active || monster.dead || dash.hitTargets.has(monster.id)) continue;
    if (projectileHitsCircle(
      { x: monster.x, y: monster.y + monsterVisualCenterOffsetY(monster.size, monster.visualKind) },
      monster.radius,
      center,
      PLAYER_SPEC.radius,
    )) {
      dash.hitTargets.add(monster.id);
      damageMonster(monster, dash.damage);
    }
  }
  for (const item of damageableCells.get(spatialCellKey(player.x, player.y)) ?? []) {
    if (!item.destructible || item.destroyed || dash.hitTargets.has(item.id)) continue;
    if (projectileHitsDecoration(item, center, PLAYER_SPEC.radius)) {
      dash.hitTargets.add(item.id);
      damageObstacle(item, dash.damage);
    }
  }
}

function updateEnergyDash(dt: number, timestamp: number): void {
  const dash = energyDash;
  if (!dash) {
    updatePlayerMovement(dt, timestamp);
    return;
  }

  const target = touchAimActive ? touchAimCursor
    : pointerInViewport && pointerClientPosition
      ? renderer.worldPointAt(pointerClientPosition.x, pointerClientPosition.y)
      : null;
  if (target) {
    const direction = steerDashDirection(
      { x: dash.dirX, y: dash.dirY },
      playerCollisionCenter(),
      target,
      ENERGY_DASH_TURN_RATE * dt,
    );
    dash.dirX = direction.x;
    dash.dirY = direction.y;
  }

  const remaining = dash.maxDistance - dash.traveled;
  const distance = Math.min(ENERGY_DASH_SPEED * dt, remaining);
  if (distance > 0) {
    // Sweep short steps so a fast dash cannot pass through walls or damageable targets.
    const steps = Math.ceil(distance / (PLAYER_SPEC.radius / 2));
    const step = distance / steps;
    for (let index = 0; index < steps; index += 1) {
      const next = {
        x: player.x + dash.dirX * step,
        y: player.y + dash.dirY * step,
      };
      if (!isWalkable(next.x, next.y)) {
        dash.traveled = dash.maxDistance;
        break;
      }
      player = next;
      dash.traveled += step;
      applyEnergyDashDamage();
    }
  } else {
    dash.traveled = dash.maxDistance;
  }

  applyEnergyDashDamage();

  updatePlayerVisual();
  revealRoomsFromCorridor(player.x, player.y);
  updateCurrentRoom();
  updateCameraForPlayer();
  checkLoot();
  if (checkStairs()) {
    endEnergyDash();
    return;
  }

  if (dash.traveled >= dash.maxDistance) endEnergyDash();
}

function teleportPlayerTo(x: number, y: number): void {
  if (!currentLayout || !isWalkable(x, y)) return;
  player = { x, y };
  touchAimCursor = null;
  updatePlayerVisual();
  updatePlayerAimFromPointer();
  revealRoomsFromCorridor(player.x, player.y);
  updateCurrentRoom();
  updateCameraForPlayer(true);
  checkLoot();
}

(window as Window & {
  __webcrawlTest?: {
    teleportPlayerTo: (x: number, y: number) => void;
    setWeaponAmmo: (ammo: number) => void;
    setPlayerInvulnerable: (enabled: boolean) => void;
    grantCrystals: (count: number) => void;
    grantEnergy: (count: number) => void;
    energy: () => number;
    dashing: () => boolean;
    useCrystal: () => boolean;
    expireCrystalShield: () => void;
    playerHp: () => number;
    playerFacing: () => Point;
    damagePlayer: (amount: number) => void;
    spawnHealingEffect: () => void;
    stairs: () => Array<Pick<Stair, "id" | "type" | "x" | "y" | "url" | "enabled">>;
    defeatAllMonsters: () => void;
    contentPoints: () => Array<{
      id: string;
      x: number;
      y: number;
      unlocked: boolean;
      enabled: boolean;
      turningOff: boolean;
      animating: boolean;
      texture: string | null;
    }>;
    portalContacts: () => string[];
    loot: () => Array<{ id: string; kind: string; x: number; y: number; ammo: number | null; name: string | null; placement: string | null }>;
    lastDroppedWeapon: () => { id: string; x: number; y: number; ammo: number | null; maxAmmo: number | null; name: string | null; placement: string | null } | null;
    camera: () => { x: number; y: number; zoom: number; bossRoomId: number | null } | null;
    navigate: (url: string) => Promise<void>;
    goBack: () => Promise<void>;
  };
}).__webcrawlTest = {
  teleportPlayerTo,
  setWeaponAmmo(ammo: number): void {
    if (currentWeapon.maxAmmo === null) return;
    currentWeaponAmmo = Math.max(0, Math.min(currentWeapon.maxAmmo, ammo));
    lastPlayerShotAt = -Infinity;
    updateWeaponUi();
  },
  setPlayerInvulnerable(enabled: boolean): void {
    playerInvulnerable = enabled;
    updatePlayerProtectionVisual();
  },
  grantCrystals(count: number): void {
    lootInventory.crystals = Math.max(0, lootInventory.crystals + count);
    updateLootUi();
  },
  grantEnergy(count: number): void {
    lootInventory.energy = Math.min(PLAYER_ENERGY_MAX, Math.max(0, lootInventory.energy + count));
    updateLootUi();
  },
  energy: () => lootInventory.energy,
  dashing: () => energyDash !== null,
  useCrystal: () => activateCrystalInvulnerability(),
  expireCrystalShield(): void {
    crystalInvulnerableUntil = 0;
    updatePlayerProtectionVisual();
  },
  playerHp: () => playerHp,
  playerFacing: () => ({ ...playerFacing }),
  damagePlayer: applyPlayerDamage,
  spawnHealingEffect(): void {
    renderer.spawnEffect(PLAYER_SPEC.visual.effects?.healing, player.x, player.y, PLAYER_SPEC.spriteSize, { followPlayer: true });
  },
    stairs: () => currentStairs.map(({ id, type, x, y, url, enabled }) => ({ id, type, x, y, url, enabled })),
    defeatAllMonsters(): void {
      for (const monster of currentMonsters) {
        if (!monster.dead) damageMonster(monster, monster.hp);
      }
    },
    contentPoints: () => currentDecorations
      .filter(item => item.contentPoint)
      .map(item => ({
        id: item.id,
        x: item.x,
        y: item.y,
        unlocked: Boolean(item.contentUnlocked),
        enabled: Boolean(item.contentEnabled),
        turningOff: Boolean(item.contentTurningOff),
        animating: item.spawnAnimationStartedAt !== undefined,
        texture: renderer.decorationTexture(item.id),
      })),
  portalContacts: () => [...portalContacts],
  camera: () => renderer.cameraState(),
  navigate: (url: string) => navigateTo(url),
  goBack: () => goBack(),
  loot: () => currentLoot.map(item => ({
    id: item.id,
    kind: item.kind,
    x: item.x,
    y: item.y,
    ammo: item.weaponAmmo ?? item.weapon?.maxAmmo ?? null,
    name: item.weapon?.name ?? null,
    placement: item.weaponPlacement ?? null,
  })),
  lastDroppedWeapon: () => lastDroppedWeapon
    ? {
      id: lastDroppedWeapon.id,
      x: lastDroppedWeapon.x,
      y: lastDroppedWeapon.y,
      ammo: lastDroppedWeapon.weaponAmmo ?? lastDroppedWeapon.weapon?.maxAmmo ?? null,
      maxAmmo: lastDroppedWeapon.weapon?.maxAmmo ?? null,
      name: lastDroppedWeapon.weapon?.name ?? null,
      placement: lastDroppedWeapon.weaponPlacement ?? null,
    }
    : null,
};

window.addEventListener("keydown", event => {
  if (event.code === "Space") {
    if (!gameUi.hidden) event.preventDefault();
    if (!teleportPauseActive) activateCrystalInvulnerability();
    return;
  }
  if (!(event.code in movementDirections)) return;
  if (
    gameUi.hidden ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    (event.target instanceof HTMLElement && event.target.isContentEditable)
  ) return;

  event.preventDefault();
  if (!event.repeat) heldMovementKeys.add(event.code);
}, { passive: false });

window.addEventListener("keyup", event => {
  if (!(event.code in movementDirections)) return;
  heldMovementKeys.delete(event.code);
});

function applyAimTarget(target: Point): void {
  renderer.setFlashlightTarget(target);
  const center = actorCollisionCenter(player, PLAYER_SPEC.visualCenterOffsetY);
  renderer.setCameraTarget({
    x: player.x + (target.x - player.x) / 3,
    y: player.y + (target.y - player.y) / 3,
  });
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < 1) return;
  playerFacing = { x: dx / magnitude, y: dy / magnitude };
  updatePlayerFacingAsset();
}

function updatePlayerAimFromPointer(): void {
  if (!pointerInViewport || !pointerClientPosition) {
    renderer.setCameraTarget(player);
    updateIdleFlashlight();
    playerAimDirty = false;
    lastAimCamera = null;
    return;
  }
  const target = renderer.worldPointAt(pointerClientPosition.x, pointerClientPosition.y);
  if (!target) {
    renderer.setFlashlightTarget(null);
    playerAimDirty = false;
    return;
  }
  applyAimTarget(target);
  const camera = renderer.cameraState();
  lastAimCamera = camera ? { x: camera.x, y: camera.y } : null;
  playerAimDirty = false;
}

function updateIdleFlashlight(): void {
  renderer.setFlashlightTarget({
    x: player.x,
    y: player.y + PLAYER_SPEC.visualCenterOffsetY,
  });
}

function playerAimNeedsUpdate(): boolean {
  if (playerAimDirty) return true;
  if (!pointerInViewport || !pointerClientPosition) return false;
  const camera = renderer.cameraState();
  if (!camera || !lastAimCamera) return true;
  return Math.abs(camera.x - lastAimCamera.x) > 0.1 || Math.abs(camera.y - lastAimCamera.y) > 0.1;
}

function updateTouchAim(dt: number): void {
  const vector = touchAimVector ?? { x: 0, y: 0 };
  const center = actorCollisionCenter(player, PLAYER_SPEC.visualCenterOffsetY);
  if (!touchAimCursor) {
    const magnitude = Math.hypot(vector.x, vector.y);
    const direction = magnitude > STICK_DEADZONE
      ? { x: vector.x / magnitude, y: vector.y / magnitude }
      : { x: playerFacing.x, y: playerFacing.y };
    touchAimCursor = {
      x: center.x + direction.x * TOUCH_AIM_SEED_RANGE,
      y: center.y + direction.y * TOUCH_AIM_SEED_RANGE,
    };
  } else {
    const magnitude = Math.hypot(vector.x, vector.y);
    if (magnitude > STICK_DEADZONE) {
      touchAimCursor = {
        x: touchAimCursor.x + vector.x * TOUCH_AIM_SPEED * dt,
        y: touchAimCursor.y + vector.y * TOUCH_AIM_SPEED * dt,
      };
    }
    const dx = touchAimCursor.x - center.x;
    const dy = touchAimCursor.y - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance > TOUCH_AIM_MAX_RANGE) {
      touchAimCursor = {
        x: center.x + dx / distance * TOUCH_AIM_MAX_RANGE,
        y: center.y + dy / distance * TOUCH_AIM_MAX_RANGE,
      };
    }
  }
  applyAimTarget(touchAimCursor);
}

function updatePlayerAim(clientX: number, clientY: number): void {
  pointerClientPosition = { x: clientX, y: clientY };
  playerAimDirty = true;
  updatePlayerAimFromPointer();
}

function resetPlayerInput(): void {
  heldMovementKeys.clear();
  primaryPointerDown = false;
  pointerClientPosition = null;
  playerAimDirty = true;
  lastAimCamera = null;
  playerSpriteAnimationToken += 1;
  playerShooting = false;
  touchMoveVector = null;
  moveStickPointerId = null;
  touchAimActive = false;
  touchAimVector = null;
  touchAimCursor = null;
  aimStickPointerId = null;
  renderer?.setFlashlightTarget(null);
  setPlayerMoving(false, performance.now());
  if (renderer) updatePlayerFacingAsset();
}

gameViewport.addEventListener("pointerenter", event => {
  pointerInViewport = true;
  if (!gameUi.hidden) updatePlayerAim(event.clientX, event.clientY);
});

gameViewport.addEventListener("pointermove", event => {
  pointerInViewport = true;
  if (primaryPointerDown && (event.buttons & 1) === 0) primaryPointerDown = false;
  if (!gameUi.hidden) updatePlayerAim(event.clientX, event.clientY);
});

gameViewport.addEventListener("pointerdown", event => {
  if (
    gameUi.hidden ||
    teleportPauseActive ||
    !currentLayout ||
    !playerAlive
  ) return;

  pointerInViewport = true;
  updatePlayerAim(event.clientX, event.clientY);

  if (event.button === 2) {
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    startEnergyDash(event.clientX, event.clientY);
    return;
  }
  if (event.button !== 0) return;

  event.preventDefault();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (mobileLayoutQuery.matches) return;
  primaryPointerDown = true;
  shootBullet();
});

gameViewport.addEventListener("contextmenu", event => {
  event.preventDefault();
});

gameViewport.addEventListener("pointerleave", () => {
  pointerInViewport = false;
  pointerClientPosition = null;
  primaryPointerDown = false;
  renderer.setCameraTarget(player);
  renderer.setFlashlightTarget(null);
});

window.addEventListener("pointerup", event => {
  if (event.button === 0) primaryPointerDown = false;
});

window.addEventListener("pointercancel", () => {
  primaryPointerDown = false;
});

const STICK_DEADZONE = 0.18;
const TOUCH_AIM_SPEED = world(520);
const TOUCH_AIM_MAX_RANGE = world(210);
const TOUCH_AIM_SEED_RANGE = world(80);
let touchMoveVector: Point | null = null;
let touchAimVector: Point | null = null;
let touchAimActive = false;
let touchAimCursor: Point | null = null;
let moveStickPointerId: number | null = null;
let aimStickPointerId: number | null = null;

function stickVectorFromEvent(stick: HTMLElement, event: PointerEvent): Point {
  const rect = stick.getBoundingClientRect();
  const radius = rect.width / 2;
  if (!radius) return { x: 0, y: 0 };
  let dx = (event.clientX - (rect.left + radius)) / radius;
  let dy = (event.clientY - (rect.top + radius)) / radius;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude > 1) {
    dx /= magnitude;
    dy /= magnitude;
  }
  return { x: dx, y: dy };
}

function setStickKnob(stick: HTMLElement, vector: Point): void {
  const knob = stick.querySelector<HTMLElement>(".touch-stick-knob");
  if (!knob) return;
  const travel = Math.max(0, stick.clientWidth / 2 - knob.clientWidth / 2 - 2);
  knob.style.transform =
    `translate(calc(-50% + ${(vector.x * travel).toFixed(1)}px), calc(-50% + ${(vector.y * travel).toFixed(1)}px))`;
}

moveStick.addEventListener("pointerdown", event => {
  if (gameUi.hidden || moveStickPointerId !== null) return;
  event.preventDefault();
  moveStickPointerId = event.pointerId;
  moveStick.setPointerCapture(event.pointerId);
  touchMoveVector = stickVectorFromEvent(moveStick, event);
  setStickKnob(moveStick, touchMoveVector);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

moveStick.addEventListener("pointermove", event => {
  if (event.pointerId !== moveStickPointerId) return;
  event.preventDefault();
  touchMoveVector = stickVectorFromEvent(moveStick, event);
  setStickKnob(moveStick, touchMoveVector);
});

function releaseMoveStick(event: PointerEvent): void {
  if (event.pointerId !== moveStickPointerId) return;
  moveStickPointerId = null;
  touchMoveVector = null;
  setStickKnob(moveStick, { x: 0, y: 0 });
}

moveStick.addEventListener("pointerup", releaseMoveStick);
moveStick.addEventListener("pointercancel", releaseMoveStick);

aimStick.addEventListener("pointerdown", event => {
  if (gameUi.hidden || aimStickPointerId !== null) return;
  event.preventDefault();
  aimStickPointerId = event.pointerId;
  aimStick.setPointerCapture(event.pointerId);
  touchAimActive = true;
  touchAimVector = stickVectorFromEvent(aimStick, event);
  touchAimCursor = null;
  setStickKnob(aimStick, touchAimVector);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (teleportPauseActive || !currentLayout || !playerAlive) return;
  shootBullet();
});

aimStick.addEventListener("pointermove", event => {
  if (event.pointerId !== aimStickPointerId) return;
  event.preventDefault();
  touchAimVector = stickVectorFromEvent(aimStick, event);
  setStickKnob(aimStick, touchAimVector);
});

function releaseAimStick(event: PointerEvent): void {
  if (event.pointerId !== aimStickPointerId) return;
  aimStickPointerId = null;
  touchAimActive = false;
  touchAimVector = null;
  touchAimCursor = null;
  setStickKnob(aimStick, { x: 0, y: 0 });
  renderer.setCameraTarget(player);
  renderer.setFlashlightTarget(null);
}

aimStick.addEventListener("pointerup", releaseAimStick);
aimStick.addEventListener("pointercancel", releaseAimStick);

bailoutButton.addEventListener("click", () => {
  if (gameUi.hidden || teleportPauseActive) return;
  activateCrystalInvulnerability();
});

captureButton.addEventListener("click", () => {
  if (gameUi.hidden || teleportPauseActive || !currentLayout || !playerAlive) return;
  const target = touchAimCursor ?? {
    x: player.x + playerFacing.x * world(120),
    y: player.y + playerFacing.y * world(120),
  };
  startEnergyDashTowards(target);
});

window.addEventListener("blur", () => {
  pointerInViewport = false;
  resetPlayerInput();
  pauseGameLoop();
});

window.addEventListener("focus", () => {
  resumeGameLoop();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resetPlayerInput();
    pauseGameLoop();
  } else {
    resumeGameLoop();
  }
});

function renderGraph(
  graph: DungeonGraph,
  pageUrl: string,
  {
    spawnRoomId = null,
    stateId = null,
    spawnPortalUrl = null,
  }: Pick<LoadPageOptions, "spawnRoomId" | "stateId"> & { spawnPortalUrl?: string | null } = {},
  preparedLayout: DungeonLayout | null = null,
): void {
  cancelPortalIntro();
  cancelPortalActivationSound();
  currentStateId = stateId ?? stateIdForPage(pageUrl);
  renderer.clear();
  if (killsCountEl) killsCountEl.textContent = String(runStats.kills);
  updateHealthUi();
  updateWeaponUi();
  bullets = [];
  hideLinkMenu();
  hideContentBrowser();
  hidePortalPreview();

  const layout = preparedLayout ?? layoutOrthogonal(graph);
  currentGraph = graph;
  currentLayout = layout;
  currentRoomsById = new Map(layout.nodes.map(room => [room.id, room]));
  roomRoutingDirty = true;
  nextRoomTowardPlayer = new Map();

  const savedDiscovery = discoveredRoomsByPage.get(currentStateId);
  visitedRooms = savedDiscovery
    ? new Set([...savedDiscovery].filter(id => layout.nodes.some(node => node.id === id)))
    : new Set();

  currentRoomId = null;

  const objects = buildInteractiveObjects(layout, pageUrl);
  currentStairs = objects.stairs;
  currentLoot = objects.loot;
  currentDecorations = buildDecorations(layout, pageUrl);
  currentSpawners = currentDecorations.filter(item => item.spawner);
  rebuildSpatialIndexes();
  currentLoot.push(...createSceneryDrops(currentDecorations, floorIdentity(pageUrl), collectedLoot));

  currentMonsters = MONSTERS_ENABLED ? buildMonsters(layout, pageUrl) : [];
  updateFloorPortals();
  renderer.setPortalStartupPreview(true);

  const root =
    layout.nodes.find(node => node.isRoot) ||
    layout.nodes.find(node => node.parentId === null);

  const spawnRoom =
    (spawnRoomId !== null
      ? layout.nodes.find(node => node.id === spawnRoomId)
      : null) ||
    root;

  if (spawnRoom) {
    const roomStairs = currentStairs.filter(stair => stair.roomId === spawnRoom.id);
    const entryPortal = entryPortalFor(roomStairs, spawnPortalUrl);
    player = initialPlayerPosition(entryPortal, spawnRoom);
    touchAimCursor = null;

    currentRoomId = spawnRoom.id;
    gameCanvasHost.dataset.currentRoomTag = spawnRoom.tag;
    visitedRooms.add(spawnRoom.id);

    if (root) {
      visitedRooms.add(root.id);
    }

    discoveredRoomsByPage.set(currentStateId, new Set(visitedRooms));
  }
  portalContacts.clear();
  updatePortalContacts(
    currentStairs,
    player,
    PORTAL_DEFINITION.contactRadius,
    portalContacts,
    PORTAL_DEFINITION.contactOffset,
  );

  renderer.setWorld(layout, visitedRooms);
  updateFogOfWar();
  renderDecorations();

  for (const roomId of visitedRooms) {
    activateMonstersInRoom(roomId);
  }

  renderMonsters();
  renderInteractiveObjects();
  updateContentPoints(performance.now());
  updatePlayerFacingAsset();
  revealRoomsFromCorridor(player.x, player.y);
  updateCameraForPlayer(true);
  updateLootUi();
  startGameLoop();
  const playIntroSound = initialFloorPortalIntroPending && floorNumber() === 1;
  initialFloorPortalIntroPending = false;
  schedulePortalIntroEnd(playIntroSound);

  setStatus(
    `Map: ${layout.nodes.length} visible rooms · ${layout.links.length} corridors` +
    ` · ${currentStairs.filter(d => d.type === "down").length} down stairs` +
    ` · ${currentLoot.length} loot` +
    ` · ${currentMonsters.filter(d => d.active && !d.dead).length} active monsters` +
    (layout.hiddenCount ? ` · ${layout.hiddenCount} hidden to avoid overlap` : "") +
    (graph.coalescedCount ? ` · coalesced ${graph.coalescedCount} of ${graph.originalCount}` : "") +
    ` · ${pageUrl}` +
    (graph.truncated ? ` · source capped at ${MAX_NODES} elements` : "")
  );
}

async function loadPage(
  rawUrl: string,
  {
    pushCurrent = false,
    popBack = false,
    returnRoomId = null,
    spawnRoomId = null,
    stateId = null
  }: LoadPageOptions = {},
  rendererReady: (() => Promise<void>) | null = null,
): Promise<void> {
  const retainedPointerPosition = pointerInViewport ? pointerClientPosition : null;
  resetPlayerInput();
  portalTransitioning = false;
  const requestId = ++currentRequest;
  const departingPageUrl = currentPageUrl;

  let url: string;
  try {
    url = normalizeUrl(rawUrl);
  } catch {
    setStatus("That does not look like a valid URL.", true);
    return;
  }
  cancelPortalIntro();
  renderer?.setPortalStartupPreview(false);
  cancelPortalActivationSound();

  const snapshot = stateId ? floorSnapshots.get(stateId) ?? null : null;
  let resolvedUrl = url;
  let graph: DungeonGraph;
  let layout: DungeonLayout;

  if (snapshot) {
    // Returning to a previously loaded floor (going back up or re-entering it
    // via a down portal): reuse its stored level instead of re-fetching and
    // re-generating it.
    if (LOADING_SCREEN_ENABLED) hideLoadingScreen();
    graph = snapshot.graph;
    layout = snapshot.layout;
    resolvedUrl = snapshot.url;
  } else {
    setStatus("Fetching " + url + " …");
    if (LOADING_SCREEN_ENABLED) {
      showLoadingScreen(url);
      setLoadingTask("fetch", "Fetching the page");
    }
    try {
      const { html, url: fetchedUrl, via } = await fetchHtml(url);
      if (requestId !== currentRequest) return;

      completeLoadingTask("fetch");
      setLoadingTask("generate", "Generating level");
      setStatus(`Fetched via ${via} · Generating level …`);
      graph = domToGraph(html, fetchedUrl, floorNumber());
      layout = layoutOrthogonal(graph);
      resolvedUrl = fetchedUrl;
      completeLoadingTask("generate");
    } catch (err) {
      if (requestId !== currentRequest) return;
      hideLoadingScreen();
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatus(`Could not load ${url}: ${message}`, true);
      showFetchErrorModal(url, message);
      return;
    }
  }

  try {
    if (rendererReady) await rendererReady();
    if (requestId !== currentRequest) return;
    saveCurrentFloorState();
    if (currentPageUrl && currentStateId && currentGraph && currentLayout) {
      floorSnapshots.set(currentStateId, {
        graph: currentGraph,
        layout: currentLayout,
        url: currentPageUrl,
      });
    }

    if (pushCurrent && currentPageUrl) {
      navigationHistory.push(currentPageUrl);
      navigationReturnRooms.push(returnRoomId ?? currentRoomId);
    }

    if (
      popBack &&
      navigationHistory[navigationHistory.length - 1] === resolvedUrl
    ) {
      navigationHistory.pop();
      navigationReturnRooms.pop();
    }

    currentPageUrl = resolvedUrl;
    updateUrlBar();
    currentStateId = stateId ?? stateIdForPage(resolvedUrl);
    renderGraph(graph, resolvedUrl, {
      spawnRoomId,
      stateId: currentStateId,
      spawnPortalUrl: popBack ? departingPageUrl : null,
    }, layout);
    gameStarted = true;
    if (retainedPointerPosition && pointerInViewport) {
      pointerClientPosition = retainedPointerPosition;
      updatePlayerAimFromPointer();
    }
  } catch (err) {
    if (requestId !== currentRequest) return;
    hideLoadingScreen();
    const message = err instanceof Error ? err.message : "Unknown error";
    setStatus(`Could not load ${url}: ${message}`, true);
    showFetchErrorModal(url, message);
  }
}

async function loadRenderer(): Promise<void> {
  await prefixFontReady;
  const { PhaserRenderer } = await import("./render/phaser-renderer");
  renderer = new PhaserRenderer(gameCanvasHost);
}

function startRenderer(): Promise<void> {
  return new Promise((resolve) => {
    renderer.start({
      onBootComplete: () => {
        window.clearTimeout(loadingBootGuardTimer);
        loadingBootGuardTimer = undefined;
        completeLoadingTask("boot");
        if (!LOADING_SCREEN_ENABLED) {
          gameUi.classList.add("game-ui-ready");
          renderer.playStationAmbient();
        }
        resolve();
      },
    });
  });
}

async function fetchLuckyJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LUCKY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Hacker News returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

function externalStoryUrl(story: unknown): string | null {
  if (typeof story !== "object" || story === null || !("url" in story)) return null;
  const url = story.url;
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

interface WikipediaRandomResponse {
  query?: { random?: Array<{ title?: unknown }> };
}

async function wikipediaRandomUrl(): Promise<string> {
  try {
    const data = await fetchLuckyJson(WIKIPEDIA_RANDOM_API_URL) as WikipediaRandomResponse;
    const title = data.query?.random?.[0]?.title;
    if (typeof title !== "string" || title.trim() === "") {
      throw new Error("Wikipedia returned no random page.");
    }
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.trim().replaceAll(" ", "_"))}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Could not select a Wikipedia article: ${message}. Using the random page redirect instead.`, true);
    return WIKIPEDIA_RANDOM_URL;
  }
}

async function luckyUrl(): Promise<string> {
  if (Math.random() < 0.5) return wikipediaRandomUrl();

  try {
    const storyIds = await fetchLuckyJson(HACKER_NEWS_TOP_STORIES_URL);
    const ids = Array.isArray(storyIds)
      ? storyIds.filter((id): id is number => typeof id === "number")
      : [];
    const id = ids[Math.floor(Math.random() * ids.length)];
    if (id === undefined) throw new Error("Hacker News returned no top stories.");

    const story = await fetchLuckyJson(`${HACKER_NEWS_ITEM_URL}/${id}.json`);
    return externalStoryUrl(story) ?? `https://news.ycombinator.com/item?id=${id}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Could not select a Hacker News story: ${message}. Using Wikipedia instead.`, true);
    return WIKIPEDIA_RANDOM_URL;
  }
}

function startWelcomeCrawl(rawUrl: string): void {
  stopAllMusic();
  welcomeTransitioning = true;
  welcomePrompt?.cancel();
  welcomeScreen.classList.add("closing");

  window.setTimeout(() => {
    welcomeScreen.hidden = true;
    welcomeScreen.classList.remove("closing");

    resetRunState();
    gameUi.hidden = false;

    if (LOADING_SCREEN_ENABLED) {
      showLoadingScreen(rawUrl);
      setLoadingTask("fetch", "Fetching the page");
      setLoadingTask("phaser", "Fetching Phaser");
      queueLoadingTask("generate", "Generating level");
      queueLoadingTask("boot", "Booting the renderer");
    }
    equipDefaultWeapon();

    const phaserReady = loadRenderer().then(
      () => completeLoadingTask("phaser"),
      (error: unknown) => {
        completeLoadingTask("phaser", false);
        throw error;
      },
    );
    void loadPage(rawUrl, {}, async () => {
      await phaserReady;
      setLoadingTask("boot", "Booting the renderer");
      loadingBootGuardTimer = window.setTimeout(() => {
        loadingBootGuardTimer = undefined;
        completeLoadingTask("boot");
      }, 30_000);
      await startRenderer();
    });
    updateHudPanels();
  }, SCREEN_FADE_MS);
}

function spawnWelcomePrompt(): void {
  welcomePrompt = setupWelcomePrompt({
    promptHost: welcomePromptBody,
    urlInput: welcomeUrlInput,
    surface: welcomeScreen,
    onTypingStart: startInterfaceTextLoop,
    onTypingEnd: stopInterfaceTextLoop,
  });
}

function startWelcomeSession(): void {
  if (welcomeSessionStarted) return;
  welcomeSessionStarted = true;
  playButtonClick();
  playWelcomeAmbient();
  promptLayout.classList.add("open");
  loginLayout.classList.add("closing");
  window.setTimeout(() => {
    loginLayout.hidden = true;
    loginLayout.classList.remove("closing");
  }, SCREEN_FADE_MS);
  spawnWelcomePrompt();
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startWelcomeSession();
});

for (const field of loginFields) {
  field.addEventListener("focus", () => {
    const length = field.value.length;
    field.setSelectionRange(length, length);
  });
  field.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    window.setTimeout(() => {
      if (document.activeElement === field) {
        const length = field.value.length;
        field.setSelectionRange(length, length);
      }
    }, 0);
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || welcomeSessionStarted || loginLayout.hidden) return;
  if (event.target instanceof Element && event.target.closest("#loginForm")) return;
  event.preventDefault();
  loginForm.requestSubmit();
});

welcomeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (welcomeTransitioning) return;
  playButtonClick();
  requestMobileFullscreen();
  startWelcomeCrawl(welcomeUrlInput.value);
});

luckyButton.addEventListener("click", () => {
  if (welcomeTransitioning) return;
  playButtonClick();
  requestMobileFullscreen();
  welcomeTransitioning = true;
  luckyButton.disabled = true;
  luckyButton.setAttribute("aria-busy", "true");
  void luckyUrl()
    .then((url) => {
      welcomeUrlInput.value = url;
      startWelcomeCrawl(url);
    })
    .catch((error: unknown) => {
      welcomeTransitioning = false;
      luckyButton.disabled = false;
      luckyButton.removeAttribute("aria-busy");
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Could not pick a random page: ${message}`, true);
    });
});
