import { describe, expect, it } from "vitest";
import { COLUMN_HEIGHTS } from "./board.js";
import { botCommand } from "./bot.js";
import { applyCommand, createGame, legalActions } from "./engine.js";
import type { GameState } from "./types.js";

function newGame(count: number, seed: number): GameState {
  return createGame(Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` })), seed);
}

/** 推进完以后（decide 阶段）的局面：当前玩家 p1，本回合登山者按 runners 摆。 */
function deciding(runners: { column: number; height: number }[], score = 0): GameState {
  const game = newGame(2, 1);
  game.currentPlayer = 0;
  game.stage = "decide";
  game.runners = runners as GameState["runners"];
  game.players[0]!.score = score;
  return game;
}

describe("人机", () => {
  it("没轮到它时不行动", () => {
    const game = newGame(2, 3);
    const idle = game.players.find((_, index) => index !== game.currentPlayer)!;
    expect(botCommand(game, idle.id)).toBeNull();
  });

  it("全由人机打的 200 局都正常打完，每一步都是合法动作", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      let game = newGame(2 + (seed % 3), seed);
      let steps = 0;
      while (game.phase === "playing") {
        const playerId = game.players[game.currentPlayer]!.id;
        const command = botCommand(game, playerId)!;
        expect(legalActions(game, playerId)).toContainEqual(command);
        game = applyCommand(game, playerId, command);
        steps += 1;
        expect(steps).toBeLessThan(5000);
      }
      expect(game.finalResult?.winner).toBeTruthy();
    }
  }, 60_000);

  it("刚爬了一格就收手不划算：再掷", () => {
    expect(botCommand(deciding([{ column: 7, height: 1 }]), "p1")).toEqual({ type: "ROLL" });
  });

  it("三个登山者都在两头、本回合爬了很多：收手", () => {
    const game = deciding([{ column: 2, height: 2 }, { column: 12, height: 2 }, { column: 3, height: 4 }]);
    expect(botCommand(game, "p1")).toEqual({ type: "STOP" });
  });

  it("收手就能赢时一定收手", () => {
    // 已经占领 2 条，7 号也爬到顶了；就算再掷几乎不会爆也要收手
    const game = deciding([{ column: 7, height: COLUMN_HEIGHTS[7] }, { column: 6, height: 1 }], 2);
    expect(botCommand(game, "p1")).toEqual({ type: "STOP" });
  });

  it("选走法时优先走已经有登山者的赛道，不浪费新的登山者", () => {
    const game = deciding([{ column: 7, height: 3 }, { column: 8, height: 2 }]);
    game.stage = "choose";
    // 只剩 1 个空闲登山者：走 7、8 不占新的，走 2 要占掉最后一个
    game.options = [{ sums: [7, 8], pairings: [0] }, { sums: [2], pairings: [1] }];
    expect(botCommand(game, "p1")).toEqual({ type: "CHOOSE", sums: [7, 8] });
  });
});
