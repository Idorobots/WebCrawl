import { pointInCorridor, pointInRoomFloor, roomContainingFloorPoint } from "../domain/geometry";
import { WORLD_GEOMETRY } from "../domain/world-specs";
import type { DungeonLayout, GraphNode, LayoutLink, LootItem, Monster, Point, Stair } from "../types";

/** Map powerups can replace individual visibility rules without changing discovery. */
export interface MinimapVisibility {
  room(room: GraphNode, revealed: ReadonlySet<number>): boolean;
  corridor(link: LayoutLink, revealed: ReadonlySet<number>): boolean;
  pickup(item: LootItem, locationRevealed: boolean, revealed: ReadonlySet<number>): boolean;
  monster(monster: Monster, locationRevealed: boolean, revealed: ReadonlySet<number>): boolean;
}

export const DISCOVERED_MINIMAP_VISIBILITY: MinimapVisibility = {
  room: (room, revealed) => revealed.has(room.id),
  corridor: (link, revealed) => revealed.has(link.source.id) || revealed.has(link.target.id),
  pickup: (item, locationRevealed, revealed) => revealed.has(item.roomId) && locationRevealed,
  monster: (_monster, locationRevealed) => locationRevealed,
};

export interface MinimapGeometry {
  layout: DungeonLayout;
  rooms: GraphNode[];
  links: LayoutLink[];
  doors: Array<{ position: Point; vertical: boolean }>;
  roomIds: Set<number>;
  roomsById: Map<number, GraphNode>;
  center: Point;
  radius: number;
  scale: number;
  project(point: Point): Point;
}

export function buildMinimapGeometry(
  layout: DungeonLayout,
  revealed: ReadonlySet<number>,
  width: number,
  height: number,
  visibility = DISCOVERED_MINIMAP_VISIBILITY,
): MinimapGeometry {
  const rooms = layout.nodes.filter(room => visibility.room(room, revealed));
  const links = layout.links.filter(link => visibility.corridor(link, revealed));
  const roomIds = new Set(rooms.map(room => room.id));
  const doors = links.flatMap(link => {
    const point = link.points[0];
    if (!link.direct || !point || (!roomIds.has(link.source.id) && !roomIds.has(link.target.id))) return [];
    const vertical = link.direction === "E" || link.direction === "W";
    return [{
      position: { x: point.x, y: point.y + (vertical ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0) },
      vertical,
    }];
  });
  const center = { x: width / 2, y: height / 2 };
  const radius = Math.max(0, Math.min(width, height) / 2 - 1);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (point: Point, halfWidth: number, halfHeight: number): void => {
    minX = Math.min(minX, point.x - halfWidth);
    maxX = Math.max(maxX, point.x + halfWidth);
    minY = Math.min(minY, point.y - halfHeight);
    maxY = Math.max(maxY, point.y + halfHeight);
  };
  for (const room of rooms) include(room, room.width / 2, room.height / 2);
  for (const link of links) {
    if (!link.direct) for (const point of link.points) include(point, link.width / 2, link.width / 2);
  }
  const hasBounds = Number.isFinite(minX);
  const worldCenter = hasBounds ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: 0, y: 0 };
  // Fit the bounding rectangle's diagonal, so its corners also fit the circle.
  const padding = Math.min(18, Math.min(width, height) * 0.06);
  const scale = hasBounds
    ? Math.max(0, radius - padding) / Math.max(1, Math.hypot(maxX - minX, maxY - minY) / 2)
    : 1;
  return {
    layout, rooms, links, doors, center, radius, scale, roomIds,
    roomsById: new Map(layout.nodes.map(room => [room.id, room])),
    project: point => ({
      x: center.x + (point.x - worldCenter.x) * scale,
      y: center.y + (point.y - worldCenter.y) * scale,
    }),
  };
}

function locationIsRevealed(geometry: MinimapGeometry, point: Point, roomId: number): boolean {
  const assignedRoom = geometry.roomsById.get(roomId);
  const room = assignedRoom && pointInRoomFloor(point.x, point.y, assignedRoom)
    ? assignedRoom : roomContainingFloorPoint(geometry.layout.nodes, point);
  // A corridor touching an unrevealed room must not expose entities inside that room.
  if (room) return geometry.roomIds.has(room.id);
  return geometry.links.some(link => pointInCorridor(point.x, point.y, link));
}

export function minimapMarkers(
  geometry: MinimapGeometry,
  revealed: ReadonlySet<number>,
  stairs: readonly Stair[],
  loot: readonly LootItem[],
  monsters: readonly Monster[],
  visibility = DISCOVERED_MINIMAP_VISIBILITY,
): { portals: Array<{ room: GraphNode; up: boolean; down: boolean }>; pickups: LootItem[]; monsters: Monster[] } {
  const portals = new Map<number, { room: GraphNode; up: boolean; down: boolean }>();
  for (const stair of stairs) {
    if (!geometry.roomIds.has(stair.roomId)) continue;
    let marker = portals.get(stair.roomId);
    if (!marker) {
      marker = { room: geometry.roomsById.get(stair.roomId)!, up: false, down: false };
      portals.set(stair.roomId, marker);
    }
    marker[stair.type] = true;
  }
  return {
    portals: [...portals.values()],
    pickups: loot.filter(item => visibility.pickup(item, locationIsRevealed(geometry, item, item.roomId), revealed)),
    monsters: monsters.filter(monster => !monster.dead &&
      visibility.monster(monster, locationIsRevealed(geometry, monster, monster.roomId), revealed)),
  };
}

export const MINIMAP_COLORS = {
  background: "#071018",
  corridor: "#1a303e",
  room: "#1a303e",
  root: "#244d59",
  boss: "#782b39",
  border: "#568198",
  door: "#e3bc76",
  currentRoom: "#bafff1",
  downPortal: "#ff4fd8",
  upPortal: "#4d8dff",
  pickup: "#57d9c1",
  monster: "#ff525f",
  player: "#ffffff",
} as const;

export class MinimapRenderer {
  private background = document.createElement("canvas");
  private geometry: MinimapGeometry | null = null;
  private revealed = new Set<number>();
  private visibility: MinimapVisibility | null = null;
  private width = 0;
  private height = 0;
  private ratio = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  render(
    layout: DungeonLayout,
    revealed: ReadonlySet<number>,
    stairs: readonly Stair[],
    loot: readonly LootItem[],
    monsters: readonly Monster[],
    player: Point,
    visibility = DISCOVERED_MINIMAP_VISIBILITY,
  ): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const resized = width !== this.width || height !== this.height || ratio !== this.ratio;
    if (resized) {
      this.width = width;
      this.height = height;
      this.ratio = ratio;
      this.canvas.width = this.background.width = Math.round(width * ratio);
      this.canvas.height = this.background.height = Math.round(height * ratio);
    }
    if (resized || this.geometry?.layout !== layout || this.visibility !== visibility ||
        this.revealed.size !== revealed.size || [...revealed].some(id => !this.revealed.has(id))) {
      this.geometry = buildMinimapGeometry(layout, revealed, width, height, visibility);
      this.revealed = new Set(revealed);
      this.visibility = visibility;
      this.renderBackground();
    }
    const geometry = this.geometry!;
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(this.background, 0, 0, width, height);
    context.save();
    this.clip(context, geometry);
    const compact = width < 200;
    const currentRoom = roomContainingFloorPoint(geometry.rooms, player);
    if (currentRoom) {
      const corner = geometry.project({ x: currentRoom.x - currentRoom.width / 2, y: currentRoom.y - currentRoom.height / 2 });
      context.strokeStyle = MINIMAP_COLORS.currentRoom;
      context.lineWidth = 1.5;
      context.strokeRect(corner.x, corner.y, currentRoom.width * geometry.scale, currentRoom.height * geometry.scale);
    }
    // Draw after the current-room outline so shared-wall exits remain visible.
    context.strokeStyle = MINIMAP_COLORS.door;
    context.lineWidth = compact ? 2 : 3;
    context.lineCap = "butt";
    const halfDoor = Math.max(compact ? 3 : 5, WORLD_GEOMETRY.doorOpeningWidth * geometry.scale) / 2;
    for (const door of geometry.doors) {
      const position = geometry.project(door.position);
      context.beginPath();
      context.moveTo(position.x - (door.vertical ? 0 : halfDoor), position.y - (door.vertical ? halfDoor : 0));
      context.lineTo(position.x + (door.vertical ? 0 : halfDoor), position.y + (door.vertical ? halfDoor : 0));
      context.stroke();
    }
    const markers = minimapMarkers(geometry, revealed, stairs, loot, monsters, visibility);
    const dot = (point: Point, color: string, radius: number): void => {
      const position = geometry.project(point);
      context.fillStyle = color;
      context.beginPath();
      context.arc(position.x, position.y, radius, 0, Math.PI * 2);
      context.fill();
    };
    for (const item of markers.pickups) dot(item, MINIMAP_COLORS.pickup, compact ? 1.5 : 2);
    for (const monster of markers.monsters) dot(monster, MINIMAP_COLORS.monster, compact ? 1.5 : 2);
    for (const marker of markers.portals) {
      const position = geometry.project(marker.room);
      const size = Math.max(2, Math.min(compact ? 3 : 5, marker.room.width * geometry.scale / 6, marker.room.height * geometry.scale / 3));
      const both = marker.up && marker.down;
      for (const type of ["up", "down"] as const) {
        if (!marker[type]) continue;
        const x = position.x + (both ? (type === "up" ? -1 : 1) * (size + 1) : 0);
        const direction = type === "up" ? -1 : 1;
        context.fillStyle = type === "up" ? MINIMAP_COLORS.upPortal : MINIMAP_COLORS.downPortal;
        context.beginPath();
        context.moveTo(x, position.y + direction * size);
        context.lineTo(x - size, position.y - direction * size);
        context.lineTo(x + size, position.y - direction * size);
        context.closePath();
        context.fill();
      }
    }
    dot(player, MINIMAP_COLORS.player, compact ? 2.5 : 3.5);
    context.strokeStyle = "#071018";
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  private clip(context: CanvasRenderingContext2D, geometry: MinimapGeometry): void {
    context.beginPath();
    context.arc(geometry.center.x, geometry.center.y, geometry.radius, 0, Math.PI * 2);
    context.clip();
  }

  private renderBackground(): void {
    const context = this.background.getContext("2d");
    const geometry = this.geometry!;
    if (!context) return;
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.save();
    this.clip(context, geometry);
    context.fillStyle = MINIMAP_COLORS.background;
    context.fillRect(0, 0, this.width, this.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = MINIMAP_COLORS.corridor;
    for (const link of geometry.links) {
      if (link.direct) continue;
      context.lineWidth = Math.max(this.width < 200 ? 2.5 : 4, link.width * geometry.scale);
      context.beginPath();
      link.points.forEach((point, index) => {
        const position = geometry.project(point);
        if (index) context.lineTo(position.x, position.y);
        else context.moveTo(position.x, position.y);
      });
      context.stroke();
    }
    for (const room of geometry.rooms) {
      const corner = geometry.project({ x: room.x - room.width / 2, y: room.y - room.height / 2 });
      context.fillStyle = room.isBossArena ? MINIMAP_COLORS.boss : room.isRoot ? MINIMAP_COLORS.root : MINIMAP_COLORS.room;
      context.fillRect(corner.x, corner.y, room.width * geometry.scale, room.height * geometry.scale);
      context.strokeStyle = MINIMAP_COLORS.border;
      context.lineWidth = 1;
      context.strokeRect(corner.x, corner.y, room.width * geometry.scale, room.height * geometry.scale);
    }
    context.restore();
  }
}
