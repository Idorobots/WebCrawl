import { BACKGROUND_ASSETS } from "../config";
import { stableHash } from "./hash";

export function backgroundAssetForUrl(pageUrl: string): string {
  return BACKGROUND_ASSETS[stableHash(`${pageUrl}|background`) % BACKGROUND_ASSETS.length]!;
}
