import * as definitions from "./specs";
import { resolveGeometry, resolveGeometryDefinitions } from "./object-geometry";

// Gameplay and rendering import this module for pixel geometry. The authored
// specifications in specs.ts retain their size-relative offsets and radii.
export * from "./specs";

export const PLAYER_SPEC = resolveGeometry(definitions.PLAYER_SPEC);
export const REGULAR_MONSTER_DEFINITIONS = resolveGeometryDefinitions(definitions.REGULAR_MONSTER_DEFINITIONS);
export const BOSS_DEFINITIONS = resolveGeometryDefinitions(definitions.BOSS_DEFINITIONS);
export const DECORATION_DEFINITIONS = resolveGeometryDefinitions(definitions.DECORATION_DEFINITIONS);
export const LOOT_DEFINITIONS = resolveGeometryDefinitions(definitions.LOOT_DEFINITIONS);
export const WEAPON_PICKUP_DEFINITIONS = resolveGeometryDefinitions(definitions.WEAPON_PICKUP_DEFINITIONS);
export const PORTAL_DEFINITION = resolveGeometry(definitions.PORTAL_DEFINITION);

const decorationById = new Map<string, definitions.DecorationDefinition>(Object.values(DECORATION_DEFINITIONS).map(definition =>
  [definition.definitionId, definition]
));
const worldDecoration = (definition: definitions.DecorationDefinition) => decorationById.get(definition.definitionId)!;

export const OBSTACLE_DEFINITIONS = definitions.OBSTACLE_DEFINITIONS.map(worldDecoration);
export const SCENERY_DEFINITIONS = definitions.SCENERY_DEFINITIONS.map(worldDecoration);

function resolveSceneryThemes(): Record<definitions.RoomSceneryTheme, definitions.RoomSceneryThemeDefinition> {
  const themes = {} as Record<definitions.RoomSceneryTheme, definitions.RoomSceneryThemeDefinition>;
  for (const key of Object.keys(definitions.ROOM_SCENERY_THEMES) as definitions.RoomSceneryTheme[]) {
    const theme = definitions.ROOM_SCENERY_THEMES[key];
    themes[key] = {
      ...theme,
      primary: theme.primary.map(entry => ({ ...entry, definition: worldDecoration(entry.definition) })),
      accents: theme.accents.map(entry => ({ ...entry, definition: worldDecoration(entry.definition) })),
    };
  }
  return themes;
}

export const ROOM_SCENERY_THEMES = resolveSceneryThemes();
