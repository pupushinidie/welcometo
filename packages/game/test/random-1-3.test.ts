import { describe, expect, it } from "vitest";
import { runRandomGames } from "./random-harness.js";

describe("随机对局（1–3 人，每种 300 局）", () => {
  for (const players of [1,2,3]) {
    it(`${players} 人 300 局：不卡死、配件守恒、表始终合法、能判终局`, () => {
      const stats = runRandomGames(players, 300, players * 10_000);
      expect(stats.problems).toEqual([]);
      expect(stats.games).toBe(300);
      expect(stats.maxRounds).toBeLessThan(80);
    }, 120_000);
  }
});
