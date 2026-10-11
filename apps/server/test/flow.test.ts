/**
 * 服务器全流程：建房 → 加入 → 开局 → 交 / 撤回 / 改交 → 全员交齐一次结算 → 每种行动、拒批、验证目标卡和重洗
 * → 终局 → 再来一局；计时 key（别人交不重置倒计时）、超时由人机代做和转托管、原昵称重连、管理员解散、
 * 迟到的点击、首页列表，以及每个连接收到的数据里没有牌堆顺序、种子和别人还没结算的那一手。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGame, stepKey, type ExactSpec, type GameState, type LobbyRoomSnapshot, type PlayerSpec, type Submission } from "@welcometo/game";
import { call, command, delay, join, ok, seatOf, startServer, updateWhere, type Harness, type TestSocket } from "./harness.js";

// 管理员口令、人机立刻行动要在服务器 import 之前设好。不设 TURN_MS：用真实的 90 秒限时，超时用 testHooks 触发。
process.env.ADMIN_TOKEN = "flow-test-token";
process.env.BOT_DELAY_SCALE = "0";
delete process.env.TURN_MS;

let h: Harness;
let nameSeq = 0;
const nick = (prefix: string) => `${prefix}${++nameSeq}`;

beforeAll(async () => {
  h = await startServer();
});
afterAll(async () => {
  await h.close();
});

async function threeSeats(): Promise<{ code: string; host: TestSocket; a: TestSocket; b: TestSocket; names: string[] }> {
  const host = await h.connect();
  const names = [nick("房主"), nick("阿花"), nick("老王")];
  const created = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: names[0]!, capacity: 3 }, ack)));
  const a = await h.connect();
  const b = await h.connect();
  await ok(join(a, { name: names[1]!, code: created.code }));
  await ok(join(b, { name: names[2]!, code: created.code }));
  return { code: created.code, host, a, b, names };
}

async function started(): Promise<{ code: string; host: TestSocket; a: TestSocket; b: TestSocket; names: string[] }> {
  const room = await threeSeats();
  await ok(call<LobbyRoomSnapshot>((ack) => room.host.emit("room:start", ack)));
  for (const client of [room.host, room.a, room.b]) await updateWhere(h, client, (snapshot) => snapshot.game !== undefined);
  return room;
}

const gameOf = (client: TestSocket): GameState => h.latest.get(client)!.game!;

/** 把房间换成精确局面（玩家 id 用座位 p1–p3、名字用房间里的）。 */
function inject(code: string, names: string[], spec: Omit<ExactSpec, "players"> & { players: PlayerSpec[] }): GameState {
  const game = buildGame({ ...spec, players: spec.players.map((player, index) => ({ ...player, id: `p${index + 1}`, name: names[index]! })) });
  h.server.testHooks.setGame(code, game);
  return game;
}

const E = ["_ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"] as const;
const STUCK = ["1 2 3 4 5 _ 6 7 8 9", "1 2 3 4 5 6 _ 7 8 9 10", "1 2 3 4 5 6 7 _ 8 9 10 11"] as const;
const sub = (move: Submission["move"], extra: Omit<Submission, "move"> = {}): Submission => ({ move, ...extra });

/** 最左边能填的一手（测试里真人随便交）。 */
function firstLegal(game: GameState, id: string): Submission {
  const sheet = game.players.find((player) => player.id === id)!.sheet;
  for (let combo = 0; combo < 3; combo += 1) {
    const num = game.combos[combo]!.num;
    for (let street = 0; street < 3; street += 1) {
      const row = sheet.houses[street]!;
      for (let house = 0; house < row.length; house += 1) {
        if (row[house]) continue;
        const left = row.slice(0, house).filter(Boolean).map((x) => x!.num);
        const right = row.slice(house + 1).filter(Boolean).map((x) => x!.num);
        if (left.every((n) => n < num) && right.every((n) => n > num)) return { move: { combo, street, house } };
      }
    }
  }
  return { move: null };
}

describe("服务器全流程", () => {
  it("昵称（I10）：零宽 / 方向控制字符去掉后同名就拒绝；「咕噜X号」留给人机", async () => {
    const late = await h.connect();
    const host = await h.connect();
    const hostName = nick("张三");
    const created = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: hostName, capacity: 4 }, ack)));
    expect((await join(late, { name: `${hostName}​`, code: created.code })).ok).toBe(false);
    expect((await join(late, { name: `‮${hostName}`, code: created.code })).ok).toBe(false);
    expect((await join(late, { name: "咕噜一号", code: created.code })).ok).toBe(false);
    expect((await join(late, { name: nick("李四"), code: created.code })).ok).toBe(true);
  });

  it("房间人数只能 2–6", async () => {
    const host = await h.connect();
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("多人"), capacity: 7 } as never, ack))).ok).toBe(false);
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("单人"), capacity: 1 } as never, ack))).ok).toBe(false);
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("六人"), capacity: 6 }, ack)));
  });

  it("猜房间码限速（I9）：同一条连接 10 秒内第 11 次加入起被拒", async () => {
    const guesser = await h.connect();
    const replies: string[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const reply = await join(guesser, { name: nick("路人"), code: "ZZZZZ2" });
      replies.push(reply.ok ? "ok" : reply.error);
    }
    expect(replies.slice(0, 10).every((reply) => reply.includes("找不到"))).toBe(true);
    expect(replies.slice(10).every((reply) => reply.includes("频繁"))).toBe(true);
  });

  it("洗牌密钥（I7）：每场 256 位、两场不一样；发给每个人的数据里都没有密钥和随机数状态", async () => {
    const one = await started();
    const two = await started();
    const first = h.server.testHooks.rngOf(one.code);
    const second = h.server.testHooks.rngOf(two.code);
    expect(first.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(String(first.rngState)).toMatch(/^c20:[0-9a-f]{64}:\d+$/);
    expect(second.seed).not.toBe(first.seed);
    for (const client of [one.host, one.a, one.b]) {
      const text = JSON.stringify(h.latest.get(client));
      expect(text).not.toContain(String(first.seed));
      expect(text).not.toContain("c20:");
    }
  });

  it("开局 → 交 / 撤回 / 改交 → 全员交齐一次结算 → 每种行动 → 验证目标卡和重洗 → 拒批到终局 → 再来一局", async () => {
    const { code, host, a, b, names } = await started();
    expect(gameOf(host)).toMatchObject({ phase: "play", round: 1 });
    expect(gameOf(host).combos).toHaveLength(3);

    // 第 1 回合：栅栏 / 公园 / 泳池
    inject(code, names, {
      players: [{ sheet: { streets: ["1 3 4 _ _ _ _ _ _ _", E[1], E[2]] } }, {}, {}],
      combos: [{ num: 6, action: "fence" }, { num: 8, action: "park" }, { num: 9, action: "pool" }],
      plans: ["1-1", "2-3", "3-1"],
    });
    await updateWhere(h, a, (snapshot) => snapshot.game?.combos[0]?.num === 6);
    const fence = sub({ combo: 0, street: 0, house: 3, fence: { street: 0, pos: 3 } });
    await ok(command(host, { type: "submit", submission: fence }, h));
    // 别人只看到「已交」，看不到交了什么
    const seen = await updateWhere(h, a, (snapshot) => snapshot.game?.players[0]!.submitted === true);
    expect(seen.game!.players[0]!.pending).toBeNull();
    expect(h.latest.get(host)!.game!.players[0]!.pending).toEqual(fence);
    // 撤回、改交
    await ok(command(host, { type: "retract" }, h));
    await updateWhere(h, a, (snapshot) => snapshot.game?.players[0]!.submitted === false);
    await ok(command(host, { type: "submit", submission: sub({ combo: 1, street: 1, house: 5 }) }, h));
    await ok(command(host, { type: "submit", submission: fence }, h));
    await ok(command(a, { type: "submit", submission: sub({ combo: 1, street: 1, house: 5, park: true }) }, h));
    expect(gameOf(a).round).toBe(1);
    await ok(command(b, { type: "submit", submission: sub({ combo: 2, street: 0, house: 6, pool: true }) }, h));
    const r1 = await updateWhere(h, a, (snapshot) => snapshot.game?.round === 2);
    expect(r1.game!.lastRound!.plays.p1!.submission).toEqual(fence);
    expect(r1.game!.players[0]!.sheet.fences[0]![3]).toBe(true);
    expect(r1.game!.players[1]!.sheet.parks).toEqual([0, 1, 0]);
    expect(r1.game!.players[2]!.sheet.poolTrack).toBe(1);

    // 改造 / 临时工 / bis
    inject(code, names, {
      players: [{ sheet: { streets: ["1 2 3 | _ _ _ _ _ _ _", E[1], E[2]] } }, { sheet: { streets: ["5 _ _ _ _ _ _ _ _ _", E[1], E[2]] } }, {}],
      combos: [{ num: 10, action: "improve" }, { num: 8, action: "temp" }, { num: 12, action: "bis" }],
      plans: ["1-1", "2-3", "3-1"],
      round: 2,
    });
    await updateWhere(h, a, (snapshot) => snapshot.game?.combos[0]?.num === 10);
    await ok(command(host, { type: "submit", submission: sub({ combo: 0, street: 1, house: 6, improve: 3 }) }, h));
    await ok(command(a, { type: "submit", submission: sub({ combo: 2, street: 2, house: 8, bis: { street: 0, house: 1, from: -1 } }) }, h));
    await ok(command(b, { type: "submit", submission: sub({ combo: 1, street: 2, house: 11, temp: 2 }) }, h));
    const r2 = await updateWhere(h, a, (snapshot) => snapshot.game?.round === 3);
    expect(r2.game!.players[0]!.sheet.improve[2]).toBe(1);
    expect(r2.game!.players[1]!.sheet.houses[0]![1]).toMatchObject({ num: 5, bis: true });
    expect(r2.game!.players[2]!.sheet.houses[2]![11]!.num).toBe(10);
    expect(r2.game!.players[2]!.sheet.temps).toBe(1);

    // 验证目标卡（同回合两人首批都拿高分）+ 重洗；第三人拒批满 3 次 → 终局
    const ready = { streets: ["1 2 3 | 4 5 6 _ | _ _ _", E[1], E[2]] as [string, string, string] };
    inject(code, names, {
      players: [{ sheet: ready }, { sheet: ready }, { sheet: { streets: [...STUCK] as [string, string, string], refusals: 2 } }],
      combos: [{ num: 7, action: "park" }, { num: 14, action: "fence" }, { num: 15, action: "improve" }],
      plans: ["1-1", "2-3", "3-1"],
      round: 3,
      drawLeft: 10,
    });
    await updateWhere(h, a, (snapshot) => snapshot.game?.combos[0]?.num === 7);
    const claim = sub({ combo: 0, street: 0, house: 6 }, { plans: [2] });
    expect((await command(b, { type: "submit", submission: sub({ combo: 1, street: 0, house: 5 }) }, h)).ok).toBe(false);
    await ok(command(host, { type: "submit", submission: claim }, h));
    await ok(command(a, { type: "submit", submission: { ...claim, reshuffle: true } }, h));
    await ok(command(b, { type: "submit", submission: sub(null) }, h));
    const over = await updateWhere(h, host, (snapshot) => snapshot.game?.phase === "gameOver");
    expect(over.game!.players[0]!.sheet.plans[2]).toBe(7);
    expect(over.game!.players[1]!.sheet.plans[2]).toBe(7);
    expect(over.game!.finalResult!.reasons).toEqual(["refusals"]);
    expect(over.game!.finalResult!.scores.p3!.refusals).toBe(5);
    expect(over.rematch).toBeDefined();
    expect(over.turnRemainingMs).toBeUndefined();
    const summary = await ok(call<import("@welcometo/game").PublicRoomSummary[]>((ack) => h.connect().then((spy) => spy.emit("lobby:get", ack))));
    const listed = summary.find((room) => room.players[0]?.name === names[0])!;
    expect(listed.status).toBe("finished");
    expect(listed.players.filter((player) => player.isWinner).map((player) => player.name)).toEqual([names[0], names[1]]);
    for (const client of [host, a, b]) await ok(call<void>((ack) => client.emit("room:rematch", true, ack)));
    const again = await updateWhere(h, host, (snapshot) => !snapshot.rematch && snapshot.game?.phase === "play" && snapshot.game?.round === 1);
    expect(again.game!.players.every((player) => player.sheet.houses.flat().every((house) => house === null))).toBe(true);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  }, 30_000);

  it("计时 key：别人交、撤回、改交都不重置倒计时；换回合才重新计时（90 秒 + 结算动画）", async () => {
    const { code, host, a, b } = await started();
    const first = h.server.testHooks.deadline(code)!;
    expect(first.key).toBe("r1");
    expect(first.deadline - Date.now()).toBeGreaterThan(89_000);
    await delay(30);
    const any = (client: TestSocket) => ({ type: "submit" as const, submission: firstLegal(gameOf(client), seatOf(h, client)) });
    await ok(command(a, any(a), h));
    await ok(command(a, { type: "retract" }, h));
    await ok(command(a, any(a), h));
    await ok(command(host, any(host), h));
    expect(h.server.testHooks.deadline(code)).toEqual(first);
    const snap = await updateWhere(h, b, (snapshot) => snapshot.game?.players[0]!.submitted === true);
    expect(snap.turnRemainingMs!).toBeLessThan(90_000);
    await ok(command(b, any(b), h));
    await updateWhere(h, b, (snapshot) => snapshot.game?.round === 2);
    const second = h.server.testHooks.deadline(code)!;
    expect(second.key).toBe("r2");
    expect(second.deadline - Date.now()).toBeGreaterThan(90_000 + 1_200 - 500);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("超时（testHooks 触发）：没交的人由人机代交（标 auto），交了的不动；真人连续 2 次转托管，取消托管后交还", async () => {
    const { code, host, a } = await started();
    const mine = firstLegal(gameOf(host), "p1");
    await ok(command(host, { type: "submit", submission: mine }, h));
    h.server.testHooks.expireTurn(code);
    const timed = await updateWhere(h, a, (snapshot) => snapshot.game?.round === 2);
    expect(timed.game!.events[0]).toEqual({ type: "TimedOut", players: ["p2", "p3"] });
    expect(timed.game!.lastRound!.plays.p1!.auto).toBeUndefined();
    expect(timed.game!.lastRound!.plays.p2!.auto).toBe(true);
    expect(timed.game!.lastRound!.plays.p1!.submission).toEqual(mine);
    expect(timed.members.every((member) => !member.auto)).toBe(true);
    await updateWhere(h, host, (snapshot) => snapshot.game?.round === 2);
    // 房主这回合也交了（超时次数清零）；乙、丙连续第 2 次 → 托管
    await ok(command(host, { type: "submit", submission: firstLegal(gameOf(host), "p1") }, h));
    h.server.testHooks.expireTurn(code);
    const auto = await updateWhere(h, a, (snapshot) => snapshot.members.filter((member) => member.auto).length === 2);
    expect(auto.members.filter((member) => member.auto).map((member) => member.playerId)).toEqual(["p2", "p3"]);
    // 托管的人由人机立刻代交（BOT_DELAY_SCALE=0）；房主一交就结算到下一回合
    await updateWhere(h, host, (snapshot) => snapshot.game?.round === 3 && snapshot.game.players[1]!.submitted && snapshot.game.players[2]!.submitted);
    await ok(command(host, { type: "submit", submission: firstLegal(gameOf(host), "p1") }, h));
    await updateWhere(h, a, (snapshot) => snapshot.game?.round === 4);
    await ok(call<void>((ack) => a.emit("room:auto", false, ack)));
    await updateWhere(h, a, (snapshot) => snapshot.members.find((member) => member.playerId === "p2")!.auto === undefined);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("掉线后用原昵称回到原座位，还能看到自己这回合交的一手", async () => {
    const { code, host, a, names } = await started();
    const mine = firstLegal(gameOf(a), "p2");
    await ok(command(a, { type: "submit", submission: mine }, h));
    a.disconnect();
    await updateWhere(h, host, (snapshot) => snapshot.members.find((member) => member.playerId === "p2")!.connected === false);
    const other = await h.connect();
    expect((await join(other, { name: nick("陌生"), code })).ok).toBe(false);
    const back = await h.connect();
    const rejoined = await ok(join(back, { name: names[1]!, code }));
    expect(rejoined.members.find((member) => member.id === back.id)).toMatchObject({ playerId: "p2", connected: true });
    expect(rejoined.game!.players.find((player) => player.id === "p2")!.pending).toEqual(mine);
    expect(rejoined.game!.players.find((player) => player.id === "p1")!.pending).toBeNull();
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("同一次登录刷新页面：旧连接还没断也能直接回到座位（顶替旧连接）；别的登录同名不行", async () => {
    const host = await h.connect({ "x-gc-session": "S-host" });
    const names = [nick("房主"), nick("阿花")];
    const created = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: names[0]!, capacity: 2 }, ack)));
    const a = await h.connect({ "x-gc-session": "S-a" });
    await ok(join(a, { name: names[1]!, code: created.code }));
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    await updateWhere(h, a, (snapshot) => snapshot.game !== undefined);
    const stranger = await h.connect({ "x-gc-session": "S-other" });
    expect((await join(stranger, { name: names[1]!, code: created.code })).ok).toBe(false);
    const kicked = new Promise<string>((resolve) => a.once("room:closed", ({ reason }) => resolve(reason)));
    const again = await h.connect({ "x-gc-session": "S-a" });
    const back = await ok(join(again, { name: names[1]!, code: created.code }));
    expect(back.members.find((member) => member.id === again.id)).toMatchObject({ playerId: "p2", connected: true });
    expect(await kicked).toContain("另一个窗口");
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("管理员解散：口令不对拒绝；对了房间关闭，所有人和观战的人都收到通知", async () => {
    const { host, a, b, names } = await threeSeats();
    const viewer = await h.connect();
    await ok(join(viewer, { name: nick("看客"), code: h.latest.get(host)!.code, spectate: true }));
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    const admin = await h.connect();
    const rooms = await ok(call<import("@welcometo/game").PublicRoomSummary[]>((ack) => admin.emit("lobby:get", ack)));
    const target = rooms.find((room) => room.players[0]?.name === names[0])!;
    expect(target.status).toBe("playing");
    expect(target.players.every((player) => player.isActive)).toBe(true);
    expect((await call<void>((ack) => admin.emit("admin:dissolve", { roomId: target.id, token: "wrong" }, ack))).ok).toBe(false);
    const closed = Promise.all([host, a, b, viewer].map((client) => new Promise<string>((resolve) => client.once("room:closed", ({ reason }) => resolve(reason)))));
    await delay(2_100); // 口令错一次后要等 2 秒
    await ok(call<void>((ack) => admin.emit("admin:dissolve", { roomId: target.id, token: "flow-test-token" }, ack)));
    expect((await closed).every((reason) => reason.includes("管理员"))).toBe(true);
    const after = await ok(call<import("@welcometo/game").PublicRoomSummary[]>((ack) => admin.emit("lobby:get", ack)));
    expect(after.some((room) => room.id === target.id)).toBe(false);
  });

  it("迟到的点击：带着上一回合 step 发来的一手被拒绝，不会落到下一回合", async () => {
    const { code, host, a, b } = await started();
    const seen = stepKey(gameOf(host));
    const stale = firstLegal(gameOf(host), "p1");
    await ok(command(a, { type: "submit", submission: firstLegal(gameOf(a), "p2") }, h));
    await ok(command(b, { type: "submit", submission: firstLegal(gameOf(b), "p3") }, h));
    h.server.testHooks.expireTurn(code);
    await updateWhere(h, host, (snapshot) => snapshot.game?.round === 2);
    const late = await command(host, { type: "submit", submission: stale, step: seen }, h);
    expect(late.ok).toBe(false);
    expect(late.ok ? "" : late.error).toContain("已经结算");
    expect(gameOf(a).players[0]!.submitted).toBe(false);
    await ok(command(host, { type: "submit", submission: firstLegal(gameOf(host), "p1"), step: stepKey(gameOf(host)) }, h));
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("托管的人由人机代交，结算记录里标 auto", async () => {
    const { host, a, b } = await started();
    await ok(command(host, { type: "submit", submission: firstLegal(gameOf(host), "p1") }, h));
    await ok(command(b, { type: "submit", submission: firstLegal(gameOf(b), "p3") }, h));
    await ok(call<void>((ack) => a.emit("room:auto", true, ack)));
    const done = await updateWhere(h, host, (snapshot) => snapshot.game?.round === 2);
    expect(done.game!.lastRound!.plays.p2!.auto).toBe(true);
    expect(done.game!.lastRound!.plays.p1!.auto).toBeUndefined();
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("刷动作限速：同一个连接一秒内超过 20 个动作就拒绝", async () => {
    const { host } = await started();
    const results = await Promise.all(Array.from({ length: 30 }, () => command(host, { type: "retract" })));
    expect(results.filter((result) => !result.ok && result.error.includes("太快")).length).toBeGreaterThan(0);
    await delay(1_100);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("客户端漏发回执、参数个数不对、乱塞字段，服务器不会崩", async () => {
    const rude = await h.connect();
    const raw = rude as unknown as { emit: (...args: unknown[]) => void };
    raw.emit("lobby:get");
    raw.emit("game:command", { type: "submit", submission: { move: { combo: "x", street: {}, house: null, fence: 3 } } });
    raw.emit("room:create", { name: "无礼的人", capacity: 2 });
    raw.emit("room:start", "多余", "参数");
    raw.emit("game:command", { type: "submit", submission: { move: { combo: 0, street: 0, house: 0, bis: { from: 7 } } } }, () => {});
    raw.emit("room:kick");
    raw.emit("voice:signal");
    await delay(200);
    const still = await h.connect();
    const rooms = await ok(call<import("@welcometo/game").PublicRoomSummary[]>((ack) => still.emit("lobby:get", ack)));
    expect(Array.isArray(rooms)).toBe(true);
    expect(h.server.httpServer.listening).toBe(true);
  });

  it("抓包：整个流程里每个连接收到的数据都没有牌堆顺序、种子、动作序列和别人还没结算的那一手", () => {
    let checked = 0;
    let sawPending = 0;
    for (const updates of h.received.values()) {
      for (const { selfId, room } of updates) {
        const game = room.game;
        if (!game) continue;
        const raw = game as unknown as Record<string, unknown>;
        for (const key of ["seed", "rngState", "log"]) expect(raw[key], key).toBeUndefined();
        for (const stack of game.stacks) expect(stack.draw).toEqual([]);
        const seat = room.members.find((member) => member.id === selfId)?.playerId;
        for (const player of game.players) {
          if (player.id === seat) {
            if (player.pending) sawPending += 1;
            continue;
          }
          if (room.access.spectatorsSeeAll && !seat) continue;
          expect(player.pending).toBeNull();
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(sawPending).toBeGreaterThan(0);
  });
});
