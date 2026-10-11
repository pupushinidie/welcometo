/**
 * 补充文件第一节（勘误，以它为准）的每一条，以及开工拍板的「首个完成目标卡可选重洗」。
 */
import { describe, expect, it } from "vitest";
import {
  BIS_TRACK,
  CARD_TABLE,
  ESTATE_TRACKS,
  PARK_TRACKS,
  PLAN_DEFS,
  POOL_SLOTS,
  POOL_TRACK,
  REFUSAL_TRACK,
  STREET_LENGTHS,
  apply,
  buildDeck,
  buildGame,
  canBis,
  canFence,
  canImprove,
  checkSubmission,
  createGame,
  createRng,
  emptySheet,
  parseSheet,
  scoreSheet,
  type Card,
  type GameState,
} from "../src/index.js";
import { EMPTY, solo, submit, submitAll } from "./helpers.js";

describe("补充1.1 玩家表", () => {
  it("三条街 10 / 11 / 12 房，共 33；9 个泳池位在 3,7,8 / 1,4,8 / 2,7,11（从 1 数）", () => {
    expect(STREET_LENGTHS).toEqual([10, 11, 12]);
    const sheet = emptySheet();
    expect(sheet.houses.map((street) => street.length)).toEqual([10, 11, 12]);
    expect(POOL_SLOTS.map((slots) => slots.map((index) => index + 1))).toEqual([[3, 7, 8], [1, 4, 8], [2, 7, 11]]);
  });
  it("公园轨 [0,2,4,10] / [0,2,4,6,14] / [0,2,4,6,8,18]，可勾 3 / 4 / 5 格", () => {
    expect(PARK_TRACKS).toEqual([[0, 2, 4, 10], [0, 2, 4, 6, 14], [0, 2, 4, 6, 8, 18]]);
  });
});

describe("补充1.2 计分区各轨道", () => {
  it("泳池、bis、拒批、尺寸列的印面值", () => {
    expect(POOL_TRACK).toEqual([0, 3, 6, 9, 13, 17, 21, 26, 31, 36]);
    expect(BIS_TRACK).toEqual([0, 1, 3, 6, 9, 12, 16, 20, 24, 28]);
    expect(REFUSAL_TRACK).toEqual([0, 0, 3, 5]);
    expect(ESTATE_TRACKS).toEqual([[1, 3], [2, 3, 4], [3, 4, 5, 6], [4, 5, 6, 7, 8], [5, 6, 7, 8, 9, 10], [6, 7, 8, 9, 10, 11, 12]]);
  });
  it("拒批勾 1 格罚 0、2 格罚 3、3 格罚 5（取还没勾的最小值）；bis 勾 4 格罚 9", () => {
    expect(scoreSheet(parseSheet({ refusals: 1 })).refusals).toBe(0);
    expect(scoreSheet(parseSheet({ refusals: 2 })).refusals).toBe(3);
    expect(scoreSheet(parseSheet({ refusals: 3 })).refusals).toBe(5);
    expect(scoreSheet(parseSheet({ bis: 4 })).total).toBe(-9);
    expect(scoreSheet(parseSheet({ bis: 1 })).total).toBe(-1);
  });
  it("某列勾满后不能再选这列改造（1 房列只能勾 1 格）", () => {
    const sheet = parseSheet({ improve: [1, 2, 0, 0, 0, 6] });
    expect(canImprove(sheet, 1)).toBe(false);
    expect(canImprove(sheet, 2)).toBe(false);
    expect(canImprove(sheet, 3)).toBe(true);
    expect(canImprove(sheet, 6)).toBe(false);
    const game = solo({ improve: [1] }, { combos: [{ num: 5, action: "improve" }, { num: 9, action: "park" }, { num: 12, action: "temp" }] });
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 3, improve: 1 } })).toMatch(/勾满/);
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 3, improve: 6 } })).toBeNull();
  });
  it("尺寸 6 列勾满单价 12；尺寸 1 勾 1 格单价 3", () => {
    const sheet = parseSheet({ streets: ["1 | 2 3 4 5 6 7 | _ _ _", EMPTY[1], EMPTY[2]], improve: [1, 0, 0, 0, 0, 6] });
    expect(scoreSheet(sheet).estates).toBe(3 + 12);
  });
});

describe("补充1.3 牌库配对和翻牌", () => {
  it("每个数字背面的行动张数和表一致，行列合计都对", () => {
    const deck = buildDeck();
    for (const [action, row] of Object.entries(CARD_TABLE)) {
      row.forEach((count, index) => {
        expect(deck.filter((card) => card.action === action && card.num === index + 1)).toHaveLength(count);
      });
    }
    const perNum = Array.from({ length: 15 }, (_, i) => Object.values(CARD_TABLE).reduce((sum, row) => sum + row[i]!, 0));
    expect(perNum).toEqual([3, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3, 3]);
  });
  it("一组 = 这堆露出那张的数字 + 刚翻开那张的行动（不是同一张的两面）", () => {
    const deck = buildDeck();
    const stacks = [deck.slice(0, 27), deck.slice(27, 54), deck.slice(54, 81)];
    const game = createGame([{ id: "p1", name: "我" }], 1, { stacks, plans: ["1-1", "2-1", "3-1"] });
    stacks.forEach((stack, index) => {
      expect(game.combos[index]).toEqual({ num: stack[1]!.num, action: stack[0]!.action });
      expect(game.stacks[index]!.discard).toEqual([stack[0]]);
      expect(game.stacks[index]!.drawCount).toBe(26);
    });
    // 第 2 回合：行动来自第 2 张，数字来自第 3 张
    const next = submit(game, "p1", { move: { combo: 0, street: 2, house: 0 } });
    stacks.forEach((stack, index) => {
      expect(next.combos[index]).toEqual({ num: stack[2]!.num, action: stack[1]!.action });
    });
  });
  it("某堆翻完：这堆其余翻过的牌洗成新堆，81 张守恒，不会卡住", () => {
    let game = buildGame({ players: 1, combos: [{ num: 3, action: "fence" }, { num: 8, action: "park" }, { num: 12, action: "pool" }], drawLeft: 2 });
    const r = createRng(5);
    // 每回合随便找个能填的地方；填满前就会翻完
    for (let i = 0; i < 4; i += 1) {
      game = apply(game, "p1", { type: "submit", submission: anySubmission(game) }, r).state;
      const ids = game.stacks.flatMap((stack) => [...stack.draw, ...stack.discard].map((card) => card.id));
      expect(new Set(ids).size).toBe(81);
      for (const stack of game.stacks) expect(stack.draw.length).toBeGreaterThan(0);
    }
    expect(game.events.some((event) => event.type === "Reshuffled") || game.round > 2).toBe(true);
  });
});

function anySubmission(game: GameState) {
  const sheet = game.players[0]!.sheet;
  for (let c = 0; c < 3; c += 1) {
    for (let s = 0; s < 3; s += 1) {
      for (let h = 0; h < sheet.houses[s]!.length; h += 1) {
        const submission = { move: { combo: c, street: s, house: h } };
        if (checkSubmission(game, "p1", submission) === null) return submission;
      }
    }
  }
  return { move: null };
}

describe("补充1.4 目标卡", () => {
  it("18 张基础卡：每档 6 张，要求和分值与表一致（抽查几张）", () => {
    expect(PLAN_DEFS).toHaveLength(18);
    for (const tier of [0, 1, 2]) expect(PLAN_DEFS.filter((plan) => plan.tier === tier)).toHaveLength(6);
    expect(PLAN_DEFS.find((plan) => plan.id === "1-6")).toMatchObject({ need: [6, 6], high: 10, low: 6 });
    expect(PLAN_DEFS.find((plan) => plan.id === "2-2")).toMatchObject({ need: [3, 3, 4], high: 12, low: 7 });
    expect(PLAN_DEFS.find((plan) => plan.id === "3-6")).toMatchObject({ need: [1, 2, 2, 3], high: 11, low: 6 });
  });
  it("开局每档随机抽 1 张，项目面朝上", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const game = createGame([{ id: "a", name: "a" }], seed);
      expect(game.plans.map((plan) => plan.tier)).toEqual([0, 1, 2]);
      expect(game.plans.every((plan) => plan.approvedRound === null)).toBe(true);
    }
  });
  it("要求的小区可以分散在不同街；用过的小区照样计分", () => {
    // n°3-1：3 房在街 1、4 房在街 3
    const game = buildGame({
      players: [{ sheet: { streets: ["1 2 3 | _ _ _ _ _ _ _", EMPTY[1], "1 2 3 _ | _ _ _ _ _ _ _ _"] } }],
      combos: [{ num: 4, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "improve" }],
      plans: ["1-1", "2-3", "3-1"],
    });
    const after = submit(game, "p1", { move: { combo: 0, street: 2, house: 3 }, plans: [2] });
    const sheet = after.players[0]!.sheet;
    expect(sheet.plans[2]).toBe(7);
    expect(sheet.usedEstates.map((estate) => [estate.street, estate.size])).toEqual([[0, 3], [2, 4]]);
    expect(scoreSheet(sheet).estates).toBe(3 + 4);
  });
  it("一手里可以同时验证两张，各自挑不同的小区；小区不够分就拒绝", () => {
    // n°1-4（2 个 4 房）和 n°3-1（3 + 4）：需要 3 个 4 房 + 1 个 3 房
    const make = (street0: string) => buildGame({
      players: [{ sheet: { streets: [street0, "1 2 3 4 | 5 6 7 | _ _ _ _", EMPTY[2]] } }],
      combos: [{ num: 9, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "improve" }],
      plans: ["1-4", "2-3", "3-1"],
    });
    const short = make("1 2 3 4 | _ _ _ _ _ _");
    expect(checkSubmission(short, "p1", { move: { combo: 0, street: 2, house: 5 }, plans: [0, 2] })).toMatch(/还没完成/);
    expect(checkSubmission(short, "p1", { move: { combo: 0, street: 2, house: 5 }, plans: [0] })).toBeNull();
    const enough = make("1 2 3 4 | 5 6 7 8 | _ _");
    const after = submit(enough, "p1", { move: { combo: 0, street: 2, house: 5 }, plans: [0, 2] });
    expect(after.players[0]!.sheet.plans).toEqual([6, null, 7]);
    expect(after.players[0]!.sheet.usedEstates.map((estate) => estate.plan).sort()).toEqual([0, 0, 2, 2]);
  });
});

describe("补充1.5 其他澄清", () => {
  it("1. 栅栏可以画在任意一条街；已有栅栏处、相同号码之间、用过的小区里面都不能画", () => {
    const game = solo({ streets: ["1 2 2b | _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] }, { combos: [{ num: 5, action: "fence" }, { num: 9, action: "park" }, { num: 12, action: "temp" }] });
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 4, fence: { street: 2, pos: 6 } } })).toBeNull();
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 4, fence: { street: 0, pos: 2 } } })).toMatch(/栅栏/);
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 4, fence: { street: 0, pos: 1 } } })).toMatch(/栅栏/);
    const used = parseSheet({ streets: ["1 2 3 | _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]], usedEstates: [{ street: 0, start: 0, size: 3, plan: 0 }] });
    expect(canFence(used, 0, 0)).toBe(false);
    expect(canFence(used, 0, 1)).toBe(false);
  });
  it("2. bis 可以复制任意一条街；写进泳池位不建泳池；复制后要保持不递减", () => {
    const game = solo({ streets: ["_ _ _ _ _ _ _ _ _ _", "5 _ _ _ _ _ _ _ _ _ _", EMPTY[2]] }, { combos: [{ num: 9, action: "bis" }, { num: 9, action: "park" }, { num: 12, action: "temp" }] });
    // 街 2 的第 2 位（下标 1）不是泳池位；第 1 位（下标 0）是泳池位但已填。造个泳池位：街 1 下标 2
    const after = submit(game, "p1", { move: { combo: 0, street: 0, house: 5, bis: { street: 1, house: 1, from: -1 } } });
    expect(after.players[0]!.sheet.houses[1]![1]).toMatchObject({ num: 5, bis: true });
    const pool = solo({ streets: ["_ 4 _ _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] }, { combos: [{ num: 9, action: "bis" }, { num: 9, action: "park" }, { num: 12, action: "temp" }] });
    const pooled = submit(pool, "p1", { move: { combo: 0, street: 1, house: 5, bis: { street: 0, house: 2, from: -1 } } });
    expect(pooled.players[0]!.sheet.houses[0]![2]).toMatchObject({ num: 4, bis: true });
    expect(pooled.players[0]!.sheet.pools[0]![2]).toBe(false);
    expect(pooled.players[0]!.sheet.poolTrack).toBe(0);
    // 不递减：3 _ 5 里不能把 5 往左复制到 3 的右边吗？可以（3 < 5）；但 5 _ 4 不可能出现。6 _ 7 里把 6 复制到右边可以，把 7 复制到左边也可以
    const mid = parseSheet({ streets: ["6 _ 7 _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] });
    expect(canBis(mid, 0, 1, -1)).toBe(true);
    expect(canBis(mid, 0, 1, 1)).toBe(true);
    // 隔着栅栏不能复制
    const fenced = parseSheet({ streets: ["6 | _ 8 _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] });
    expect(canBis(fenced, 0, 1, -1)).toBe(false);
    expect(canBis(fenced, 0, 1, 1)).toBe(true);
  });
  it("3. 拒批判定只看 3 组的数字（加上临时工的 ±2），bis 救不了", () => {
    const game = solo({ streets: ["1 2 3 4 5 _ 6 7 8 9", "1 2 3 4 5 6 _ 7 8 9 10", "1 2 3 4 5 6 7 _ 8 9 10 11"] }, {
      combos: [{ num: 3, action: "bis" }, { num: 9, action: "bis" }, { num: 12, action: "bis" }],
    });
    expect(checkSubmission(game, "p1", { move: null })).toBeNull();
  });
  it("4. 临时工 11 格勾满后不能再改数字，但那组数字照样能用", () => {
    const game = solo({ temps: 11 }, { combos: [{ num: 8, action: "temp" }, { num: 9, action: "park" }, { num: 12, action: "fence" }] });
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 5, temp: 1 } })).toMatch(/勾满/);
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 5 } })).toBeNull();
  });
  it("5. 公园只能勾在填数字那条街；那条街公园满了就不能勾", () => {
    const game = solo({ parks: [3, 0, 0] }, { combos: [{ num: 8, action: "park" }, { num: 9, action: "park" }, { num: 12, action: "fence" }] });
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 5, park: true } })).toMatch(/建满/);
    const after = submit(game, "p1", { move: { combo: 0, street: 1, house: 5, park: true } });
    expect(after.players[0]!.sheet.parks).toEqual([3, 1, 0]);
  });
  it("泳池：泳池行动 + 写进泳池位才建；泳池行动写进普通位、或普通行动写进泳池位都不建", () => {
    const game = solo(undefined, { combos: [{ num: 8, action: "pool" }, { num: 9, action: "park" }, { num: 12, action: "fence" }] });
    const built = submit(game, "p1", { move: { combo: 0, street: 0, house: 6, pool: true } });
    expect(built.players[0]!.sheet.pools[0]![6]).toBe(true);
    expect(built.players[0]!.sheet.poolTrack).toBe(1);
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 5, pool: true } })).toMatch(/泳池/);
    expect(checkSubmission(game, "p1", { move: { combo: 1, street: 0, house: 6, pool: true } })).toMatch(/只能用这一组/);
  });
  it("7. 开工拍板：某张目标卡的首批验证者里有一人勾了重洗就重洗 81 张；不是首批的勾了没用", () => {
    const ready = { streets: ["1 2 3 | 4 5 6 _ | _ _ _", EMPTY[1], EMPTY[2]] as [string, string, string] };
    const make = () => buildGame({
      players: [{ sheet: ready }, { sheet: ready }, {}],
      combos: [{ num: 7, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "improve" }],
      plans: ["1-1", "2-3", "3-1"],
      drawLeft: 10,
    });
    const claim = { move: { combo: 0, street: 0, house: 6 }, plans: [2] };
    const before = make();
    const discardsBefore = before.stacks.reduce((sum, stack) => sum + stack.discard.length, 0);
    expect(discardsBefore).toBeGreaterThan(3);
    const after = submitAll(before, { p1: claim, p2: { ...claim, reshuffle: true }, p3: { move: { combo: 1, street: 1, house: 5 } } });
    expect(after.lastRound!.reshuffledBy).toEqual(["p2"]);
    expect(after.events.some((event) => event.type === "Reshuffled" && event.reason === "plan")).toBe(true);
    // 重洗后：每堆 27 张，翻了 1 张
    for (const stack of after.stacks) {
      expect(stack.draw.length + stack.discard.length).toBe(27);
      expect(stack.discard).toHaveLength(1);
    }
    const noOne = submitAll(make(), { p1: claim, p2: claim, p3: { move: { combo: 1, street: 1, house: 5 }, reshuffle: true } });
    expect(noOne.lastRound!.reshuffledBy).toEqual([]);
    expect(noOne.stacks.reduce((sum, stack) => sum + stack.discard.length, 0)).toBe(discardsBefore + 3);
  });
  it("8. 终局在本回合全员结算完后判；33 房按三条街合计", () => {
    const game = buildGame({
      players: [{ sheet: { streets: ["1 2 3 4 5 6 7 8 9 _", "1 2 3 4 5 6 7 8 9 10 11", "1 2 3 4 5 6 7 8 9 10 11 12"] } }],
      combos: [{ num: 14, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "improve" }],
    });
    expect(submit(game, "p1", { move: { combo: 0, street: 0, house: 9 } }).phase).toBe("gameOver");
  });
});

describe("补充：牌堆数量守恒（指定牌堆也检查）", () => {
  it("createGame 拒绝不是 81 张不重复的指定牌堆", () => {
    const deck = buildDeck();
    const bad: Card[][] = [deck.slice(0, 27), deck.slice(27, 54), deck.slice(54, 80)];
    expect(() => createGame([{ id: "a", name: "a" }], 1, { stacks: bad })).toThrow();
  });
});
