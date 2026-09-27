import { stableHash } from "./hash";

export const SIGNAGE_FONTS = ["Prefix", "Desoto", "Projects Fenotype", "Searider Falcon"] as const;
export const STATION_AMBIENT_TRACKS = [
  "sounds/ambient/station/space.mp3",
  "sounds/ambient/station/asteroid.mp3",
  "sounds/ambient/station/technology.mp3",
] as const;

export function signageFontForUrl(pageUrl: string): string {
  return SIGNAGE_FONTS[stableHash(`${pageUrl}|signage-font`) % SIGNAGE_FONTS.length]!;
}

export function stationAmbientForUrl(pageUrl: string): string {
  return STATION_AMBIENT_TRACKS[stableHash(`${pageUrl}|station-ambient`) % STATION_AMBIENT_TRACKS.length]!;
}
