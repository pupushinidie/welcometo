/**
 * 规则书第 9 节「测试用例」TC1–TC12。数值按补充文件第一节勘误（规则书的轨道数值作废），
 * 和规则书原文不同的地方在测试名里写明。
 */
import { describe, expect, it } from "vitest";
import {
  apply,
  buildDeck,
  createRng,
  buildGame,
  canBis,
  canFence,
  canPlaceNumber,
  checkSubmission,
  compareScores,
  estateCounts,
  legalHouses,
  mustRefuse,
  parseSheet,
  rankPlayers,
  scoreAll,
  scoreSheet,
  tempMajority,
  type Submission,
} from "../src/index.js";
import { EMPTY, solo, submit, submitAll } from "./helpers.js";

describe("规则书#1 牌库构成", () => {
  it("81 张：数字分布和行动分布都对", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(81);
    const nums: Record<number, number> = {};
    const acts: Record<string, number> = {};
    for (const card of deck) {
      nums[card.num] = (nums[card.num] ?? 0) + 1;
      acts[card.action] = (acts[card.action] ?? 0) + 1;
    }
    expect(nums).toEqual({ 1: 3, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 8, 10: 7, 11: 6, 12: 5, 13: 4, 14: 3, 15: 3 });
    expect(acts).toEqual({ fence: 18, improve: 18, park: 18, pool: 9, temp: 9, bis: 9 });
    expect(new Set(deck.map((card) => card.id)).size).toBe(81);
  });
});

describe("规则书#2 数字递增与跳号", () => {
  const sheet = parseSheet({ streets: ["_ _ 5 _ _ 7 _ _ _ _", EMPTY[1], EMPTY[2]] });
  it("6 能填在 5 和 7 之间的两个空位（规则书写「第 4 或第 6 位」，第 6 位是 7 本身，应为第 4、5 位）", () => {
    expect(legalHouses(sheet, 6).filter((spot) => spot.street === 0).map((spot) => spot.house)).toEqual([3, 4]);
  });
  it("8 能填在 7 后面任意空位", () => {
    expect(legalHouses(sheet, 8).filter((spot) => spot.street === 0).map((spot) => spot.house)).toEqual([6, 7, 8, 9]);
  });
  it("5 在这条街哪里都填不了（重复）；4 填在 5 右边被拒，填在 5 左边可以", () => {
    expect(legalHouses(sheet, 5).filter((spot) => spot.street === 0)).toEqual([]);
    expect(canPlaceNumber(sheet, 0, 3, 4)).toBe(false);
    expect(canPlaceNumber(sheet, 0, 1, 4)).toBe(true);
  });
  it("服务端拒绝不递增的一手", () => {
    const game = solo({ streets: ["_ _ 5 _ _ 7 _ _ _ _", EMPTY[1], EMPTY[2]] }, { combos: [{ num: 4, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "pool" }] });
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 3 } })).toMatch(/越来越大/);
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 1 } })).toBeNull();
  });
});

const STUCK: readonly [string, string, string] = ["1 2 3 4 5 _ 6 7 8 9", "1 2 3 4 5 6 _ 7 8 9 10", "1 2 3 4 5 6 7 _ 8 9 10 11"];

describe("规则书#3 无合法位置 → 拒批", () => {
  const combos = [{ num: 3, action: "fence" as const }, { num: 14, action: "park" as const }, { num: 9, action: "bis" as const }];
  it("3 组都填不进去：必须拒批，勾第 1 格（罚 0），不能用行动，但能验证目标卡", () => {
    const game = solo({ streets: STUCK }, { combos });
    expect(mustRefuse(game.players[0]!.sheet, combos)).toBe(true);
    expect(checkSubmission(game, "p1", { move: { combo: 1, street: 0, house: 5 } })).not.toBeNull();
    const after = submit(game, "p1", { move: null });
    const sheet = after.players[0]!.sheet;
    expect(sheet.refusals).toBe(1);
    expect(scoreSheet(sheet).refusals).toBe(0);
    expect(after.lastRound!.plays.p1!.number).toBeNull();
  });
  it("拒批的回合也能验证目标卡", () => {
    // 第 1 条街填满：6 个 1 房小区 + 1 个 4 房；另两条街卡死。目标卡 n°1-1（6 个 1 房，8/4）
    const game = buildGame({
      players: [{ sheet: { streets: ["1 | 2 | 3 | 4 | 5 | 6 | 7 8 9 10", STUCK[1], STUCK[2]] } }],
      combos: [{ num: 3, action: "fence" }, { num: 14, action: "park" }, { num: 9, action: "bis" }],
      plans: ["1-1", "2-3", "3-1"],
    });
    expect(estateCounts(game.players[0]!.sheet)[0]).toBe(6);
    const after = submit(game, "p1", { move: null, plans: [0] });
    expect(after.players[0]!.sheet.refusals).toBe(1);
    expect(after.players[0]!.sheet.plans[0]).toBe(8);
  });
  it("有合法位置却自愿拒批 → 拒绝", () => {
    const game = solo({ streets: EMPTY }, { combos });
    expect(checkSubmission(game, "p1", { move: null })).toMatch(/不能拒批/);
  });
  it("临时工能救：数字加减 2 后有处可填就不能拒批", () => {
    const sheet = { streets: ["1 2 3 4 5 6 7 8 9 _", STUCK[1], STUCK[2]] as const };
    const temp = solo({ streets: [...sheet.streets] as [string, string, string] }, { combos: [{ num: 8, action: "temp" }, { num: 3, action: "fence" }, { num: 2, action: "park" }] });
    expect(checkSubmission(temp, "p1", { move: null })).toMatch(/不能拒批/);
    expect(checkSubmission(temp, "p1", { move: { combo: 0, street: 0, house: 9, temp: 2 } })).toBeNull();
    const noTemp = solo({ streets: [...sheet.streets] as [string, string, string] }, { combos: [{ num: 8, action: "fence" }, { num: 3, action: "fence" }, { num: 2, action: "park" }] });
    expect(checkSubmission(noTemp, "p1", { move: null })).toBeNull();
  });
});

describe("规则书#4 临时工", () => {
  const game = (num: number) => solo({ streets: EMPTY }, { combos: [{ num, action: "temp" }, { num: 3, action: "fence" }, { num: 2, action: "park" }] });
  it("8 带临时工可写 6/7/8/9/10", () => {
    for (const temp of [-2, -1, 0, 1, 2]) {
      const after = submit(game(8), "p1", { move: { combo: 0, street: 0, house: 5, temp } });
      expect(after.players[0]!.sheet.houses[0]![5]!.num).toBe(8 + temp);
    }
    expect(checkSubmission(game(8), "p1", { move: { combo: 0, street: 0, house: 5, temp: 3 } })).not.toBeNull();
  });
  it("15 最多到 17；1 最多到 0，不能到 -1", () => {
    expect(submit(game(15), "p1", { move: { combo: 0, street: 0, house: 9, temp: 2 } }).players[0]!.sheet.houses[0]![9]!.num).toBe(17);
    expect(submit(game(1), "p1", { move: { combo: 0, street: 0, house: 0, temp: -1 } }).players[0]!.sheet.houses[0]![0]!.num).toBe(0);
    expect(checkSubmission(game(1), "p1", { move: { combo: 0, street: 0, house: 0, temp: -2 } })).toMatch(/0–17/);
  });
  it("±0 也要勾一格；不用临时工就不勾", () => {
    expect(submit(game(8), "p1", { move: { combo: 0, street: 0, house: 5, temp: 0 } }).players[0]!.sheet.temps).toBe(1);
    expect(submit(game(8), "p1", { move: { combo: 0, street: 0, house: 5 } }).players[0]!.sheet.temps).toBe(0);
  });
});

describe("规则书#5 bis", () => {
  it("5 右邻空 → 5B；再对 5B bis → 5B 5B；它们之间都不能画栅栏", () => {
    const game = solo({ streets: ["_ _ 5 _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] }, { combos: [{ num: 9, action: "bis" }, { num: 3, action: "fence" }, { num: 2, action: "park" }] });
    let after = submit(game, "p1", { move: { combo: 0, street: 0, house: 8, bis: { street: 0, house: 3, from: -1 } } });
    let sheet = after.players[0]!.sheet;
    expect(sheet.houses[0]![3]).toMatchObject({ num: 5, bis: true });
    expect(sheet.bis).toBe(1);
    after = submit(buildGame({ players: [{ sheet }], combos: [{ num: 11, action: "bis" }, { num: 3, action: "fence" }, { num: 2, action: "park" }] }), "p1", {
      move: { combo: 0, street: 0, house: 9, bis: { street: 0, house: 4, from: -1 } },
    });
    sheet = after.players[0]!.sheet;
    expect(sheet.houses[0]![4]).toMatchObject({ num: 5, bis: true });
    expect(sheet.bis).toBe(2);
    expect(canFence(sheet, 0, 2)).toBe(false);
    expect(canFence(sheet, 0, 3)).toBe(false);
    expect(canFence(sheet, 0, 4)).toBe(true);
  });
  it("连续 bis：4 – 5B – 5 – 5B – 5B 合法", () => {
    const sheet = parseSheet({ streets: ["4 _ 5 5b _ _ _ _ _ _", EMPTY[1], EMPTY[2]] });
    expect(canBis(sheet, 0, 1, 1)).toBe(true);
    expect(canBis(sheet, 0, 4, -1)).toBe(true);
  });
});

describe("规则书#6 小区计分（按补充文件尺寸列：3 房 [3,4,5,6]）", () => {
  it("2 个 3 房小区、3 房列勾 1 格 → 单价 4（规则书写 5 是旧表）→ 8 分", () => {
    const sheet = parseSheet({ streets: ["1 2 3 | 4 5 6 | _ _ _ _", EMPTY[1], EMPTY[2]], improve: [0, 0, 1] });
    const score = scoreSheet(sheet);
    expect(score.estateCounts).toEqual([0, 0, 2, 0, 0, 0]);
    expect(score.estateValues[2]).toBe(4);
    expect(score.estates).toBe(8);
  });
  it("7 座连串不计分；中间有空房的一串不算完成", () => {
    const seven = parseSheet({ streets: ["1 2 3 4 5 6 7 | _ _ _", EMPTY[1], EMPTY[2]] });
    expect(scoreSheet(seven).estates).toBe(0);
    const gap = parseSheet({ streets: ["1 _ 3 | _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] });
    expect(scoreSheet(gap).estates).toBe(0);
  });
});

describe("规则书#7 公园 / 泳池计分（按补充文件轨道）", () => {
  it("公园轨三条街各勾 2/1/0 → 4 + 2 + 0 = 6（规则书写「共 10」是笔误）", () => {
    expect(scoreSheet(parseSheet({ parks: [2, 1, 0] })).parks).toBe(6);
  });
  it("建满的大奖：街 1 勾 3 格 10、街 2 勾 4 格 14、街 3 勾 5 格 18", () => {
    expect(scoreSheet(parseSheet({ parks: [3, 4, 5] })).parks).toBe(42);
  });
  it("泳池轨勾 2 格 → 6", () => {
    expect(scoreSheet(parseSheet({ poolTrack: 2 })).pools).toBe(6);
  });
});

describe("规则书#8 市规划抢首验", () => {
  // 目标卡 n°3-1：1 个 3 房 + 1 个 4 房，高 7 / 低 3
  const ready = { streets: ["1 2 3 | 4 5 6 _ | _ _ _", EMPTY[1], EMPTY[2]] as [string, string, string] };
  const make = () => buildGame({
    players: [{ sheet: ready }, { sheet: ready }, { sheet: { streets: ["1 2 3 | 4 5 6 _ | _ _ _", EMPTY[1], EMPTY[2]] } }],
    combos: [{ num: 7, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "improve" }],
    plans: ["1-1", "2-3", "3-1"],
  });
  const claim: Submission = { move: { combo: 0, street: 0, house: 6 }, plans: [2] };
  it("甲、乙同一回合都完成 → 都记高分 7，卡翻面；丙下一回合才完成 → 记低分 3", () => {
    let game = submitAll(make(), { p1: claim, p2: claim, p3: { move: { combo: 1, street: 1, house: 5 } } });
    expect(game.players[0]!.sheet.plans[2]).toBe(7);
    expect(game.players[1]!.sheet.plans[2]).toBe(7);
    expect(game.plans[2]!.approvedRound).toBe(1);
    expect(game.lastRound!.approved).toEqual([2]);
    // 丙下一回合：把 7 放进他的空位（造一组 7）
    game = { ...game, combos: [{ num: 7, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "improve" }] };
    game = submitAll(game, { p1: { move: { combo: 1, street: 2, house: 6 } }, p2: { move: { combo: 1, street: 2, house: 6 } }, p3: claim });
    expect(game.players[2]!.sheet.plans[2]).toBe(3);
  });
  it("甲用小区验证过后：再往这个小区里画栅栏、再拿它验证别的卡 → 拒绝", () => {
    const game = submitAll(make(), { p1: claim, p2: claim, p3: { move: { combo: 1, street: 1, house: 5 } } });
    const sheet = game.players[0]!.sheet;
    expect(sheet.usedEstates).toHaveLength(2);
    expect(canFence(sheet, 0, 0)).toBe(false);
    expect(canFence(sheet, 0, 4)).toBe(false);
    expect(canFence(sheet, 0, 7)).toBe(true);
    // 同一个小区不能再给 n°2-3（4 + 5）用：只有一个 4 房，已经用掉
    const next = buildGame({ players: [{ sheet: { ...parseSheet(), ...sheet } }], combos: [{ num: 13, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "improve" }], plans: ["1-1", "2-3", "3-1"] });
    expect(checkSubmission(next, "p1", { move: { combo: 0, street: 2, house: 11 }, plans: [1] })).toMatch(/还没完成/);
  });
});

describe("规则书#9 终局条件", () => {
  const combos = [{ num: 3, action: "fence" as const }, { num: 14, action: "park" as const }, { num: 9, action: "bis" as const }];
  it("① 勾第 3 格拒批 → 本回合结算后结束，罚 5", () => {
    const game = buildGame({ players: [{ sheet: { streets: STUCK, refusals: 2 } }, {}], combos });
    const after = submitAll(game, { p1: { move: null }, p2: { move: { combo: 1, street: 0, house: 9 } } });
    expect(after.phase).toBe("gameOver");
    expect(after.finalResult!.reasons).toEqual(["refusals"]);
    expect(after.finalResult!.scores.p1!.refusals).toBe(5);
    // 别人这回合照样结算了
    expect(after.players[1]!.sheet.houses[0]![9]!.num).toBe(14);
  });
  it("② 验证满 3 张目标卡 → 结束", () => {
    const game = buildGame({
      players: [{ sheet: { streets: ["1 2 3 | 4 5 6 _ | _ _ _", EMPTY[1], EMPTY[2]], plans: [8, 9, null] } }, {}],
      combos: [{ num: 7, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "improve" }],
      plans: ["1-1", "2-3", "3-1"],
    });
    const after = submitAll(game, { p1: { move: { combo: 0, street: 0, house: 6 }, plans: [2] }, p2: { move: { combo: 1, street: 1, house: 5 } } });
    expect(after.phase).toBe("gameOver");
    expect(after.finalResult!.reasons).toEqual(["plans"]);
  });
  it("③ 填满 33 房 → 结束", () => {
    const game = buildGame({
      players: [{ sheet: { streets: ["1 2 3 4 5 6 7 8 9 _", "1 2 3 4 5 6 7 8 9 10 11", "1 2 3 4 5 6 7 8 9 10 11 12"] } }, {}],
      combos: [{ num: 14, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "improve" }],
    });
    const after = submitAll(game, { p1: { move: { combo: 0, street: 0, house: 9 } }, p2: { move: { combo: 1, street: 1, house: 5 } } });
    expect(after.phase).toBe("gameOver");
    expect(after.finalResult!.reasons).toEqual(["full"]);
  });
  it("没满足任何条件就翻下一回合", () => {
    const game = buildGame({ players: 2, combos });
    const after = submitAll(game, { p1: { move: { combo: 0, street: 0, house: 1 } }, p2: { move: { combo: 0, street: 0, house: 1 } } });
    expect(after.phase).toBe("play");
    expect(after.round).toBe(2);
    expect(after.combos).toHaveLength(3);
  });
});

describe("规则书#10 临时工多数", () => {
  it("甲 5 / 乙 5 / 丙 1 / 丁 0 → 7 / 7 / 4 / 0", () => {
    expect(tempMajority({ a: 5, b: 5, c: 1, d: 0 })).toEqual({ a: 7, b: 7, c: 4, d: 0 });
  });
  it("第三档：3 / 2 / 1 / 1 → 7 / 4 / 1 / 1；第四档没分", () => {
    expect(tempMajority({ a: 3, b: 2, c: 1, d: 1 })).toEqual({ a: 7, b: 4, c: 1, d: 1 });
    expect(tempMajority({ a: 4, b: 3, c: 2, d: 1 })).toEqual({ a: 7, b: 4, c: 1, d: 0 });
  });
  it("scoreAll 把多数分算进总分", () => {
    const game = buildGame({ players: [{ sheet: { temps: 5 } }, { sheet: { temps: 5 } }, { sheet: { temps: 1 } }, {}] });
    const scores = scoreAll(game);
    expect([scores.p1!.temps, scores.p2!.temps, scores.p3!.temps, scores.p4!.temps]).toEqual([7, 7, 4, 0]);
    expect(scores.p1!.total).toBe(7);
  });
});

describe("规则书#11 平分 tiebreak", () => {
  it("总分平 → 完成小区多者胜", () => {
    // 甲：两个 1 房（2 分）；乙：一个 2 房（2 分）
    const a = scoreSheet(parseSheet({ streets: ["1 | 2 | _ _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] }));
    const b = scoreSheet(parseSheet({ streets: ["1 2 | _ _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] }));
    expect(a.total).toBe(b.total);
    expect(compareScores(a, b)).toBeGreaterThan(0);
  });
  it("小区数也平 → 比 1 房小区数", () => {
    // 甲：1 房 + 3 房（1 + 3 = 4）；乙：2 房 + 2 房（4）
    const a = scoreSheet(parseSheet({ streets: ["1 | 2 3 4 | _ _ _ _ _ _", EMPTY[1], EMPTY[2]] }));
    const b = scoreSheet(parseSheet({ streets: ["1 2 | 3 4 | _ _ _ _ _ _", EMPTY[1], EMPTY[2]] }));
    expect(a.total).toBe(b.total);
    expect(compareScores(a, b)).toBeGreaterThan(0);
  });
  it("全平 → 并列获胜，名次相同", () => {
    const sheet = { streets: ["1 2 | _ _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] as [string, string, string] };
    const game = buildGame({ players: [{ sheet }, { sheet }, {}] });
    const ranks = rankPlayers(scoreAll(game));
    expect(ranks).toEqual({ p1: 1, p2: 1, p3: 3 });
  });
});

describe("规则书#12 命令校验", () => {
  const make = () => buildGame({ players: 2, combos: [{ num: 5, action: "fence" }, { num: 9, action: "park" }, { num: 12, action: "temp" }] });
  it("没交齐之前可以改交（覆盖上一手），也可以撤回", () => {
    let game = submit(make(), "p1", { move: { combo: 0, street: 0, house: 2 } });
    game = submit(game, "p1", { move: { combo: 1, street: 1, house: 5 } });
    expect(game.players[0]!.pending!.move!.combo).toBe(1);
    expect(game.round).toBe(1);
    const retracted = apply(game, "p1", { type: "retract" }, createRng(1)).state;
    expect(retracted.players[0]!.submitted).toBe(false);
  });
  it("数字不递增 / 非 bis 重复 / 行动不属于所选组 / 拒批时带行动 → 全部拒绝", () => {
    const game = buildGame({
      players: [{ sheet: { streets: ["_ 5 _ _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] } }, {}],
      combos: [{ num: 5, action: "fence" }, { num: 3, action: "park" }, { num: 12, action: "temp" }],
    });
    expect(checkSubmission(game, "p1", { move: { combo: 1, street: 0, house: 3 } })).not.toBeNull(); // 3 在 5 右边
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 4 } })).not.toBeNull(); // 5 重复
    expect(checkSubmission(game, "p1", { move: { combo: 1, street: 1, house: 2, fence: { street: 1, pos: 4 } } })).toMatch(/只能用这一组的行动/);
    expect(checkSubmission(game, "p1", { move: { combo: 1, street: 1, house: 2, park: true } })).toBeNull();
    expect(checkSubmission(game, "p1", { move: null })).toMatch(/不能拒批/);
  });
});

