import { describe, expect, it } from "vitest";
import { COLUMNS, COLUMN_HEIGHTS, type Column } from "./board.js";
import {
  apply,
  applyCommand,
  bustProbability,
  createGame,
  legalActions,
  moveOptions,
  redactGameForViewer,
  timeoutTurn,
} from "./engine.js";
import { createRng, type Rng } from "./rng.js";
import type { GameState } from "./types.js";

const PLAYERS = [
  { id: "p1", name: "甲" },
  { id: "p2", name: "乙" },
  { id: "p3", name: "丙" },
];

/** 从 p1 先手开局。 */
function newGame(count = 2): GameState {
  const game = createGame(PLAYERS.slice(0, count), 1);
  game.currentPlayer = 0;
  return game;
}

/** 按给定点数掷骰的假随机数。 */
function fixedDice(dice: number[]): Rng {
  let index = 0;
  const rng = createRng(0);
  return { ...rng, int: () => dice[index++]! - 1 };
}

function roll(state: GameState, dice: number[]) {
  return apply(state, state.players[state.currentPlayer]!.id, { type: "ROLL" }, fixedDice(dice));
}

function choose(state: GameState, sums: number[]) {
  return apply(state, state.players[state.currentPlayer]!.id, { type: "CHOOSE", sums }, createRng(0));
}

function stop(state: GameState) {
  return apply(state, state.players[state.currentPlayer]!.id, { type: "STOP" }, createRng(0));
}

const sumsOf = (state: GameState, dice: number[]) =>
  moveOptions(state, state.players[state.currentPlayer]!, state.runners, dice).map((option) => option.sums.join("+")).sort();

describe("开局", () => {
  it("2–4 人，每人 11 条赛道都从 0 开始，先掷骰", () => {
    expect(() => createGame(PLAYERS.slice(0, 1))).toThrow();
    const game = createGame(PLAYERS, 5);
    expect(game.players.map((player) => player.color)).toEqual([0, 1, 2]);
    for (const player of game.players) for (const column of COLUMNS) expect(player.progress[column]).toBe(0);
    expect(game.stage).toBe("roll");
    expect(game.turn).toBe(1);
    expect(game.events).toEqual([{ type: "TurnStarted", player: game.players[game.currentPlayer]!.id }]);
  });

  it("赛道高度 3,5,7,9,11,13,11,9,7,5,3", () => {
    expect(COLUMNS.map((column) => COLUMN_HEIGHTS[column])).toEqual([3, 5, 7, 9, 11, 13, 11, 9, 7, 5, 3]);
  });
});

describe("配对（规格书 4.2 的例子）", () => {
  const game = newGame();
  it("3,3,4,4：6 和 8，或 7 走 2 步", () => {
    expect(sumsOf(game, [3, 3, 4, 4])).toEqual(["6+8", "7+7"]);
  });
  it("2,3,4,5：5 和 9、6 和 8、7 走 2 步", () => {
    expect(sumsOf(game, [2, 3, 4, 5])).toEqual(["5+9", "6+8", "7+7"]);
  });
  it("4,4,4,6：只能 8 和 10", () => {
    expect(sumsOf(game, [4, 4, 4, 6])).toEqual(["8+10"]);
  });
  it("1,1,1,1：2 走 2 步", () => {
    expect(sumsOf(game, [1, 1, 1, 1])).toEqual(["2+2"]);
  });
  it("同一种推进由几种配对得到时合并，并记下所有配对", () => {
    const options = moveOptions(game, game.players[0]!, [], [3, 4, 3, 4]);
    const seven = options.find((option) => option.sums.join("+") === "7+7");
    expect(seven?.pairings.sort()).toEqual([0, 2]);
  });
});

describe("临时标记的限制", () => {
  it("三个临时标记都在用时，新赛道走不了；只有已在的赛道能走", () => {
    const game = newGame();
    game.runners = [{ column: 5, height: 1 }, { column: 6, height: 1 }, { column: 7, height: 1 }];
    // 1,4,4,5：5+9 / 6+8 / 6+8 → 只有 5 和 6 能走
    expect(sumsOf(game, [1, 4, 4, 5])).toEqual(["5", "6"]);
    // 4,4,5,5：8+10 / 9+9 / 9+9 → 全是新赛道，爆掉
    expect(sumsOf(game, [4, 4, 5, 5])).toEqual([]);
  });

  it("只剩一个临时标记、两个和都是新赛道：二选一", () => {
    const game = newGame();
    game.runners = [{ column: 5, height: 1 }, { column: 6, height: 1 }];
    // 3,4,4,4：7+8 / 7+8 / 7+8
    expect(sumsOf(game, [3, 4, 4, 4])).toEqual(["7", "8"]);
  });

  it("只剩一个临时标记、两个和相同：可以在这条新赛道上走 2 步", () => {
    const game = newGame();
    game.runners = [{ column: 5, height: 1 }, { column: 6, height: 1 }];
    // 3,3,4,4：6+8 / 7+7 / 7+7；6 已有标记、8 用最后一个；7+7 也只用一个新标记
    expect(sumsOf(game, [3, 3, 4, 4])).toEqual(["6+8", "7+7"]);
  });

  it("两个都能走时必须都走，不能只走一个", () => {
    const game = newGame();
    const options = sumsOf(game, [1, 2, 3, 4]);
    expect(options).toEqual(["3+7", "4+6", "5+5"]);
  });

  it("已关闭的赛道不能走，另一个和照走", () => {
    const game = newGame();
    game.owners[7] = "p2";
    // 3,4,1,1：7+2 / 4+5 / 4+5
    expect(sumsOf(game, [3, 4, 1, 1])).toEqual(["2", "4+5"]);
  });

  it("已在顶格的临时标记不能再走；双步只走得了一步时只走一步", () => {
    const game = newGame();
    game.runners = [{ column: 2, height: 3 }];
    expect(sumsOf(game, [1, 1, 1, 1])).toEqual([]);
    game.runners = [{ column: 2, height: 2 }];
    expect(sumsOf(game, [1, 1, 1, 1])).toEqual(["2"]);
  });

  it("新上一条赛道时从自己的营地上方一格开始", () => {
    const game = newGame();
    game.players[0]!.progress[7] = 4;
    const { state } = choose(roll(game, [3, 4, 3, 4]).state, [7, 7]);
    expect(state.runners).toEqual([{ column: 7, height: 6 }]);
  });
});

describe("回合流程", () => {
  it("掷骰 → 选推进 → 收手，进度锁定，轮到下一位", () => {
    const game = newGame();
    const rolled = roll(game, [2, 3, 4, 5]).state;
    expect(rolled.stage).toBe("choose");
    expect(rolled.lastRoll).toEqual({ player: "p1", dice: [2, 3, 4, 5], bust: false });
    const moved = choose(rolled, [6, 8]).state;
    expect(moved.stage).toBe("decide");
    expect(moved.runners).toEqual([{ column: 6, height: 1 }, { column: 8, height: 1 }]);
    expect(moved.lastRoll?.chosen).toEqual([6, 8]);
    const { state, events } = stop(moved);
    expect(state.players[0]!.progress[6]).toBe(1);
    expect(state.players[0]!.progress[8]).toBe(1);
    expect(state.runners).toEqual([]);
    expect(state.currentPlayer).toBe(1);
    expect(state.stage).toBe("roll");
    expect(state.turn).toBe(2);
    expect(events[0]).toEqual({ type: "Stopped", player: "p1", saved: [{ column: 6, from: 0, to: 1 }, { column: 8, from: 0, to: 1 }] });
    expect(events.at(-1)).toEqual({ type: "TurnStarted", player: "p2" });
  });

  it("再掷时临时标记留在原位继续走", () => {
    let game = newGame();
    game = choose(roll(game, [2, 3, 4, 5]).state, [6, 8]).state;
    game = choose(roll(game, [1, 5, 2, 6]).state, [6, 8]).state;
    expect(game.runners).toEqual([{ column: 6, height: 2 }, { column: 8, height: 2 }]);
    expect(game.rollsThisTurn).toBe(2);
  });

  it("爆掉：本回合进度作废，之前的营地不动，轮到下一位", () => {
    let game = newGame();
    game.players[0]!.progress[5] = 3;
    game = choose(roll(game, [1, 4, 4, 5]).state, [5, 9]).state;
    game = choose(roll(game, [3, 4, 3, 4]).state, [7, 7]).state;
    expect(game.runners.length).toBe(3);
    const { state, events } = roll(game, [6, 6, 4, 4]);
    expect(events.map((event) => event.type)).toEqual(["Rolled", "Busted", "TurnStarted"]);
    expect(state.players[0]!.progress[5]).toBe(3);
    expect(state.players[0]!.progress[9]).toBe(0);
    expect(state.runners).toEqual([]);
    expect(state.currentPlayer).toBe(1);
    expect(state.lastRoll).toEqual({ player: "p1", dice: [6, 6, 4, 4], bust: true });
  });

  it("没掷骰不能收手；选推进前不能再掷；不是你的回合不能动", () => {
    const game = newGame();
    expect(() => stop(game)).toThrow("还没掷骰");
    const rolled = roll(game, [2, 3, 4, 5]).state;
    expect(() => roll(rolled, [1, 1, 1, 1])).toThrow("先选");
    expect(() => stop(rolled)).toThrow("先选");
    expect(() => choose(rolled, [2, 12])).toThrow();
    expect(() => apply(game, "p2", { type: "ROLL" }, createRng(0))).toThrow("还没轮到你");
  });

  it("legalActions 按阶段给出动作", () => {
    let game = newGame();
    expect(legalActions(game, "p1")).toEqual([{ type: "ROLL" }]);
    expect(legalActions(game, "p2")).toEqual([]);
    game = roll(game, [4, 4, 4, 6]).state;
    expect(legalActions(game, "p1")).toEqual([{ type: "CHOOSE", sums: [8, 10] }]);
    game = choose(game, [8, 10]).state;
    expect(legalActions(game, "p1")).toEqual([{ type: "ROLL" }, { type: "STOP" }]);
  });
});

describe("占领赛道与胜负", () => {
  it("收手时临时标记在顶格：占领赛道，撤下别人的营地，赛道关闭", () => {
    let game = newGame();
    game.players[0]!.progress[2] = 1;
    game.players[1]!.progress[2] = 2;
    game = choose(roll(game, [1, 1, 1, 1]).state, [2, 2]).state;
    expect(game.runners).toEqual([{ column: 2, height: 3 }]);
    const { state, events } = stop(game);
    expect(state.owners[2]).toBe("p1");
    expect(state.players[0]!.score).toBe(1);
    expect(state.players[1]!.progress[2]).toBe(0);
    expect(events).toContainEqual({ type: "ColumnClaimed", player: "p1", column: 2, bumped: ["p2"] });
    // 关闭后谁都不能再走这条赛道
    expect(sumsOf(state, [1, 1, 1, 1])).toEqual([]);
  });

  it("到了顶格却继续掷骰爆掉，占领也一起作废", () => {
    let game = newGame();
    game.players[0]!.progress[2] = 1;
    game = choose(roll(game, [1, 1, 1, 1]).state, [2, 2]).state;
    game = choose(roll(game, [6, 6, 6, 5]).state, [11, 12]).state;
    // 三个临时标记都在 2、11、12 上，再掷 4,4,4,4（只能走 8）就爆掉
    const { state } = roll(game, [4, 4, 4, 4]);
    expect(state.owners[2]).toBeUndefined();
    expect(state.players[0]!.progress[2]).toBe(1);
  });

  it("占领第 3 条赛道立刻获胜", () => {
    let game = newGame();
    game.owners[3] = "p1";
    game.owners[11] = "p1";
    game.players[0]!.score = 2;
    game.players[0]!.progress[3] = 5;
    game.players[0]!.progress[11] = 5;
    game.players[0]!.progress[12] = 2;
    game = choose(roll(game, [6, 6, 1, 1]).state, [2, 12]).state;
    const { state, events } = stop(game);
    expect(state.phase).toBe("finished");
    expect(state.finalResult).toEqual({ winner: "p1", claimed: { p1: [3, 11, 12], p2: [] } });
    expect(events.at(-1)).toEqual({ type: "GameEnded", winner: "p1" });
    expect(() => apply(state, "p1", { type: "ROLL" }, createRng(0))).toThrow("已经结束");
  });
});

describe("超时", () => {
  it("回合开始没掷骰：跳过这回合", () => {
    const state = timeoutTurn(newGame());
    expect(state.currentPlayer).toBe(1);
    expect(state.events).toEqual([
      { type: "TurnTimedOut", player: "p1", stage: "roll" },
      { type: "TurnStarted", player: "p2" },
    ]);
  });

  it("掷了骰没选：自动选第一种并收手", () => {
    const rolled = roll(newGame(), [4, 4, 4, 6]).state;
    const state = timeoutTurn(rolled);
    expect(state.players[0]!.progress[8]).toBe(1);
    expect(state.players[0]!.progress[10]).toBe(1);
    expect(state.currentPlayer).toBe(1);
    expect(state.events.map((event) => event.type)).toEqual(["TurnTimedOut", "Advanced", "Stopped", "TurnStarted"]);
  });

  it("推进后没决定：收手保住进度", () => {
    const moved = choose(roll(newGame(), [4, 4, 4, 6]).state, [8, 10]).state;
    const state = timeoutTurn(moved);
    expect(state.players[0]!.progress[8]).toBe(1);
    expect(state.currentPlayer).toBe(1);
  });
});

describe("爆掉概率", () => {
  it("没有临时标记时不会爆掉；6、7、8 三条赛道约 8%", () => {
    const game = newGame();
    expect(bustProbability(game)).toBe(0);
    game.runners = [{ column: 6, height: 1 }, { column: 7, height: 1 }, { column: 8, height: 1 }];
    expect(bustProbability(game)).toBeCloseTo(0.08, 2);
    game.runners = [{ column: 2, height: 1 }, { column: 3, height: 1 }, { column: 12, height: 1 }];
    expect(bustProbability(game)).toBeGreaterThan(0.5);
  });
});

describe("视角与复现", () => {
  it("给玩家的状态去掉种子和动作序列", () => {
    const start = createGame(PLAYERS.slice(0, 2), 9);
    const game = applyCommand(start, start.players[start.currentPlayer]!.id, { type: "ROLL" });
    const view = redactGameForViewer(game, "p1");
    expect(view.seed).toBeUndefined();
    expect(view.rngState).toBeUndefined();
    expect(view.log).toBeUndefined();
    expect(game.log?.length).toBe(1);
  });

  it("同一种子同一串动作得到同一局", () => {
    const play = () => {
      let game = createGame(PLAYERS, 42);
      for (let i = 0; i < 40 && game.phase === "playing"; i += 1) {
        const id = game.players[game.currentPlayer]!.id;
        game = applyCommand(game, id, legalActions(game, id)[0]!);
      }
      return game;
    };
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});

/** 对局状态的不变量；返回违反的条目（逐步检查用普通判断，比每步调 expect 快得多）。 */
function invariantErrors(game: GameState): string[] {
  const errors: string[] = [];
  if (game.runners.length > game.config.runners) errors.push("临时标记超过 3 个");
  for (const runner of game.runners) {
    if (runner.height < 1 || runner.height > COLUMN_HEIGHTS[runner.column]) errors.push(`临时标记高度越界 ${runner.column}:${runner.height}`);
    if (game.owners[runner.column]) errors.push(`临时标记在已关闭的赛道 ${runner.column}`);
  }
  for (const column of COLUMNS) {
    const owner = game.owners[column as Column];
    for (const player of game.players) {
      const height = player.progress[column]!;
      if (owner && height !== (owner === player.id ? COLUMN_HEIGHTS[column] : 0)) errors.push(`已关闭赛道 ${column} 上还有营地`);
      if (!owner && (height < 0 || height >= COLUMN_HEIGHTS[column])) errors.push(`营地高度越界 ${column}:${height}`);
    }
  }
  for (const player of game.players) {
    if (player.score !== COLUMNS.filter((column) => game.owners[column] === player.id).length) errors.push("分数和占领数不符");
  }
  return errors;
}

describe("随机对局模拟", () => {
  it("300 局随机走到终局，状态始终合法", () => {
    const pick = createRng(2026);
    const players = [...PLAYERS, { id: "p4", name: "丁" }];
    for (let gameIndex = 0; gameIndex < 300; gameIndex += 1) {
      let game = createGame(players.slice(0, 2 + (gameIndex % 3)), gameIndex + 1);
      const errors: string[] = [];
      let steps = 0;
      while (game.phase === "playing" && steps < 20_000) {
        steps += 1;
        const id = game.players[game.currentPlayer]!.id;
        const actions = legalActions(game, id);
        if (actions.length === 0) errors.push("当前玩家没有合法动作");
        // 推进后 35% 收手，偶尔超时
        if (pick.next() < 0.01) game = timeoutTurn(game);
        else if (game.stage === "decide") game = applyCommand(game, id, pick.next() < 0.35 ? { type: "STOP" } : { type: "ROLL" });
        else game = applyCommand(game, id, pick.pick(actions));
        errors.push(...invariantErrors(game));
        if (errors.length > 0) break;
      }
      expect(errors, `第 ${gameIndex} 局`).toEqual([]);
      expect(game.phase).toBe("finished");
      const winner = game.players.find((player) => player.id === game.finalResult?.winner)!;
      // 一次收手可能同时占领两条赛道，所以赢家可能有 4 条
      expect(winner.score).toBeGreaterThanOrEqual(3);
      expect(game.players.filter((player) => player.score >= 3)).toEqual([winner]);
    }
  }, 60_000);
});
