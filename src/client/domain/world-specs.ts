import * as definitions from "./specs";
import { resolveGeometry, resolveGeometryDefinitions } from "./object-geometry";

// Resolve geometry for the player, pickups and portals, which do not carry
// geometry in runtime state. Scenery and monster definitions stay relative;
// their geometry is resolved at each collision/rendering boundary.
export * from "./specs";

export const PLAYER_SPEC = resolveGeometry(definitions.PLAYER_SPEC);
export const LOOT_DEFINITIONS = resolveGeometryDefinitions(definitions.LOOT_DEFINITIONS);
export const WEAPON_PICKUP_DEFINITIONS = resolveGeometryDefinitions(definitions.WEAPON_PICKUP_DEFINITIONS);
export const PORTAL_DEFINITION = resolveGeometry(definitions.PORTAL_DEFINITION);
