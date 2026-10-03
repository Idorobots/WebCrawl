export type LightDetail = "none" | "low" | "medium" | "high";

export const LIGHT_DETAIL_STORAGE_KEY = "webcrawl-light-detail";

export function recommendedLightDetail(maxLights: number): LightDetail {
  if (maxLights >= 128) return "high";
  if (maxLights >= 16) return "medium";
  if (maxLights >= 1) return "low";
  return "none";
}

export function loadLightDetail(maxLights: number, storage?: Storage): LightDetail {
  try {
    const saved = (storage ?? localStorage).getItem(LIGHT_DETAIL_STORAGE_KEY);
    if (saved === "none" || saved === "low" || saved === "medium" || saved === "high") return saved;
  } catch {
    // Private browsing and disabled storage should still allow play.
  }
  return recommendedLightDetail(maxLights);
}

export function storeLightDetail(detail: LightDetail, storage?: Storage): void {
  try {
    (storage ?? localStorage).setItem(LIGHT_DETAIL_STORAGE_KEY, detail);
  } catch {
    // Keep the current session's choice when storage is unavailable.
  }
}
