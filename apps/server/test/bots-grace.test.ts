/**
 * 离线 3 秒再由人机代打（全站约定）：bots.test.ts 把人机停顿调成 0 跑得快，看不出这 3 秒；
 * 这里用真实停顿（BOT_DELAY_SCALE=1），量掉线到人机替他选牌之间隔了多久。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LobbyRoomSnapshot } from "@welcometo/game";
import { call, ok, startServer, type Harness, type TestSocket } from "./harness.js";

process.env.BOT_DELAY_SCALE = "1";
process.env.TURN_MS = "20000";

let h: Harness;
beforeAll(async () => {
  h = await startServer();
});
afterAll(async () => {
  await h.close();
});

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 10_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = h.latest.get(client);
    if (current && test(current)) return resolve(current);
    const timer = setTimeout(() => reject(new Error("等不到想要的房间状态")), timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

describe("离线代打的等待", () => {
  it("掉线的人：至少等 3 秒才由人机替他交这一回合（不算超时），之后很快交好", async () => {
    const leaver = await h.connect();
    const stayer = await h.connect();
    const room = await ok(call<LobbyRoomSnapshot>((ack) => leaver.emit("room:create", { name: "掉线甲", capacity: 2 } as never, ack)));
    await ok(call<LobbyRoomSnapshot>((ack) => stayer.emit("room:join", { name: "留下乙", code: room.code }, ack)));
    const started = await ok(call<LobbyRoomSnapshot>((ack) => leaver.emit("room:start", ack)));
    const seat = started.members.find((member) => member.id === leaver.id)!.playerId;
    await updateWhere(stayer, (snapshot) => snapshot.game !== undefined);
    const t0 = Date.now();
    leaver.disconnect();
    const played = await updateWhere(stayer, (snapshot) => snapshot.game?.players.find((player) => player.id === seat)?.submitted === true);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(2_900);
    expect(elapsed).toBeLessThan(4_500);
    expect(played.game!.events.some((event) => event.type === "TimedOut")).toBe(false);
    expect(played.members.find((member) => member.playerId === seat)).toMatchObject({ connected: false });
  }, 15_000);
});
