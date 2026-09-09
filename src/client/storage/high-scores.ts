import { HIGH_SCORE_KEY } from "../config";
import type { HighScore } from "../types";

export function loadHighScores(storage: Storage = localStorage): HighScore[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(HIGH_SCORE_KEY) || "[]");
    return Array.isArray(value) ? value as HighScore[] : [];
  } catch {
    return [];
  }
}

export function storeHighScores(scores: HighScore[], storage: Storage = localStorage): void {
  try {
    storage.setItem(HIGH_SCORE_KEY, JSON.stringify(scores));
  } catch {
    // Storage may be disabled or full; scores are non-critical state.
  }
}

export function rankHighScore(scores: HighScore[], entry: HighScore): {
  scores: HighScore[];
  rank: number | null;
} {
  const ranked = [...scores, entry]
    .sort((left, right) =>
      (right.score - left.score) ||
      (right.kills - left.kills) ||
      left.at.localeCompare(right.at),
    )
    .slice(0, 10);
  const index = ranked.indexOf(entry);
  return { scores: ranked, rank: index >= 0 ? index + 1 : null };
}
