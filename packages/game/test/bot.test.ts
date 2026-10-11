/**
 * 人机：只吃 redact 之后的状态、关键决策、理由、自对弈不卡死、耗时。
 * 每种人数 300 局的自对弈和对基线的胜率用 scripts/sim-welcometo.ts 跑（太慢不放进 npm test），这里每种人数 40 局。
 */
import { describe, expect, it } from "vitest";
import {
  apply,
  botCommand,
  botHint,
  buildGame,
  checkSubmission,
  createGame,
  createRng,
  createScene,
  redactGameForViewer,
  SCENE_NAMES,
  stateProblems,
  waitingFor,
  type GameState,
} from "../src/index.js";

const view = (game: GameState, id = "p1") => redactGameForViewer(game, id);

describe("人机只用自己看得到的信息", () => {
  it("在 redact 之后的状态上能决策；牌堆顺序、别人交的内容怎么变，决策都一样", () => {
    const game = createScene("submitted");
    const id = game.players.find((player) => !player.submitted)!.id;
    const decision = botCommand(view(game, id), id);
    expect(decision).not.toBeNull();
    expect(checkSubmission(game, id, decision!)).toBeNull();
    // 改动隐藏信息：牌堆打乱、别人交的内容换掉
    const tampered: GameState = {
      ...game,
      stacks: game.stacks.map((stack) => ({ ...stack, draw: [...stack.draw].reverse() })),
      players: game.players.map((player) => (player.id === id ? player : { ...player, pending: { move: null } })),
    };
    expect(botCommand(view(tampered, id), id)).toEqual(decision);
  });
  it("给 redact 之后的状态（牌堆为空）不会出错", () => {
    const game = createGame([{ id: "p1", name: "a" }, { id: "p2", name: "b" }], 3);
    const v = view(game);
    expect(v.stacks.every((stack) => stack.draw.length === 0)).toBe(true);
    expect(botCommand(v, "p1")).not.toBeNull();
  });
  it("已经交了就不再交", () => {
    const game = createScene("submitted");
    expect(botCommand(view(game), "p1")).toBeNull();
  });
});

describe("人机的关键决策", () => {
  it("3 组都填不进去：拒批", () => {
    const game = createScene("refuse");
    expect(botCommand(view(game), "p1")!.move).toBeNull();
  });
  it("能建泳池就建（6 写进第 1 条街第 7 格的泳池位）", () => {
    const game = createScene("pool");
    const submission = botCommand(view(game), "p1")!;
    expect(submission.move).toMatchObject({ combo: 0, pool: true });
  });
  it("这一手能完成目标卡就完成并验证", () => {
    const game = createScene("plan");
    const submission = botCommand(view(game), "p1")!;
    expect(submission.plans).toContain(2);
    expect(checkSubmission(game, "p1", submission)).toBeNull();
  });
  it("栅栏能立刻围出完成小区就围（1 3 4 + 6 → 4 房小区）", () => {
    const game = createScene("fence");
    const submission = botCommand(view(game), "p1")!;
    expect(submission.move).toMatchObject({ combo: 0, street: 0, house: 3, fence: { street: 0, pos: 3 } });
  });
  it("空表上大号码放右边、小号码放左边", () => {
    const game = buildGame({ players: 2, combos: [{ num: 14, action: "park" }, { num: 13, action: "park" }, { num: 15, action: "park" }] });
    const big = botCommand(view(game), "p1")!.move!;
    expect(big.house).toBeGreaterThanOrEqual(STREET_LEN[big.street]! - 3);
    const small = botCommand(view(buildGame({ players: 2, combos: [{ num: 2, action: "park" }, { num: 1, action: "park" }, { num: 3, action: "park" }] })), "p1")!.move!;
    expect(small.house).toBeLessThanOrEqual(1);
  });
  it("不需要 bis 时不用（bis 扣分）", () => {
    const game = createScene("start");
    const withBis = buildGame({ players: 2, combos: [{ num: 8, action: "bis" }, { num: 8, action: "bis" }, { num: 8, action: "bis" }] });
    expect(botCommand(view(withBis), "p1")!.move!.bis).toBeUndefined();
    expect(game.round).toBe(1);
  });
});

const STREET_LEN = [10, 11, 12];

describe("每一步都能说出理由（教程「提示」用）", () => {
  for (const name of SCENE_NAMES) {
    it(`${name}`, () => {
      const game = createScene(name);
      if (game.phase !== "play") return;
      const hint = botHint(view(game), "p1");
      expect(hint).not.toBeNull();
      expect(hint!.reason.length).toBeGreaterThan(8);
      expect(hint!.reason).not.toMatch(/undefined|NaN/);
    });
  }
});

describe("自对弈（每种人数 40 局，完整 300 局见 sim 脚本）", () => {
  for (const n of [1, 2, 3, 4, 5, 6]) {
    it(`${n} 人：每步合法、不超过最大步数、状态始终合法；同桌人机不会填出一模一样的表`, () => {
      const problems: string[] = [];
      let identical = 0;
      let maxMs = 0;
      let totalMs = 0;
      let decisions = 0;
      for (let g = 0; g < 40; g += 1) {
        let state = createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `咕噜${i + 1}` })), 500 + g + n * 1000);
        const rng = createRng(g);
        let steps = 0;
        while (state.phase === "play") {
          if (++steps > 600) {
            problems.push(`第 ${g} 局超过 600 步`);
            break;
          }
          const id = waitingFor(state)[0]!;
          const t0 = performance.now();
          const submission = botCommand(redactGameForViewer(state, id), id);
          const ms = performance.now() - t0;
          maxMs = Math.max(maxMs, ms);
          totalMs += ms;
          decisions += 1;
          if (!submission) {
            problems.push(`第 ${g} 局人机没给`);
            break;
          }
          const problem = checkSubmission(state, id, submission);
          if (problem) {
            problems.push(`第 ${g} 局不合法：${problem}`);
            break;
          }
          state = apply(state, id, { type: "submit", submission }, rng).state;
          if (problems.length === 0) problems.push(...stateProblems(state));
        }
        if (n >= 2) {
          const texts = state.players.map((player) => JSON.stringify(player.sheet.houses));
          if (new Set(texts).size < texts.length) identical += 1;
        }
      }
      expect(problems).toEqual([]);
      expect(identical).toBeLessThan(4);
      expect(totalMs / decisions).toBeLessThan(50);
      expect(maxMs).toBeLessThan(300);
    }, 120_000);
  }
});
