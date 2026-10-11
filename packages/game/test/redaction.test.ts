/**
 * 隐藏信息（规则书 8.3）：牌堆顺序、种子、随机数状态、动作序列、别人这回合交的内容，每个视角都拿不到。
 */
import { describe, expect, it } from "vitest";
import {
  buildGame,
  createGame,
  greedySubmission,
  parseSheet,
  redactGameForSpectator,
  redactGameForViewer,
  sheetProblems,
  stateProblems,
  type GameState,
} from "../src/index.js";
import { submit, submitAll } from "./helpers.js";

function midRound(): GameState {
  let game = createGame(
    [1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}` })),
    "0123456789abcdef".repeat(4),
  );
  game = submitAll(game, Object.fromEntries(game.players.map((player) => [player.id, greedySubmission(game, player.id)])));
  // p1、p2 交了这回合，p3 还没交
  game = submit(game, "p1", greedySubmission(game, "p1"));
  game = submit(game, "p2", greedySubmission(game, "p2"));
  return game;
}

function leaks(view: GameState, full: GameState, viewer: string | null): string[] {
  const problems: string[] = [];
  const text = JSON.stringify(view);
  if ("seed" in view || "rngState" in view || "log" in view) problems.push("种子 / 随机数 / 动作序列");
  if (text.includes(String(full.seed))) problems.push("种子原文");
  if (view.stacks.some((stack) => stack.draw.length > 0)) problems.push("牌堆顺序");
  for (const player of view.players) {
    if (player.id !== viewer && player.pending !== null) problems.push(`${player.id} 交的内容`);
  }
  return problems;
}

describe("规则书8.3 隐藏信息", () => {
  const full = midRound();
  it("服务端完整状态里确实有这些东西（测试本身有效）", () => {
    expect(full.stacks.every((stack) => stack.draw.length > 0)).toBe(true);
    expect(full.players[0]!.pending).not.toBeNull();
    expect(full.seed).toBeDefined();
  });
  for (const viewer of ["p1", "p2", "p3"]) {
    it(`玩家 ${viewer} 的视角：拿不到牌堆、种子、别人交的内容；自己交的能看到`, () => {
      const view = redactGameForViewer(full, viewer);
      expect(leaks(view, full, viewer)).toEqual([]);
      const me = view.players.find((player) => player.id === viewer)!;
      expect(me.pending).toEqual(full.players.find((player) => player.id === viewer)!.pending);
      // 公开的：3 组、所有人的表、已交标记、剩余张数、目标卡
      expect(view.combos).toEqual(full.combos);
      expect(view.players.map((player) => player.sheet)).toEqual(full.players.map((player) => player.sheet));
      expect(view.players.map((player) => player.submitted)).toEqual([true, true, false]);
      expect(view.stacks.map((stack) => stack.drawCount)).toEqual(full.stacks.map((stack) => stack.drawCount));
    });
  }
  it("观战（默认）：谁交的内容都看不到", () => {
    expect(leaks(redactGameForSpectator(full, false), full, null)).toEqual([]);
  });
  it("观战看全部：能看到每人交的内容，但牌堆和种子仍然看不到", () => {
    const view = redactGameForSpectator(full, true);
    expect(view.players.filter((player) => player.pending !== null)).toHaveLength(2);
    expect(view.stacks.every((stack) => stack.draw.length === 0)).toBe(true);
    expect("seed" in view).toBe(false);
  });
  it("redact 不改原状态", () => {
    const before = JSON.stringify(full);
    redactGameForViewer(full, "p1");
    redactGameForSpectator(full, true);
    expect(JSON.stringify(full)).toBe(before);
  });
  it("事件里不带交的内容（Submitted 只有玩家 id）", () => {
    for (const event of full.events) expect(Object.keys(event).sort()).toEqual(["player", "type"]);
  });
});

describe("不变量检查本身有效", () => {
  it("能查出不递增、bis 数不一致、泳池数不一致", () => {
    const bad = parseSheet({ streets: ["5 3 _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"], bis: 1, poolTrack: 2 });
    const problems = sheetProblems(bad);
    expect(problems.some((text) => text.includes("不递增"))).toBe(true);
    expect(problems.some((text) => text.includes("bis"))).toBe(true);
    expect(problems.some((text) => text.includes("泳池"))).toBe(true);
  });
  it("能查出牌不守恒", () => {
    const game = buildGame({ players: 1 });
    game.stacks[0]!.draw.pop();
    expect(stateProblems(game).length).toBeGreaterThan(0);
  });
});
