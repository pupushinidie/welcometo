/**
 * 真实计时（TURN_MS=600）：别人交了不会重置倒计时；到点没交的人由人机代交，整回合结算。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fallbackSubmission, type LobbyRoomSnapshot } from "@welcometo/game";
import { call, command, delay, ok, startServer, updateWhere, type Harness } from "./harness.js";

process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "600";

let h: Harness;
beforeAll(async () => {
  h = await startServer();
});
afterAll(async () => {
  await h.close();
});

describe("超时（TURN_MS=600）", () => {
  it("乙中途交了不会重置甲的倒计时；到点甲由人机代交（标 auto），回合推进", async () => {
    const host = await h.connect();
    const guest = await h.connect();
    const room = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: "计时甲", capacity: 2 }, ack)));
    await ok(call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: "计时乙", code: room.code }, ack)));
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    const t0 = Date.now();
    const g = await updateWhere(h, guest, (snapshot) => snapshot.game !== undefined);
    await delay(300);
    await ok(command(guest, { type: "submit", submission: fallbackSubmission(g.game!, "p2") }, h));
    const next = await updateWhere(h, guest, (snapshot) => snapshot.game?.round === 2, 3_000);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(550);
    expect(elapsed).toBeLessThan(1_200);
    expect(next.game!.events[0]).toEqual({ type: "TimedOut", players: ["p1"] });
    expect(next.game!.lastRound!.plays.p1!.auto).toBe(true);
    expect(next.game!.lastRound!.plays.p2!.auto).toBeUndefined();
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });
});
