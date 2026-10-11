/**
 * 新手教程剧本：从头走到尾都合法、关键几幕一定发生、剧本自身没毛病、接练习局能打完。
 */
import { describe, expect, it } from "vitest";
import {
  anchorCandidates,
  anchorVisible,
  apply,
  botCommand,
  buildDeck,
  checkSubmission,
  createPracticeGame,
  createRng,
  createTutorialGame,
  redactGameForViewer,
  stageAnchor,
  stageOf,
  stateProblems,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  tutorialStacks,
  type GameState,
  type Move,
} from "../src/index.js";

function runScript(upTo?: string): { state: GameState; problems: string[] } {
  let state = createTutorialGame("新玩家");
  const rng = createRng(1);
  const problems: string[] = [];
  for (const step of TUTORIAL_STEPS) {
    if (step.id === upTo) break;
    for (const anchor of anchorCandidates(step).slice(0, 1)) {
      if (!anchorVisible(state, anchor)) problems.push(`${step.id}：锚点 ${anchor} 看不见`);
    }
    if (step.kind === "do") {
      const { player, command } = step.expect;
      if (command.type !== "submit") { problems.push(`${step.id}：不是交一手`); continue; }
      const problem = checkSubmission(state, player, command.submission);
      if (problem) problems.push(`${step.id}：${problem}`);
      const move = command.submission.move as Move;
      // 每个阶段要高亮的东西都看得见
      for (const stage of ["combo", "house", "submit"] as const) {
        const anchor = stageAnchor(move, stage);
        if (!anchorVisible(state, anchor)) problems.push(`${step.id}：${stage} 锚点 ${anchor} 看不见`);
      }
      state = apply(state, player, command, rng).state;
    }
    if (step.kind === "watch") {
      for (const { player, command } of step.moves) {
        if (command.type === "submit") {
          const problem = checkSubmission(state, player, command.submission);
          if (problem) problems.push(`${step.id}：${player} ${problem}`);
        }
        state = apply(state, player, command, rng).state;
      }
    }
    problems.push(...stateProblems(state).map((text) => `${step.id}：${text}`));
  }
  return { state, problems };
}

describe("教程剧本", () => {
  it("剧本牌序：3 堆各 27 张、81 张不重复", () => {
    const stacks = tutorialStacks();
    expect(stacks.map((stack) => stack.length)).toEqual([27, 27, 27]);
    expect(new Set(stacks.flat().map((card) => card.id)).size).toBe(buildDeck().length);
  });
  it("从头走到尾：每一手合法、每个锚点看得见、局面始终合法", () => {
    const { state, problems } = runScript();
    expect(problems).toEqual([]);
    expect(state.phase).toBe("play");
    expect(state.round).toBe(7);
  });
  it("前 6 回合翻出的 3 组正是剧本写的", () => {
    let state = createTutorialGame("新玩家");
    const rng = createRng(2);
    const seen: string[] = [];
    for (const step of TUTORIAL_STEPS) {
      if (step.kind === "do") {
        seen.push(state.combos.map((combo) => `${combo.num}${combo.action}`).join(","));
        state = apply(state, step.expect.player, step.expect.command, rng).state;
      }
      if (step.kind === "watch") for (const move of step.moves) state = apply(state, move.player, move.command, rng).state;
    }
    expect(seen).toEqual([
      "5park,10fence,13improve",
      "4park,6pool,12fence",
      "8park,9fence,3improve",
      "6temp,11park,14fence",
      "10improve,4fence,12park",
      "7fence,11bis,2park",
    ]);
  });
  it("关键几幕：第 1 回合围出 3 房小区；第 3 回合你和咕噜一号同回合首批完成 n°3、都拿 7 分；临时工、改造、bis 都生效", () => {
    let { state } = runScript("estate");
    expect(state.players[0]!.sheet.parks[2]).toBe(1);
    ({ state } = runScript("first"));
    expect(state.players[0]!.sheet.plans[2]).toBe(7);
    expect(state.players[1]!.sheet.plans[2]).toBe(7);
    expect(state.plans[2]!.approvedRound).toBe(3);
    expect(state.lastRound!.reshuffledBy).toEqual([]);
    ({ state } = runScript("refuse"));
    const me = state.players[0]!.sheet;
    expect(me.temps).toBe(1);
    expect(me.improve[2]).toBe(1);
    expect(me.bis).toBe(1);
    expect(me.houses[0]![7]).toMatchObject({ num: 11, bis: true });
    expect(me.poolTrack).toBe(1);
  });
  it("临时工那一步：原号码 6 放不进栅栏右边，只有改成 8 才行（演示有意义）", () => {
    const { state } = runScript("r4");
    expect(checkSubmission(state, TUTORIAL_SELF, { move: { combo: 0, street: 0, house: 4 } })).not.toBeNull();
  });
  it("do 步骤的阶段：草稿一步步走，高亮跟着挪", () => {
    const step = TUTORIAL_STEPS.find((item) => item.id === "r3")!;
    if (step.kind !== "do" || step.expect.command.type !== "submit") throw new Error("r3");
    const move = step.expect.command.submission.move!;
    const empty = { combo: null, temp: null, spot: null, fence: null, improve: null, bis: null };
    expect(stageOf(move, empty)).toBe("combo");
    expect(stageOf(move, { ...empty, combo: 1 })).toBe("house");
    expect(stageOf(move, { ...empty, combo: 1, spot: { street: 1, house: 5 } })).toBe("action");
    expect(stageAnchor(move, "action")).toBe("fence:0:3");
    expect(stageOf(move, { ...empty, combo: 1, spot: { street: 1, house: 5 }, fence: { street: 0, pos: 3 } })).toBe("submit");
  });
  it("剧本自身：id 不重复，finale 唯一且在最后，主句不空、不太长", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1]).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) {
      expect(step.say.length).toBeGreaterThan(4);
      expect(step.say.length).toBeLessThanOrEqual(40);
    }
  });
  it("剧本走完接练习局：两个咕噜交给人机，接着打（和再练一局）都能打完", () => {
    const stuck: string[] = [];
    const finish = (start: GameState, seed: number) => {
      let state = start;
      const rng = createRng(seed);
      let steps = 0;
      while (state.phase === "play") {
        if (++steps > 400) { stuck.push(`种子 ${seed} 卡住`); break; }
        const actor = tutorialActor(state)!;
        const submission = botCommand(redactGameForViewer(state, actor), actor);
        if (!submission) { stuck.push(`种子 ${seed} 人机没给`); break; }
        state = apply(state, actor, { type: "submit", submission }, rng).state;
      }
    };
    finish(runScript().state, 7);
    for (let seed = 0; seed < 100; seed += 1) finish(createPracticeGame("新玩家", seed), seed);
    expect(stuck).toEqual([]);
  }, 60_000);
});
