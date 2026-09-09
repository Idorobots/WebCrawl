import { describe, expect, it } from "vitest";
import { loadHighScores, rankHighScore, storeHighScores } from "../../src/client/storage/high-scores";
import type { HighScore } from "../../src/client/types";

const score = (value: number, kills: number, at: string): HighScore => ({
  score: value,
  kills,
  fastKills: 0,
  slowKills: kills,
  sentryKills: 0,
  shotsFired: 2,
  at,
});

describe("high scores", () => {
  it("persists valid score data", () => {
    const values = [score(3, 1, "2025-01-01T00:00:00.000Z")];
    storeHighScores(values);
    expect(loadHighScores()).toEqual(values);
  });

  it("defaults missing sentry kill counts when loading old scores", () => {
    localStorage.setItem("alien-web-crawler-high-scores-v1", JSON.stringify([{
      score: 7,
      kills: 2,
      fastKills: 1,
      slowKills: 1,
      shotsFired: 5,
      at: "2025-01-01T00:00:00.000Z",
    }]));

    expect(loadHighScores()[0]?.sentryKills).toBe(0);
  });

  it("ranks loot first and kills second", () => {
    const entry = score(4, 3, "2025-01-02T00:00:00.000Z");
    const result = rankHighScore([
      score(5, 0, "2025-01-01T00:00:00.000Z"),
      score(4, 1, "2025-01-03T00:00:00.000Z"),
    ], entry);
    expect(result.rank).toBe(2);
    expect(result.scores[1]).toBe(entry);
  });
});
