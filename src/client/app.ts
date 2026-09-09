import * as d3 from "d3";
import { fetchHtml, normalizeUrl } from "./api/fetch-html";
import {
  ASSETS,
  BULLET_MAX_DISTANCE,
  BULLET_RADIUS,
  BULLET_SPEED,
  CAMERA_SCALE,
  CAMERA_TRANSITION_MS,
  LOOT_ASSETS,
  LOOT_RADIUS,
  MAX_NODES,
  MAX_ROOMS_AFTER_COALESCE,
  MONSTER_ATTACK_RANGE,
  MONSTER_RADIUS,
  PLAYER_FIRE_COOLDOWN_MS,
  PLAYER_FRAMES,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_STEP,
  STAIR_RADIUS,
} from "./config";
import { distanceSquared, pointInCorridor, pointInRoom } from "./domain/geometry";
import {
  buildDecorations as createDecorations,
  buildInteractiveObjects as createInteractiveObjects,
  buildMonsters as createMonsters,
  lootKindForSeed,
} from "./domain/generation";
import { domToGraph } from "./domain/graph";
import { corridorEndpoints, layoutOrthogonal } from "./domain/layout";
import { revealedRoomPath as findRevealedRoomPath } from "./domain/pathfinding";
import { loadHighScores, rankHighScore, storeHighScores } from "./storage/high-scores";
import type {
  Bullet,
  Decoration,
  DungeonGraph,
  DungeonLayout,
  GraphNode,
  HighScore,
  LayoutLink,
  LoadPageOptions,
  LootItem,
  LootKind,
  Monster,
  MonsterState,
  ObstacleState,
  PlayerAnimation,
  PlayerDirection,
  Point,
  RunStats,
  Stair,
} from "./types";
import { requireElement } from "./ui/elements";

type Layer = d3.Selection<SVGGElement, unknown, any, any>;
type SvgSelection = d3.Selection<SVGSVGElement, unknown, any, any>;

const svg = d3.select<SVGSVGElement, unknown>("#map");
const urlInput = requireElement<HTMLInputElement>("#urlInput");
const form = requireElement<HTMLFormElement>("#urlForm");
const linkMenu = requireElement<HTMLDivElement>("#linkMenu");

const welcomeScreen = requireElement<HTMLDivElement>("#welcomeScreen");
const welcomeForm = requireElement<HTMLFormElement>("#welcomeForm");
const welcomeUrlInput = requireElement<HTMLInputElement>("#welcomeUrlInput");
const gameUi = requireElement<HTMLDivElement>("#gameUi");

const sideMinimapSvg = d3.select<SVGSVGElement, unknown>("#sideMinimapSvg");
const sideFloorLabelEl = requireElement<HTMLElement>("#sideFloorLabel");
const statRoomsEl = requireElement<HTMLElement>("#statRooms");
const statFloorEl = requireElement<HTMLElement>("#statFloor");
const statLootEl = requireElement<HTMLElement>("#statLoot");
const statKillsEl = requireElement<HTMLElement>("#statKills");
const statShotsEl = requireElement<HTMLElement>("#statShots");
const statTimeEl = requireElement<HTMLElement>("#statTime");
const playerHudPortraitEl = requireElement<HTMLImageElement>("#playerHudPortrait");

let currentRequest = 0;
let currentPageUrl: string | null = null;
const navigationHistory: string[] = [];
const navigationReturnRooms: Array<number | null> = [];

let currentLayout: DungeonLayout | null = null;
let currentStairs: Stair[] = [];
let currentLoot: LootItem[] = [];
let currentMonsters: Monster[] = [];
let monsterLayer: Layer | null = null;
let currentDecorations: Decoration[] = [];
let decorationLayer: Layer | null = null;
const destroyedObstaclesByPage = new Map<string, Map<string, ObstacleState>>();
let explosionLayer: Layer | null = null;
let visitedRooms = new Set<number>();
const discoveredRoomsByPage = new Map<string, Set<number>>();
const monsterStatesByPage = new Map<string, Map<string, MonsterState>>();

let currentRoomId: number | null = null;
let player: Point = { x: 0, y: 0 };
let playerFacing: Point = { x: 0, y: -1 };
let playerLayer: Layer | null = null;
let playerHp = PLAYER_MAX_HP;
let playerAlive = true;
let lastPlayerShotAt = -Infinity;

let bullets: Bullet[] = [];
let bulletLayer: Layer | null = null;

let monsterAnimationFrame: number | null = null;
let lastMonsterTick: number | null = null;

let lootScore = 0;
const collectedLoot = new Set<string>();
let runStartedAt: number | null = null;

const runStats: RunStats = {
  kills: 0,
  fastKills: 0,
  slowKills: 0,
  shotsFired: 0
};

let playerWalkFrameIndex = 0;
let playerSpriteAnimationToken = 0;
let playerSettleTimer: ReturnType<typeof setTimeout> | undefined;

// These duplicate counters were removed from the bottom HUD in v19.
// Keep guarded references because some legacy update paths still touch them.
const lootCountEl = document.querySelector<HTMLElement>("#lootCount");
const hpCountEl = requireElement<HTMLElement>("#hpCount");
const killsCountEl = document.querySelector<HTMLElement>("#killsCount");
const hudHealthFillEl = requireElement<HTMLElement>("#hudHealthFill");

const deathModal = requireElement<HTMLDivElement>("#deathModal");
const deathScoreEl = requireElement<HTMLElement>("#deathScore");
const newHighScoreEl = requireElement<HTMLElement>("#newHighScore");
const deathKillsEl = requireElement<HTMLElement>("#deathKills");
const deathFastKillsEl = requireElement<HTMLElement>("#deathFastKills");
const deathSlowKillsEl = requireElement<HTMLElement>("#deathSlowKills");
const deathShotsEl = requireElement<HTMLElement>("#deathShots");
const highScoreRowsEl = requireElement<HTMLTableSectionElement>("#highScoreRows");
const restartButton = requireElement<HTMLButtonElement>("#restartButton");
const minimapModal = requireElement<HTMLDivElement>("#minimapModal");
const minimapClose = requireElement<HTMLButtonElement>("#minimapClose");

const defs = svg.append("defs");

const roomPattern = defs
  .append("pattern")
  .attr("id", "roomFloorPattern")
  .attr("width", 34)
  .attr("height", 34)
  .attr("patternUnits", "userSpaceOnUse");

roomPattern
  .append("rect")
  .attr("width", 34)
  .attr("height", 34)
  .attr("fill", "#121c27");

roomPattern
  .append("path")
  .attr("d", "M 34 0 L 0 0 0 34")
  .attr("fill", "none")
  .attr("stroke", "#253747")
  .attr("stroke-width", 1.5);

roomPattern
  .append("circle")
  .attr("cx", 29)
  .attr("cy", 29)
  .attr("r", 1.4)
  .attr("fill", "#3f617b");

const rootLayer = svg.append("g");

const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
  .scaleExtent([0.08, 5])
  .on("zoom", (event) => {
    rootLayer.attr("transform", event.transform);
  });

svg.call(zoomBehavior);

function setStatus(message: string, isError = false): void {
  if (isError) {
    console.error(`[WebCrawl] ${message}`);
  } else {
    console.log(`[WebCrawl] ${message}`);
  }
}

function hideLinkMenu(): void {
  linkMenu.hidden = true;
  linkMenu.replaceChildren();
}

function navigateTo(url: string, returnRoomId = currentRoomId): void {
  hideLinkMenu();
  urlInput.value = url;
  loadPage(url, {
    pushCurrent: true,
    returnRoomId
  });
}

function goBack(): void {
  const previous = navigationHistory[navigationHistory.length - 1];
  if (!previous) return;

  const returnRoomId =
    navigationReturnRooms[navigationReturnRooms.length - 1] ?? null;

  hideLinkMenu();
  urlInput.value = previous;
  loadPage(previous, {
    popBack: true,
    spawnRoomId: returnRoomId
  });
}

document.addEventListener("click", (event) => {
  if (event.target instanceof Node && !linkMenu.contains(event.target)) hideLinkMenu();
});

function roomContainingPoint(x: number, y: number): GraphNode | null {
  if (!currentLayout) return null;

  for (const room of currentLayout.nodes) {
    if (pointInRoom(x, y, room, 0)) return room;
  }

  return null;
}

function updateFogOfWar(): void {
  rootLayer
    .selectAll<SVGGElement, GraphNode>(".room")
    .classed("visited", d => visitedRooms.has(d.id))
    .classed("unvisited", d => !visitedRooms.has(d.id));

  rootLayer
    .selectAll<SVGLineElement, LayoutLink>(".corridor")
    .classed("visited", d =>
      visitedRooms.has(d.source.id) ||
      visitedRooms.has(d.target.id)
    );

  rootLayer
    .selectAll<SVGLineElement, LayoutLink>(".corridor-light")
    .style("opacity", d =>
      visitedRooms.has(d.source.id) ||
      visitedRooms.has(d.target.id)
        ? 0.45
        : 0
    );

  if (!gameUi.hidden) {
    updateHudPanels();
  }
}

function markVisited(room: GraphNode | null): void {
  if (!room || visitedRooms.has(room.id)) return;

  visitedRooms.add(room.id);

  if (currentPageUrl) {
    discoveredRoomsByPage.set(currentPageUrl, new Set(visitedRooms));
  }

  updateFogOfWar();
  activateMonstersInRoom(room.id);
  renderDecorations();
  renderInteractiveObjects();
}

function corridorContainingPoint(x: number, y: number): LayoutLink | null {
  if (!currentLayout) return null;

  for (const link of currentLayout.links) {
    if (pointInCorridor(x, y, link, 0)) {
      return link;
    }
  }

  return null;
}

function revealRoomsFromCorridor(x: number, y: number): void {
  const link = corridorContainingPoint(x, y);
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
    currentRoomId = room.id;
    markVisited(room);
  }
}

function cameraTransformForPlayer(): d3.ZoomTransform {
  const { width, height } = svg.node()!.getBoundingClientRect();

  return d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(CAMERA_SCALE)
    .translate(-player.x, -player.y);
}

function centerCameraOnPlayer(animated = true): void {
  const transform = cameraTransformForPlayer();

  if (animated) {
    svg
      .transition()
      .duration(CAMERA_TRANSITION_MS)
      .ease(d3.easeCubicOut)
      .call(zoomBehavior.transform, transform);
  } else {
    svg.call(zoomBehavior.transform, transform);
  }
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
      visibleIds.has(link.source.id) ||
      visibleIds.has(link.target.id)
    )
  };
}

function drawMinimapStair(layer: Layer, stair: Stair): void {
  const g = layer
    .append("g")
    .attr("class", `minimap-stair ${stair.type}`)
    .attr("transform", `translate(${stair.x},${stair.y}) scale(0.55)`);

  g.append("rect")
    .attr("x", -18)
    .attr("y", -14)
    .attr("width", 36)
    .attr("height", 28)
    .attr("rx", 2);

  for (let y = -8; y <= 8; y += 8) {
    g.append("line")
      .attr("x1", -11)
      .attr("x2", 11)
      .attr("y1", y)
      .attr("y2", y);
  }
}

function renderMapInto(targetSvg: SvgSelection): void {
  const { nodes, links } = minimapVisibleLayout();
  const visibleIds = new Set(nodes.map(node => node.id));

  targetSvg.selectAll("*").remove();

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
    const p = corridorEndpoints(link);
    bounds.minX = Math.min(bounds.minX, p.x1, p.x2);
    bounds.maxX = Math.max(bounds.maxX, p.x1, p.x2);
    bounds.minY = Math.min(bounds.minY, p.y1, p.y2);
    bounds.maxY = Math.max(bounds.maxY, p.y1, p.y2);
  }

  const viewWidth = Math.max(1, bounds.maxX - bounds.minX);
  const viewHeight = Math.max(1, bounds.maxY - bounds.minY);
  const pad = 110;

  targetSvg.attr(
    "viewBox",
    `${bounds.minX - pad} ${bounds.minY - pad} ${viewWidth + pad * 2} ${viewHeight + pad * 2}`
  );

  targetSvg
    .append("g")
    .selectAll<SVGLineElement, LayoutLink>("line")
    .data(links)
    .join("line")
    .attr("class", "minimap-corridor")
    .each(function(this: SVGLineElement, link) {
      const p = corridorEndpoints(link);
      d3.select(this)
        .attr("x1", p.x1)
        .attr("y1", p.y1)
        .attr("x2", p.x2)
        .attr("y2", p.y2);
    });

  const rooms = targetSvg
    .append("g")
    .selectAll<SVGGElement, GraphNode>("g")
    .data(nodes)
    .join("g")
    .attr("class", d =>
      "minimap-room" +
      (d.isRoot ? " root" : "") +
      (d.id === currentRoomId ? " current" : "")
    )
    .attr("transform", d => `translate(${d.x},${d.y})`);

  rooms
    .append("rect")
    .attr("x", d => -d.width / 2)
    .attr("y", d => -d.height / 2)
    .attr("width", d => d.width)
    .attr("height", d => d.height);

  const visibleStairs = currentStairs.filter(stair =>
    visibleIds.has(stair.roomId)
  );

  const stairLayer = targetSvg.append("g");
  for (const stair of visibleStairs) {
    drawMinimapStair(stairLayer, stair);
  }

  const minimapPlayer = targetSvg
    .append("g")
    .attr("class", "minimap-player")
    .attr("transform", `translate(${player.x},${player.y})`);

  minimapPlayer
    .append("image")
    .attr("href", playerAssetForDirection())
    .attr("x", -18.75)
    .attr("y", -25)
    .attr("width", 37.5)
    .attr("height", 50)
    .attr("preserveAspectRatio", "xMidYMid meet");
}

function renderSideMinimap(): void {
  renderMapInto(sideMinimapSvg);
}

function formatRunTime(): string {
  if (!runStartedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((performance.now() - runStartedAt) / 1000));
  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function updateHudPanels(): void {
  const floor = navigationHistory.length + 1;
  const rooms = visitedRooms.size;

  sideFloorLabelEl.textContent = `FLOOR ${floor}`;
  statRoomsEl.textContent = `${rooms} / ${MAX_ROOMS_AFTER_COALESCE}`;
  statFloorEl.textContent = String(floor);
  statLootEl.textContent = String(lootScore);
  statKillsEl.textContent = String(runStats.kills);
  statShotsEl.textContent = String(runStats.shotsFired);
  statTimeEl.textContent = formatRunTime();
  renderSideMinimap();
}

function closeMinimap(): void {
  minimapModal.classList.remove("open");
  minimapModal.hidden = true;
}

minimapClose.addEventListener("click", closeMinimap);
minimapModal.addEventListener("click", event => {
  if (event.target === minimapModal) closeMinimap();
});

function updateHealthUi(): void {
  const ratio = Math.max(0, Math.min(1, playerHp / PLAYER_MAX_HP));
  hpCountEl.textContent = String(playerHp);
  hudHealthFillEl.style.width = `${ratio * 100}%`;

  if (playerLayer) {
    playerLayer
      .select(".player-hp-fill")
      .attr("width", 62 * ratio);
  }

  if (playerHudPortraitEl) {
    playerHudPortraitEl.src = playerAssetForDirection();
  }
}

function recordHighScore(): { scores: HighScore[]; rank: number | null } {
  const entry: HighScore = {
    score: lootScore,
    kills: runStats.kills,
    fastKills: runStats.fastKills,
    slowKills: runStats.slowKills,
    shotsFired: runStats.shotsFired,
    at: new Date().toISOString()
  };

  const { scores, rank } = rankHighScore(loadHighScores(), entry);
  storeHighScores(scores);
  return { scores, rank };
}

function showDeathModal(): void {
  const { scores, rank } = recordHighScore();

  deathScoreEl.textContent = `Loot recovered: ${lootScore}`;
  deathKillsEl.textContent = String(runStats.kills);
  deathFastKillsEl.textContent = String(runStats.fastKills);
  deathSlowKillsEl.textContent = String(runStats.slowKills);
  deathShotsEl.textContent = String(runStats.shotsFired);

  newHighScoreEl.textContent =
    rank === 1
      ? "New expedition high score."
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
  deathModal.classList.add("open");
}

restartButton.addEventListener("click", () => location.reload());

function lootAsset(kind: LootKind): string {
  return LOOT_ASSETS[kind];
}

function monsterAsset(monster: Monster): string {
  if (monster.fast) {
    return (monster.seed & 1)
      ? ASSETS.monsterFast
      : ASSETS.monsterScout;
  }

  return ((monster.seed >>> 4) & 1)
    ? ASSETS.monsterSlow
    : ASSETS.monsterScout;
}

function obstacleStateMapForPage(pageUrl: string): Map<string, ObstacleState> {
  if (!destroyedObstaclesByPage.has(pageUrl)) {
    destroyedObstaclesByPage.set(pageUrl, new Map());
  }
  return destroyedObstaclesByPage.get(pageUrl)!;
}

function saveObstacleState(item: Decoration): void {
  if (!currentPageUrl || !item.obstacle) return;

  obstacleStateMapForPage(currentPageUrl).set(item.id, {
    hp: item.hp,
    destroyed: item.destroyed
  });
}

function buildDecorations(layout: DungeonLayout, pageUrl: string): Decoration[] {
  return createDecorations(layout, obstacleStateMapForPage(pageUrl));
}

function renderDecorations(): void {
  if (!decorationLayer) {
    decorationLayer = rootLayer.append("g").attr("class", "decorations");
  }

  const visible = currentDecorations.filter(item =>
    visitedRooms.has(item.roomId) && !item.destroyed
  );

  const decor = decorationLayer
    .selectAll<SVGGElement, Decoration>("g.decoration")
    .data(visible, d => d.id)
    .join(
      enter => {
        const g = enter
          .append("g")
          .attr("class", d => `decoration${d.obstacle ? " obstacle" : ""}`);

        g.append("image")
          .attr("class", "decor-sprite");

        g.filter(d => d.obstacle)
          .append("rect")
          .attr("class", "obstacle-hp-bg")
          .attr("x", -22)
          .attr("y", -35)
          .attr("width", 44)
          .attr("height", 5);

        g.filter(d => d.obstacle)
          .append("rect")
          .attr("class", "obstacle-hp-fill")
          .attr("x", -22)
          .attr("y", -35)
          .attr("height", 5);

        return g;
      },
      update => update,
      exit => exit.remove()
    )
    .attr("class", d =>
      `decoration${d.obstacle ? " obstacle" : ""}${d.obstacle && d.hp < d.maxHp ? " damaged" : ""}`
    )
    .attr("transform", d => `translate(${d.x},${d.y})`);

  decor
    .select(".decor-sprite")
    .attr("href", d => d.asset)
    .attr("x", d => -d.size / 2)
    .attr("y", d => -d.size / 2)
    .attr("width", d => d.size)
    .attr("height", d => d.size);

  decor
    .select(".obstacle-hp-fill")
    .attr("width", d =>
      d.obstacle ? 44 * Math.max(0, d.hp) / Math.max(1, d.maxHp) : 0
    );
}

function spawnExplosion(x: number, y: number): void {
  if (!explosionLayer) {
    explosionLayer = rootLayer.append("g").attr("class", "explosions");
  }

  // Keep world-position translation on an outer group. The inner group
  // owns the CSS scale/rotation animation, so animation transforms cannot
  // override the obstacle's x/y position.
  const anchor = explosionLayer
    .append("g")
    .attr("transform", `translate(${x},${y})`);

  const g = anchor
    .append("g")
    .attr("class", "explosion");

  g.append("circle")
    .attr("class", "blast")
    .attr("r", 20);

  g.append("circle")
    .attr("class", "ring")
    .attr("r", 31);

  g.append("path")
    .attr("d", "M -30 0 L 30 0 M 0 -30 L 0 30 M -21 -21 L 21 21 M -21 21 L 21 -21")
    .attr("stroke", "#ffe79c")
    .attr("stroke-width", 5);

  setTimeout(() => anchor.remove(), 520);
}

function damageObstacle(item: Decoration, amount: number): void {
  if (!item?.obstacle || item.destroyed) return;

  item.hp = Math.max(0, item.hp - amount);

  if (item.hp <= 0) {
    item.destroyed = true;
    saveObstacleState(item);
    spawnExplosion(item.x, item.y);
    renderDecorations();
  } else {
    saveObstacleState(item);
    renderDecorations();
  }
}

function monsterStateMapForPage(pageUrl: string): Map<string, MonsterState> {
  if (!monsterStatesByPage.has(pageUrl)) {
    monsterStatesByPage.set(pageUrl, new Map());
  }
  return monsterStatesByPage.get(pageUrl)!;
}

function saveMonsterState(monster: Monster): void {
  if (!currentPageUrl) return;

  const states = monsterStateMapForPage(currentPageUrl);
  states.set(monster.id, {
    hp: monster.hp,
    dead: monster.dead,
    active: monster.active,
    droppedLoot: monster.droppedLoot || false,
    dropId: monster.dropId || null,
    dropX: monster.dropX ?? null,
    dropY: monster.dropY ?? null,
    dropKind: monster.dropKind ?? null
  });
}

function buildMonsters(layout: DungeonLayout, pageUrl: string): Monster[] {
  const monsters = createMonsters(layout, monsterStateMapForPage(pageUrl), visitedRooms);
  for (const monster of monsters) {
    if (monster.dead && monster.droppedLoot && monster.dropId && !collectedLoot.has(monster.dropId)) {
      currentLoot.push({
        id: monster.dropId,
        roomId: monster.roomId,
        x: monster.dropX ?? monster.x,
        y: monster.dropY ?? monster.y,
        kind: monster.dropKind || lootKindForSeed(monster.seed),
      });
    }
  }
  return monsters;
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

function renderMonsters(): void {
  if (!monsterLayer) {
    monsterLayer = rootLayer.append("g").attr("class", "monsters");
  }

  const visibleMonsters = currentMonsters.filter(monster =>
    monster.active && (!monster.dead || monster.deathAnimating)
  );

  const monsters = monsterLayer
    .selectAll<SVGGElement, Monster>("g.monster")
    .data(visibleMonsters, d => d.id)
    .join(
      enter => {
        const g = enter
          .append("g")
          .attr("class", d => `monster${d.fast ? " fast" : ""}`);

        g.append("image")
          .attr("class", "monster-sprite")
          .attr("href", d => monsterAsset(d))
          .attr("x", -31)
          .attr("y", -31)
          .attr("width", 62)
          .attr("height", 62);

        g.append("rect")
          .attr("class", "hp-bg")
          .attr("x", -20)
          .attr("y", -31)
          .attr("width", 40)
          .attr("height", 5);

        g.append("rect")
          .attr("class", "hp-fill")
          .attr("x", -20)
          .attr("y", -31)
          .attr("height", 5);

        g.append("title")
          .text(d => `${d.fast ? "Fast" : "Slow"} monster · ${d.maxHp} HP`);

        return g;
      },
      update => update,
      exit => exit.remove()
    )
    .attr("class", d =>
      "monster" +
      (d.fast ? " fast" : "") +
      (d.deathAnimating ? " dying" : "") +
      (d.moveDir === "left" ? " moving-left" : "") +
      (d.moveDir === "right" ? " moving-right" : "")
    )
    .attr("transform", d => `translate(${d.x},${d.y})`);

  monsters
    .select(".hp-fill")
    .attr("width", d => 40 * Math.max(0, d.hp) / d.maxHp);
}

function updateMonsterPositions(): void {
  if (!monsterLayer) return;

  monsterLayer
    .selectAll<SVGGElement, Monster>("g.monster")
    .attr("class", d =>
      "monster" +
      (d.fast ? " fast" : "") +
      (d.deathAnimating ? " dying" : "") +
      (d.moveDir === "left" ? " moving-left" : "") +
      (d.moveDir === "right" ? " moving-right" : "")
    )
    .attr("transform", d => `translate(${d.x},${d.y})`);

  monsterLayer
    .selectAll<SVGRectElement, Monster>(".hp-fill")
    .attr("width", d => 40 * Math.max(0, d.hp) / d.maxHp);
}

function applyPlayerDamage(amount: number): void {
  if (!playerAlive) return;

  playerHp = Math.max(0, playerHp - amount);
  hpCountEl.textContent = String(playerHp);

  if (playerLayer) {
    playerLayer.classed("hit", true);
    setTimeout(() => playerLayer?.classed("hit", false), 120);
  }

  updateHealthUi();

  if (playerHp <= 0) {
    playerAlive = false;
    const hud = document.querySelector("#hud");
    hud?.classList.add("game-over");
    setStatus("Operative signal lost.", true);
    showDeathModal();
  }
}

function monsterDrop(monster: Monster): void {
  if (!monster.dropsLoot || monster.droppedLoot) return;

  const dropId = `${currentPageUrl}::${monster.id}::monster-drop`;
  monster.droppedLoot = true;
  monster.dropId = dropId;
  monster.dropX = monster.x;
  monster.dropY = monster.y;
  monster.dropKind = lootKindForSeed(monster.seed);

  if (!collectedLoot.has(dropId)) {
    currentLoot.push({
      id: dropId,
      roomId: monster.roomId,
      x: monster.x,
      y: monster.y,
      kind: monster.dropKind
    });
  }
}

function damageMonster(monster: Monster, amount: number): void {
  if (monster.dead) return;

  monster.hp = Math.max(0, monster.hp - amount);

  if (monster.hp <= 0) {
    monster.dead = true;
    monster.deathAnimating = true;
    runStats.kills += 1;

    if (monster.fast) {
      runStats.fastKills += 1;
    } else {
      runStats.slowKills += 1;
    }

    if (killsCountEl) killsCountEl.textContent = String(runStats.kills);
    updateHudPanels();

    monsterDrop(monster);
    saveMonsterState(monster);
    renderMonsters();
    renderInteractiveObjects();

    setTimeout(() => {
      monster.deathAnimating = false;
      renderMonsters();
    }, 460);
  } else {
    saveMonsterState(monster);
    updateMonsterPositions();
  }
}

function renderBullets(): void {
  if (!bulletLayer) {
    bulletLayer = rootLayer.append("g").attr("class", "bullets");
  }

  bulletLayer
    .selectAll<SVGCircleElement, Bullet>("circle.bullet")
    .data(bullets, d => d.id)
    .join(
      enter => enter
        .append("circle")
        .attr("class", "bullet")
        .attr("r", BULLET_RADIUS),
      update => update,
      exit => exit.remove()
    )
    .attr("cx", d => d.x)
    .attr("cy", d => d.y);
}

function shootBullet(): void {
  if (!playerAlive || !minimapModal.hidden) return;

  const now = performance.now();
  if (now - lastPlayerShotAt < PLAYER_FIRE_COOLDOWN_MS) return;
  lastPlayerShotAt = now;
  runStats.shotsFired += 1;
  updateHudPanels();
  updatePlayerFacingAsset();
  setPlayerAnimation("shoot");
  settlePlayerAnimationSoon();

  const muzzleDistance = PLAYER_RADIUS + 12;
  const x = player.x + playerFacing.x * muzzleDistance;
  const y = player.y + playerFacing.y * muzzleDistance;

  bullets.push({
    id: `${now}-${Math.random()}`,
    x,
    y,
    vx: playerFacing.x * BULLET_SPEED,
    vy: playerFacing.y * BULLET_SPEED,
    traveled: 0
  });

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
    const segments = Math.max(1, Math.ceil(stepDistance / 8));
    const dx = stepX / segments;
    const dy = stepY / segments;
    let alive = true;

    for (let i = 0; i < segments && alive; i++) {
      bullet.x += dx;
      bullet.y += dy;
      bullet.traveled += Math.hypot(dx, dy);

      if (
        bullet.traveled >= BULLET_MAX_DISTANCE ||
        !isGeometryWalkable(bullet.x, bullet.y, BULLET_RADIUS)
      ) {
        alive = false;
        break;
      }

      for (const monster of currentMonsters) {
        if (!monster.active || monster.dead) continue;

        const hitDistance = Math.hypot(
          bullet.x - monster.x,
          bullet.y - monster.y
        );

        if (hitDistance <= MONSTER_RADIUS + BULLET_RADIUS) {
          damageMonster(monster, 1);
          alive = false;
          break;
        }
      }

      if (!alive) break;

      for (const item of currentDecorations) {
        if (!item.obstacle || item.destroyed) continue;

        const hitDistance = Math.hypot(
          bullet.x - item.x,
          bullet.y - item.y
        );

        if (hitDistance <= item.radius + BULLET_RADIUS) {
          damageObstacle(item, 1);
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


function monsterTick(timestamp: number): void {
  monsterAnimationFrame = requestAnimationFrame(monsterTick);

  if (!playerAlive || !minimapModal.hidden || !currentLayout) {
    lastMonsterTick = timestamp;
    return;
  }

  if (lastMonsterTick == null) {
    lastMonsterTick = timestamp;
    return;
  }

  const dt = Math.min(0.05, Math.max(0, (timestamp - lastMonsterTick) / 1000));
  lastMonsterTick = timestamp;

  updateBullets(dt);

  const roomsById = new Map(currentLayout.nodes.map(room => [room.id, room]));

  for (const monster of currentMonsters) {
    if (!monster.active || monster.dead) continue;

    const containingRoom = roomContainingPoint(monster.x, monster.y);
    if (containingRoom && visitedRooms.has(containingRoom.id)) {
      monster.roomId = containingRoom.id;
    }

    const path = findRevealedRoomPath(currentLayout, visitedRooms, monster.roomId, currentRoomId);
    if (!path) continue;

    let targetX = player.x;
    let targetY = player.y;

    if (monster.roomId !== currentRoomId && path.length >= 2) {
      const nextRoom = roomsById.get(path[1]!);
      if (!nextRoom) continue;
      targetX = nextRoom.x;
      targetY = nextRoom.y;
    }

    const dx = targetX - monster.x;
    const dy = targetY - monster.y;
    const distance = Math.hypot(dx, dy);

    if (distance > 0.001) {
      const step = Math.min(distance, monster.speed * dt);
      const nextX = monster.x + dx / distance * step;
      const nextY = monster.y + dy / distance * step;

      monster.moveDir =
        Math.abs(dx) > Math.abs(dy)
          ? (dx < 0 ? "left" : "right")
          : null;

      if (isWalkable(nextX, nextY, MONSTER_RADIUS)) {
        monster.x = nextX;
        monster.y = nextY;
      }
    } else {
      monster.moveDir = null;
    }

    const playerDistance = Math.hypot(
      player.x - monster.x,
      player.y - monster.y
    );

    if (
      playerDistance <= MONSTER_ATTACK_RANGE &&
      timestamp - monster.lastAttackAt >= monster.attackCooldownMs
    ) {
      monster.lastAttackAt = timestamp;
      applyPlayerDamage(monster.attackDamage);
    }
  }

  updateMonsterPositions();
}

function startMonsterLoop(): void {
  if (monsterAnimationFrame !== null) {
    cancelAnimationFrame(monsterAnimationFrame);
  }

  lastMonsterTick = null;
  monsterAnimationFrame = requestAnimationFrame(monsterTick);
}

function pointBlockedByDecoration(x: number, y: number, radius = PLAYER_RADIUS): boolean {
  for (const item of currentDecorations) {
    if (!item.obstacle || item.destroyed) continue;

    const distance = Math.hypot(x - item.x, y - item.y);
    if (distance < radius + item.radius) return true;
  }

  return false;
}

function isGeometryWalkable(x: number, y: number, radius = PLAYER_RADIUS): boolean {
  if (!currentLayout) return false;

  for (const room of currentLayout.nodes) {
    if (pointInRoom(x, y, room, radius)) return true;
  }

  for (const link of currentLayout.links) {
    if (pointInCorridor(x, y, link, radius)) return true;
  }

  return false;
}

function isWalkable(x: number, y: number, radius = PLAYER_RADIUS): boolean {
  return (
    isGeometryWalkable(x, y, radius) &&
    !pointBlockedByDecoration(x, y, radius)
  );
}

function drawStaircase(layer: Layer, stair: Stair): void {
  const g = layer
    .append("g")
    .attr("class", `stairs ${stair.type}${stair.enabled === false ? " inactive" : ""}`)
    .attr("transform", `translate(${stair.x},${stair.y})`);

  g.append("circle")
    .attr("class", "portal-ring")
    .attr("r", 27);

  g.append("circle")
    .attr("class", "portal-core")
    .attr("r", 20);

  for (let y = -11; y <= 11; y += 7) {
    g.append("line")
      .attr("class", "step-line")
      .attr("x1", -12)
      .attr("x2", 12)
      .attr("y1", y)
      .attr("y2", y);
  }

  g.append("text")
    .attr("class", "arrow")
    .attr("y", stair.type === "up" ? -39 : 39)
    .text(stair.type === "up" ? "▲" : "▼");

  g.append("title").text(
    stair.type === "up"
      ? (stair.enabled === false ? "Entrance portal" : `Up to ${stair.url}`)
      : `Down to ${stair.url}`
  );
}

function buildInteractiveObjects(layout: DungeonLayout, pageUrl: string): {
  stairs: Stair[];
  loot: LootItem[];
} {
  return createInteractiveObjects(
    layout,
    pageUrl,
    navigationHistory[navigationHistory.length - 1] ?? null,
    collectedLoot,
  );
}

function renderInteractiveObjects(): void {
  rootLayer.select("g.objects").remove();
  playerLayer?.remove();

  const objectLayer = rootLayer
    .append("g")
    .attr("class", "objects");

  for (const stair of currentStairs) {
    if (visitedRooms.has(stair.roomId)) {
      drawStaircase(objectLayer, stair);
    }
  }

  const lootLayer = objectLayer
    .append("g")
    .selectAll<SVGGElement, LootItem>("g")
    .data(currentLoot.filter(item => visitedRooms.has(item.roomId)))
    .join("g")
    .attr("class", "loot")
    .attr("transform", d => `translate(${d.x},${d.y})`);

  lootLayer
    .append("image")
    .attr("class", "loot-sprite")
    .attr("href", d => lootAsset(d.kind))
    .attr("x", -21)
    .attr("y", -21)
    .attr("width", 42)
    .attr("height", 42);

  lootLayer
    .append("title")
    .text(d => `Recovered ${d.kind || "alien artifact"}`);

  playerLayer = rootLayer
    .append("g")
    .attr("class", "player");

  playerLayer
    .append("image")
    .attr("class", "avatar")
    .attr("href", playerAssetForDirection())
    .attr("x", -37.5)
    .attr("y", -50)
    .attr("width", 75)
    .attr("height", 100)
    .attr("preserveAspectRatio", "xMidYMid meet");

  playerLayer
    .append("rect")
    .attr("class", "player-hp-bg")
    .attr("x", -32)
    .attr("y", -47)
    .attr("width", 64)
    .attr("height", 7);

  playerLayer
    .append("rect")
    .attr("class", "player-hp-fill")
    .attr("x", -31)
    .attr("y", -46)
    .attr("height", 5);

  updatePlayerVisual();
  updateHealthUi();
}

function updatePlayerVisual(): void {
  if (playerLayer) {
    playerLayer.attr("transform", `translate(${player.x},${player.y})`);
  }

  if (!gameUi.hidden) {
    updateHudPanels();
  }
}

function checkLoot(): void {
  let changed = false;

  currentLoot = currentLoot.filter(item => {
    if (distanceSquared(player, item) <= LOOT_RADIUS * LOOT_RADIUS) {
      collectedLoot.add(item.id);
      lootScore += 1;
      if (lootCountEl) lootCountEl.textContent = String(lootScore);
      updateHudPanels();

      if (item.kind === "medkit" && playerAlive) {
        const restored = playerHp < PLAYER_MAX_HP ? 1 : 0;

        if (restored > 0) {
          playerHp += restored;
          updateHealthUi();
          setStatus(`Health pack restored 1 HP · ${currentPageUrl}`);
        }
      }

      changed = true;
      return false;
    }
    return true;
  });

  if (changed) {
    renderInteractiveObjects();
  }
}

function checkStairs(): boolean {
  for (const stair of currentStairs) {
    if (stair.enabled === false) continue;

    if (distanceSquared(player, stair) <= STAIR_RADIUS * STAIR_RADIUS) {
      if (stair.type === "up") {
        goBack();
      } else {
        if (stair.url) navigateTo(stair.url, stair.roomId);
      }
      return true;
    }
  }

  return false;
}

function playerFramesFor(
  direction: PlayerDirection = playerDirectionName(),
  kind: PlayerAnimation = "walk",
): string[] {
  return PLAYER_FRAMES[direction]?.[kind] || PLAYER_FRAMES.right.walk;
}

function playerAssetForDirection(direction: PlayerDirection = playerDirectionName()): string {
  return playerFramesFor(direction, "walk")[0]!;
}

function setPlayerSpriteAsset(asset: string): void {
  if (playerLayer) {
    playerLayer.select(".avatar").attr("href", asset);
  }

  if (playerHudPortraitEl) {
    playerHudPortraitEl.src = asset;
  }
}

function updatePlayerFacingAsset(): void {
  setPlayerSpriteAsset(playerAssetForDirection());
}

function advancePlayerWalkFrame(): void {
  const frames = playerFramesFor(playerDirectionName(), "walk");
  playerWalkFrameIndex = (playerWalkFrameIndex + 1) % frames.length;
  setPlayerSpriteAsset(frames[playerWalkFrameIndex]!);
}

function playPlayerShootFrames(): void {
  const token = ++playerSpriteAnimationToken;
  const direction = playerDirectionName();
  const frames = playerFramesFor(direction, "shoot");

  frames.forEach((asset, index) => {
    setTimeout(() => {
      if (token !== playerSpriteAnimationToken) return;
      setPlayerSpriteAsset(asset);
    }, index * 55);
  });

  setTimeout(() => {
    if (token !== playerSpriteAnimationToken) return;
    setPlayerSpriteAsset(playerAssetForDirection(direction));
  }, frames.length * 55 + 10);
}

function playerDirectionName(): PlayerDirection {
  if (Math.abs(playerFacing.x) > Math.abs(playerFacing.y)) {
    return playerFacing.x < 0 ? "left" : "right";
  }

  return playerFacing.y < 0 ? "up" : "down";
}

function setPlayerAnimation(kind: "move" | "shoot"): void {
  if (!playerLayer) return;

  playerLayer
    .classed("moving-up", false)
    .classed("moving-down", false)
    .classed("moving-left", false)
    .classed("moving-right", false)
    .classed("shooting-up", false)
    .classed("shooting-down", false)
    .classed("shooting-left", false)
    .classed("shooting-right", false);

  const direction = playerDirectionName();

  if (kind === "move") {
    playerLayer.classed(`moving-${direction}`, true);
    advancePlayerWalkFrame();
  } else if (kind === "shoot") {
    playerLayer.classed(`shooting-${direction}`, true);
    playPlayerShootFrames();
  }
}

function settlePlayerAnimationSoon(): void {
  clearTimeout(playerSettleTimer);
  playerSettleTimer = setTimeout(() => {
    playerLayer
      ?.classed("moving-up", false)
      .classed("moving-down", false)
      .classed("moving-left", false)
      .classed("moving-right", false)
      .classed("shooting-up", false)
      .classed("shooting-down", false)
      .classed("shooting-left", false)
      .classed("shooting-right", false);
  }, 180);
}

function movePlayer(dx: number, dy: number): void {
  if (!playerAlive) return;

  const magnitude = Math.hypot(dx, dy);
  if (magnitude > 0) {
    playerFacing = {
      x: dx / magnitude,
      y: dy / magnitude
    };
    updatePlayerFacingAsset();
  }

  const next = {
    x: player.x + dx,
    y: player.y + dy
  };

  if (!isWalkable(next.x, next.y)) return;

  setPlayerAnimation("move");
  settlePlayerAnimationSoon();
  player = next;
  updatePlayerVisual();
  revealRoomsFromCorridor(player.x, player.y);
  updateCurrentRoom();
  centerCameraOnPlayer(true);
  checkLoot();
  checkStairs();
}

window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (key === "escape" && !minimapModal.hidden) {
    event.preventDefault();
    closeMinimap();
    return;
  }

  if (!minimapModal.hidden) return;

  if (event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) shootBullet();
    return;
  }

  const moves: Partial<Record<string, [number, number]>> = {
    ArrowUp: [0, -PLAYER_STEP],
    ArrowDown: [0, PLAYER_STEP],
    ArrowLeft: [-PLAYER_STEP, 0],
    ArrowRight: [PLAYER_STEP, 0]
  };

  const move = moves[event.key];
  if (!move) return;

  event.preventDefault();
  movePlayer(move[0], move[1]);
}, { passive: false });

function renderGraph(
  graph: DungeonGraph,
  pageUrl: string,
  { spawnRoomId = null }: Pick<LoadPageOptions, "spawnRoomId"> = {},
): void {
  rootLayer.selectAll("*").remove();
  hpCountEl.textContent = String(playerHp);
  if (killsCountEl) killsCountEl.textContent = String(runStats.kills);
  updateHealthUi();
  bullets = [];
  bulletLayer = null;
  decorationLayer = null;
  explosionLayer = null;
  hideLinkMenu();
  closeMinimap();

  const { width, height } = svg.node()!.getBoundingClientRect();
  const layout = layoutOrthogonal(graph, width, height);
  currentLayout = layout;

  const savedDiscovery = discoveredRoomsByPage.get(pageUrl);
  visitedRooms = savedDiscovery
    ? new Set([...savedDiscovery].filter(id => layout.nodes.some(node => node.id === id)))
    : new Set();

  currentRoomId = null;

  svg.call(zoomBehavior.transform, d3.zoomIdentity);

  const corridorGroup = rootLayer.append("g");

  corridorGroup
    .selectAll<SVGLineElement, LayoutLink>("line.corridor")
    .data(layout.links)
    .join("line")
    .attr("class", "corridor")
    .each(function(this: SVGLineElement, link) {
      const p = corridorEndpoints(link);
      d3.select(this)
        .attr("x1", p.x1)
        .attr("y1", p.y1)
        .attr("x2", p.x2)
        .attr("y2", p.y2);
    });

  corridorGroup
    .selectAll<SVGLineElement, LayoutLink>("line.corridor-light")
    .data(layout.links)
    .join("line")
    .attr("class", "corridor-light")
    .style("opacity", d =>
      visitedRooms.has(d.source.id) || visitedRooms.has(d.target.id)
        ? 0.45
        : 0
    )
    .each(function(this: SVGLineElement, link) {
      const p = corridorEndpoints(link);
      d3.select(this)
        .attr("x1", p.x1)
        .attr("y1", p.y1)
        .attr("x2", p.x2)
        .attr("y2", p.y2);
    });

  const room = rootLayer
    .append("g")
    .selectAll<SVGGElement, GraphNode>("g")
    .data(layout.nodes)
    .join("g")
    .attr("class", d =>
      "room" +
      (d.isRoot ? " root" : "") +
      (d.isHidden ? " hidden" : "") +
      " unvisited"
    )
    .attr("transform", d => `translate(${d.x},${d.y})`);

  room
    .append("rect")
    .attr("x", d => -d.width / 2)
    .attr("y", d => -d.height / 2)
    .attr("width", d => d.width)
    .attr("height", d => d.height);

  room
    .append("rect")
    .attr("class", "room-shell")
    .attr("x", d => -d.width / 2 + 14)
    .attr("y", d => -d.height / 2 + 14)
    .attr("width", d => d.width - 28)
    .attr("height", d => d.height - 28)
    .attr("rx", 6)
    .attr("ry", 6);

  room.each(function(this: SVGGElement, d) {
    const g = d3.select(this);
    const points: Array<[number, number]> = [
      [-d.width / 2 + 18, -d.height / 2 + 18],
      [ d.width / 2 - 18, -d.height / 2 + 18],
      [-d.width / 2 + 18,  d.height / 2 - 18],
      [ d.width / 2 - 18,  d.height / 2 - 18]
    ];

    g.selectAll<SVGCircleElement, [number, number]>("circle.room-corner")
      .data(points)
      .join("circle")
      .attr("class", "room-corner")
      .attr("cx", p => p[0])
      .attr("cy", p => p[1])
      .attr("r", 4);
  });

  room
    .append("title")
    .text(d => d.title);

  const objects = buildInteractiveObjects(layout, pageUrl);
  currentStairs = objects.stairs;
  currentLoot = objects.loot;
  currentDecorations = buildDecorations(layout, pageUrl);

  currentMonsters = buildMonsters(layout, pageUrl);

  const root =
    layout.nodes.find(node => node.isRoot) ||
    layout.nodes.find(node => node.parentId === null);

  const spawnRoom =
    (spawnRoomId !== null
      ? layout.nodes.find(node => node.id === spawnRoomId)
      : null) ||
    root;

  if (spawnRoom) {
    player = {
      x: spawnRoom.x,
      y: spawnRoom.y + 60
    };

    if (!isWalkable(player.x, player.y)) {
      player = { x: spawnRoom.x, y: spawnRoom.y };
    }

    currentRoomId = spawnRoom.id;
    visitedRooms.add(spawnRoom.id);

    if (root) {
      visitedRooms.add(root.id);
    }

    discoveredRoomsByPage.set(pageUrl, new Set(visitedRooms));
  }

  updateFogOfWar();

  decorationLayer = rootLayer.append("g").attr("class", "decorations");
  explosionLayer = rootLayer.append("g").attr("class", "explosions");
  renderDecorations();

  monsterLayer = rootLayer.append("g").attr("class", "monsters");
  bulletLayer = rootLayer.append("g").attr("class", "bullets");

  for (const roomId of visitedRooms) {
    activateMonstersInRoom(roomId);
  }

  renderMonsters();
  renderInteractiveObjects();
  updatePlayerFacingAsset();
  revealRoomsFromCorridor(player.x, player.y);
  centerCameraOnPlayer(false);
  updateHudPanels();
  startMonsterLoop();

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
    spawnRoomId = null
  }: LoadPageOptions = {},
): Promise<void> {
  const requestId = ++currentRequest;

  let url: string;
  try {
    url = normalizeUrl(rawUrl);
  } catch {
    setStatus("That does not look like a valid URL.", true);
    return;
  }

  urlInput.value = url;
  setStatus("Fetching " + url + " …");

  try {
    const html = await fetchHtml(url);
    if (requestId !== currentRequest) return;

    setStatus("Parsing HTML …");
    const graph = domToGraph(html, url);

    if (pushCurrent && currentPageUrl && currentPageUrl !== url) {
      navigationHistory.push(currentPageUrl);
      navigationReturnRooms.push(returnRoomId ?? currentRoomId);
    }

    if (
      popBack &&
      navigationHistory[navigationHistory.length - 1] === url
    ) {
      navigationHistory.pop();
      navigationReturnRooms.pop();
    }

    currentPageUrl = url;
    renderGraph(graph, url, { spawnRoomId });
  } catch (err) {
    if (requestId !== currentRequest) return;
    const message = err instanceof Error ? err.message : "Unknown error";
    setStatus(
      `Could not load ${url}: ${message}. ` +
      "The remote site may reject automated requests or the server may have blocked the target URL.",
      true
    );
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadPage(urlInput.value, { pushCurrent: true });
});

welcomeForm.addEventListener("submit", (event) => {
  event.preventDefault();

  gameUi.hidden = false;
  welcomeScreen.hidden = true;
  runStartedAt = performance.now();

  urlInput.value = welcomeUrlInput.value;
  loadPage(welcomeUrlInput.value);
  updateHudPanels();
});

setInterval(() => {
  if (!gameUi.hidden && playerAlive) {
    updateHudPanels();
  }
}, 1000);
