/**
 * 规则书逐节的场景测试：精确局面 → 精确结果。测试名带规则书章节号。
 */
import { describe, expect, it } from "vitest";
import {
  apply,
  buildGame,
  checkSubmission,
  createGame,
  createRng,
  fallbackSubmission,
  parseSheet,
  scoreAll,
  scoreSheet,
  stepKey,
  timeoutTurn,
  waitingFor,
  type GameState,
  type Submission,
} from "../src/index.js";
import { EMPTY, solo, submit, submitAll } from "./helpers.js";

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` }));

describe("§1 目标：总分最高者获胜", () => {
  it("终局时 winners 是总分最高的人", () => {
    const game = buildGame({
      players: [{ sheet: { streets: ["1 2 3 4 5 6 7 8 9 _", "1 2 3 4 5 6 7 8 9 10 11", "1 2 3 4 5 6 7 8 9 10 11 12"], parks: [3, 0, 0] } }, { sheet: { parks: [1, 0, 0] } }],
      combos: [{ num: 14, action: "park" }, { num: 9, action: "fence" }, { num: 12, action: "improve" }],
    });
    const after = submitAll(game, { p1: { move: { combo: 0, street: 0, house: 9 } }, p2: { move: { combo: 1, street: 1, house: 5 } } });
    expect(after.finalResult!.winners).toEqual(["p1"]);
    expect(after.finalResult!.scores.p1!.parks).toBe(10);
    expect(after.finalResult!.ranks).toEqual({ p1: 1, p2: 2 });
  });
});

describe("§3 开局", () => {
  it("81 张分 3 堆各 27，第 1 回合已翻：每堆翻了 1 张、剩 26；3 张目标卡各档一张；表都是空的", () => {
    const game = createGame(players(3), 42);
    expect(game.round).toBe(1);
    expect(game.phase).toBe("play");
    expect(game.combos).toHaveLength(3);
    for (const stack of game.stacks) {
      expect(stack.draw).toHaveLength(26);
      expect(stack.discard).toHaveLength(1);
    }
    expect(game.plans.map((plan) => plan.tier)).toEqual([0, 1, 2]);
    for (const player of game.players) {
      expect(player.sheet.houses.flat().every((house) => house === null)).toBe(true);
      expect(player.submitted).toBe(false);
    }
  });
  it("1–6 人都能开，7 人不行", () => {
    for (let n = 1; n <= 6; n += 1) expect(createGame(players(n), n).players).toHaveLength(n);
    expect(() => createGame(players(7), 1)).toThrow(/1–6/);
  });
  it("同一种子开出同一局", () => {
    expect(createGame(players(2), "ab".repeat(16)).combos).toEqual(createGame(players(2), "ab".repeat(16)).combos);
  });
});

describe("§4 回合流程：全员同时", () => {
  const make = () => buildGame({ players: 3, combos: [{ num: 5, action: "fence" }, { num: 9, action: "park" }, { num: 12, action: "temp" }] });
  const s1: Submission = { move: { combo: 0, street: 0, house: 2 } };
  it("交了不立刻结算，等全员交齐；别人还能选同一组", () => {
    let game = submit(make(), "p1", s1);
    expect(game.round).toBe(1);
    expect(waitingFor(game)).toEqual(["p2", "p3"]);
    game = submit(game, "p2", s1);
    game = submit(game, "p3", s1);
    expect(game.round).toBe(2);
    for (const player of game.players) expect(player.sheet.houses[0]![2]!.num).toBe(5);
  });
  it("结算结果和交的先后无关", () => {
    const subs: Record<string, Submission> = {
      p1: { move: { combo: 0, street: 0, house: 2, fence: { street: 0, pos: 2 } } },
      p2: { move: { combo: 1, street: 1, house: 6, park: true } },
      p3: { move: { combo: 2, street: 2, house: 9, temp: 2 } },
    };
    const a = submitAll(make(), subs);
    const b = submitAll(make(), { p3: subs.p3!, p1: subs.p1!, p2: subs.p2! });
    expect(a.players.map((p) => p.sheet)).toEqual(b.players.map((p) => p.sheet));
  });
  it("step 对不上（迟到的点击）被拒；撤回后要重交；对局结束后不收动作", () => {
    const game = make();
    expect(() => apply(game, "p1", { type: "submit", submission: s1, step: "r9" }, createRng(1))).toThrow(/已经结算/);
    expect(apply(game, "p1", { type: "submit", submission: s1, step: stepKey(game) }, createRng(1)).state.players[0]!.submitted).toBe(true);
    expect(() => apply(game, "p1", { type: "retract" }, createRng(1))).toThrow(/还没交/);
    const over = { ...game, phase: "gameOver" as const };
    expect(() => apply(over, "p1", { type: "submit", submission: s1 }, createRng(1))).toThrow(/结束/);
  });
  it("apply 不改输入；version 每步 +1", () => {
    const game = make();
    const before = JSON.stringify(game);
    const next = submit(game, "p1", s1);
    expect(JSON.stringify(game)).toBe(before);
    expect(next.version).toBe(game.version + 1);
    const resolved = submitAll(game, { p1: s1, p2: s1, p3: s1 });
    expect(JSON.stringify(game)).toBe(before);
    expect(resolved.version).toBe(game.version + 3);
  });
  it("lastRound 记下每人做了什么（结算后公开）", () => {
    const game = submitAll(make(), { p1: s1, p2: { move: { combo: 2, street: 2, house: 9, temp: -2 } }, p3: s1 });
    expect(game.lastRound!.round).toBe(1);
    expect(game.lastRound!.plays.p2!.number).toBe(10);
    expect(game.lastRound!.combos[0]).toEqual({ num: 5, action: "fence" });
  });
});

describe("§4.3 每种行动", () => {
  const combos = [
    { num: 6, action: "fence" as const },
    { num: 6, action: "improve" as const },
    { num: 6, action: "park" as const },
  ];
  it("行动是可选的：选了栅栏组也可以不画", () => {
    const game = solo(undefined, { combos });
    const after = submit(game, "p1", { move: { combo: 0, street: 0, house: 3 } });
    expect(after.players[0]!.sheet.fences.flat().some(Boolean)).toBe(false);
  });
  it("栅栏：画完立刻围出完成小区（两端固定有栅栏）", () => {
    const game = solo({ streets: ["1 3 4 _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] }, { combos });
    const after = submit(game, "p1", { move: { combo: 0, street: 0, house: 3, fence: { street: 0, pos: 3 } } });
    expect(scoreSheet(after.players[0]!.sheet).estateCounts).toEqual([0, 0, 0, 1, 0, 0]);
  });
  it("栅栏能把没用过的小区拆小", () => {
    const sheet = parseSheet({ streets: ["1 2 3 4 | _ _ _ _ _ _", EMPTY[1], EMPTY[2]] });
    const game = buildGame({ players: [{ sheet }], combos });
    const after = submit(game, "p1", { move: { combo: 0, street: 1, house: 3, fence: { street: 0, pos: 1 } } });
    expect(scoreSheet(after.players[0]!.sheet).estateCounts).toEqual([0, 2, 0, 0, 0, 0]);
  });
  it("改造：勾一格，该尺寸单价涨一档", () => {
    const game = solo({ streets: ["1 2 3 | _ _ _ _ _ _ _", EMPTY[1], EMPTY[2]] }, { combos });
    const after = submit(game, "p1", { move: { combo: 1, street: 1, house: 3, improve: 3 } });
    expect(after.players[0]!.sheet.improve).toEqual([0, 0, 1, 0, 0, 0]);
    expect(scoreSheet(after.players[0]!.sheet).estates).toBe(4);
  });
  it("公园：勾在填数字那条街", () => {
    const game = solo(undefined, { combos });
    const after = submit(game, "p1", { move: { combo: 2, street: 2, house: 3, park: true } });
    expect(after.players[0]!.sheet.parks).toEqual([0, 0, 1]);
  });
  it("一手只能带这组的行动；带两个行动被拒", () => {
    const game = solo(undefined, { combos });
    expect(checkSubmission(game, "p1", { move: { combo: 2, street: 2, house: 3, park: true, improve: 2 } })).toMatch(/只能用这一组/);
  });
});

describe("§4.4 验证市规划", () => {
  const ready = { streets: ["1 2 3 | 4 5 6 7 | _ _ _", EMPTY[1], EMPTY[2]] as [string, string, string] };
  const combos = [{ num: 9, action: "park" as const }, { num: 10, action: "fence" as const }, { num: 12, action: "improve" as const }];
  it("可以推迟：这回合不验证，下回合还没人验证过就照样拿高分", () => {
    let game = buildGame({ players: [{ sheet: ready }, {}], combos, plans: ["1-1", "2-3", "3-1"] });
    game = submitAll(game, { p1: { move: { combo: 0, street: 1, house: 5 } }, p2: { move: { combo: 0, street: 1, house: 5 } } });
    expect(game.players[0]!.sheet.plans[2]).toBeNull();
    game = submitAll(game, { p1: { ...fallbackSubmission(game, "p1"), plans: [2] }, p2: fallbackSubmission(game, "p2") });
    expect(game.players[0]!.sheet.plans[2]).toBe(7);
  });
  it("推迟期间别人先验证了，就只能拿低分", () => {
    let game = buildGame({ players: [{ sheet: ready }, { sheet: ready }], combos, plans: ["1-1", "2-3", "3-1"] });
    game = submitAll(game, { p1: { move: { combo: 0, street: 1, house: 5 } }, p2: { move: { combo: 0, street: 1, house: 5 }, plans: [2] } });
    expect(game.players[1]!.sheet.plans[2]).toBe(7);
    game = submitAll(game, { p1: { ...fallbackSubmission(game, "p1"), plans: [2] }, p2: fallbackSubmission(game, "p2") });
    expect(game.players[0]!.sheet.plans[2]).toBe(3);
  });
  it("每张卡每人只能验证一次；没完成不能验证", () => {
    const game = buildGame({ players: [{ sheet: { ...ready, plans: [null, null, 7] } }], combos, plans: ["1-1", "2-3", "3-1"] });
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 1, house: 5 }, plans: [2] })).toMatch(/验证过/);
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 1, house: 5 }, plans: [0] })).toMatch(/还没完成/);
  });
  it("首批验证的事件和翻面", () => {
    const game = buildGame({ players: [{ sheet: ready }, {}], combos, plans: ["1-1", "2-3", "3-1"] });
    const after = submitAll(game, { p1: { move: { combo: 0, street: 1, house: 5 }, plans: [2] }, p2: { move: { combo: 0, street: 1, house: 5 } } });
    expect(after.events.find((event) => event.type === "PlanApproved")).toMatchObject({ plan: 2, players: ["p1"] });
    expect(after.plans[2]!.approvedRound).toBe(1);
  });
});

describe("§5 计分：一张表逐项", () => {
  it("目标卡 + 公园 + 泳池 + 临时工 + 小区 − bis − 拒批", () => {
    const sheet = parseSheet({
      streets: ["1 2 | 3p 4 5 | _ _ _ _ _", "0p 1 2 3 | _ _ _ _ _ _ _", "1 1b | _ _ _ _ _ _ _ _ _ _"],
      parks: [1, 2, 0],
      improve: [0, 1, 0, 1, 0, 0],
      temps: 2,
      bis: 1,
      refusals: 2,
      plans: [8, null, 3],
    });
    const score = scoreSheet(sheet, 4);
    expect(score.plans).toBe(11);
    expect(score.parks).toBe(2 + 4);
    expect(score.pools).toBe(6); // 2 个泳池
    expect(score.estateCounts).toEqual([0, 2, 1, 1, 0, 0]);
    expect(score.estateValues).toEqual([1, 3, 3, 5, 5, 6]);
    expect(score.estates).toBe(2 * 3 + 3 + 5);
    expect(score.bis).toBe(1);
    expect(score.refusals).toBe(3);
    expect(score.total).toBe(11 + 6 + 6 + 4 + 14 - 1 - 3);
  });
});

describe("§6 结束与胜负", () => {
  it("几个结束条件同时满足时都列出来", () => {
    const game = buildGame({
      players: [
        { sheet: { streets: ["1 2 3 4 5 6 7 8 9 _", "1 2 3 4 5 6 7 8 9 10 11", "1 2 3 4 5 6 7 8 9 10 11 12"] } },
        { sheet: { streets: ["1 2 3 4 5 _ 6 7 8 9", "1 2 3 4 5 6 _ 7 8 9 10", "1 2 3 4 5 6 7 _ 8 9 10 11"], refusals: 2 } },
      ],
      combos: [{ num: 14, action: "park" }, { num: 15, action: "fence" }, { num: 13, action: "improve" }],
    });
    const after = submitAll(game, { p1: { move: { combo: 0, street: 0, house: 9 } }, p2: { move: null } });
    expect(after.finalResult!.reasons).toEqual(["refusals", "full"]);
  });
  it("终局后不再翻牌，combos 清空", () => {
    const game = buildGame({ players: [{ sheet: { streets: ["1 2 3 4 5 _ 6 7 8 9", "1 2 3 4 5 6 _ 7 8 9 10", "1 2 3 4 5 6 7 _ 8 9 10 11"], refusals: 2 } }], combos: [{ num: 14, action: "park" }, { num: 15, action: "fence" }, { num: 13, action: "improve" }] });
    const after = submit(game, "p1", { move: null });
    expect(after.phase).toBe("gameOver");
    expect(after.combos).toEqual([]);
    expect(waitingFor(after)).toEqual([]);
  });
});

describe("§7 人数差异：规则不随人数变", () => {
  it("1 人局：临时工多数自己拿 7（有勾的话）", () => {
    const game = buildGame({ players: [{ sheet: { temps: 1 } }] });
    expect(scoreAll(game).p1!.temps).toBe(7);
  });
  it("6 人局能打一回合", () => {
    const game = createGame(players(6), 9);
    let current: GameState = game;
    for (const player of game.players) current = submit(current, player.id, fallbackSubmission(current, player.id));
    expect(current.round).toBe(2);
  });
});

describe("§8.4 超时代做", () => {
  const make = () => buildGame({ players: 3, combos: [{ num: 5, action: "fence" }, { num: 9, action: "park" }, { num: 12, action: "temp" }] });
  it("到点：没交的人由系统代做（策略给的一手），交了的不动；整回合结算", () => {
    const mine: Submission = { move: { combo: 1, street: 1, house: 5, park: true } };
    let game = submit(make(), "p1", mine);
    game = timeoutTurn(game, (_view, id) => ({ move: { combo: 0, street: 0, house: id === "p2" ? 1 : 2 } }));
    expect(game.round).toBe(2);
    expect(game.events[0]).toEqual({ type: "TimedOut", players: ["p2", "p3"] });
    expect(game.lastRound!.plays.p1!.auto).toBeUndefined();
    expect(game.lastRound!.plays.p2!.auto).toBe(true);
    expect(game.players[1]!.sheet.houses[0]![1]!.num).toBe(5);
    expect(game.players[0]!.sheet.parks[1]).toBe(1);
  });
  it("策略给了不合法的一手、或者抛错：退回兜底的一手，不卡住", () => {
    let game = timeoutTurn(make(), () => ({ move: { combo: 0, street: 0, house: 99 } }));
    expect(game.round).toBe(2);
    game = timeoutTurn(make(), () => {
      throw new Error("坏了");
    });
    expect(game.round).toBe(2);
  });
  it("必须拒批的人超时就自动拒批", () => {
    const game = buildGame({ players: [{ sheet: { streets: ["1 2 3 4 5 _ 6 7 8 9", "1 2 3 4 5 6 _ 7 8 9 10", "1 2 3 4 5 6 7 _ 8 9 10 11"] } }, {}], combos: [{ num: 14, action: "park" }, { num: 15, action: "fence" }, { num: 13, action: "improve" }] });
    const after = timeoutTurn(game);
    expect(after.players[0]!.sheet.refusals).toBe(1);
  });
});
