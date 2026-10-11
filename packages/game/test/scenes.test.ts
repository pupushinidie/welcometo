/**
 * 预览局面工厂：每个命名局面都能造出来、状态合法、符合描述；精确局面的写法。
 */
import { describe, expect, it } from "vitest";
import {
  buildGame,
  checkSubmission,
  createScene,
  createSceneRoom,
  estates,
  mustRefuse,
  parseSheet,
  SCENE_NAMES,
  sheetToText,
  stateProblems,
} from "../src/index.js";

describe("预览局面工厂", () => {
  for (const name of SCENE_NAMES) {
    it(`${name} 能造出来，状态合法`, () => {
      const game = createScene(name);
      expect(stateProblems(game)).toEqual([]);
    });
  }
  it("每种行动之前：本回合有那种行动的组，而且我能用上", () => {
    for (const action of ["fence", "improve", "park", "pool", "temp", "bis"] as const) {
      const game = createScene(action);
      const index = game.combos.findIndex((combo) => combo.action === action);
      expect(index).toBeGreaterThanOrEqual(0);
    }
    const fence = createScene("fence");
    expect(checkSubmission(fence, "p1", { move: { combo: 0, street: 0, house: 3, fence: { street: 0, pos: 3 } } })).toBeNull();
    const pool = createScene("pool");
    expect(checkSubmission(pool, "p1", { move: { combo: 0, street: 0, house: 6, pool: true } })).toBeNull();
    const bis = createScene("bis");
    expect(checkSubmission(bis, "p1", { move: { combo: 0, street: 0, house: 7, bis: { street: 0, house: 4, from: -1 } } })).toBeNull();
  });
  it("plan：这一手填完能验证 n°3（还可以勾重洗）", () => {
    const game = createScene("plan");
    expect(checkSubmission(game, "p1", { move: { combo: 0, street: 0, house: 6 }, plans: [2], reshuffle: true })).toBeNull();
  });
  it("refuse：3 组都填不进去", () => {
    const game = createScene("refuse");
    expect(mustRefuse(game.players[0]!.sheet, game.combos)).toBe(true);
  });
  it("submitted：我交了、有人没交", () => {
    const game = createScene("submitted");
    expect(game.players[0]!.submitted).toBe(true);
    expect(game.players.some((player) => !player.submitted)).toBe(true);
  });
  it("approved：上一回合 p2 首批验证了 n°1", () => {
    const game = createScene("approved");
    expect(game.plans[0]!.approvedRound).not.toBeNull();
    expect(game.players[1]!.sheet.plans[0]).toBe(8);
  });
  it("六人桌、终局、并列终局", () => {
    expect(createScene("six").players).toHaveLength(6);
    const over = createScene("gameover");
    expect(over.phase).toBe("gameOver");
    const tie = createScene("gameover-tie");
    expect(tie.finalResult!.winners).toEqual(["p1", "p2"]);
  });
  it("精确局面：表的写法能往返", () => {
    const text = ["1 2 | 3 4 5 | _ _ _ _ _", "0p 1 2 3 | _ _ _ _ _ _ _", "1 1b | _ _ _ _ _ _ _ _ _ _"] as const;
    const sheet = parseSheet({ streets: [...text] as [string, string, string] });
    expect(sheetToText(sheet)).toEqual([...text]);
    expect(estates(sheet).map((estate) => estate.size)).toEqual([2, 3, 4, 2]);
  });
  it("精确局面：指定 3 组、目标卡翻面、回合数、谁交了", () => {
    const game = buildGame({
      players: [{}, { submitted: true }, {}],
      combos: [{ num: 1, action: "bis" }, { num: 15, action: "temp" }, { num: 8, action: "pool" }],
      plans: ["1-6", "2-6", "3-6"],
      approved: { 1: 4 },
      round: 9,
    });
    expect(game.combos.map((combo) => combo.num)).toEqual([1, 15, 8]);
    expect(game.plans[1]!.approvedRound).toBe(4);
    expect(game.round).toBe(9);
    expect(game.players[1]!.submitted).toBe(true);
    expect(stateProblems(game)).toEqual([]);
  });
  it("房间快照：离线、人机、托管、观战、快超时", () => {
    const room = createSceneRoom(createScene("mid"), { offline: ["p3"], bots: ["p4"], auto: ["p2"], turnRemainingMs: 5000 });
    expect(room.members.find((member) => member.playerId === "p3")!.connected).toBe(false);
    expect(room.members.find((member) => member.playerId === "p4")).toMatchObject({ bot: true, name: "咕噜一号" });
    expect(room.members.find((member) => member.playerId === "p2")!.auto).toBe(true);
    expect(room.turnRemainingMs).toBe(5000);
    const watcher = createSceneRoom(createScene("submitted"), { spectator: true });
    expect(watcher.code).toBe("");
    expect(watcher.game!.players.every((player) => player.pending === null)).toBe(true);
  });
});
