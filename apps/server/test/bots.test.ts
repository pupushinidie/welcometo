import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  fallbackSubmission,
  waitingFor,
  type AckResponse,
  type Capacity,
  type ClientToServerEvents,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type ServerToClientEvents,
} from "@welcometo/game";

// ---------- 每款游戏不一样的地方 ----------
/** 测试里真人怎么走：从合法动作里挑一个（要保证对局能走完）。欢迎来到：交兜底的一手（最小的数字填最左能填的位置，不能填就拒批），不撤回。 */
function humanMove(_game: GameState, actions: GameCommand[]): GameCommand {
  return actions.find((action) => action.type === "submit")!;
}
/** 这位玩家现在能做的动作（没交就交兜底的一手）。 */
function legalActions(game: GameState, playerId: string): GameCommand[] {
  const me = game.players.find((player) => player.id === playerId);
  if (!me || me.submitted || game.phase !== "play") return [];
  return [{ type: "submit", submission: fallbackSubmission(game, playerId) }];
}
/** 现在要不要这位真人做决定（同时交：没交的人都要做；交了的不再动，免得来回改交）。 */
function needsMe(game: GameState, playerId: string): boolean {
  return waitingFor(game).includes(playerId);
}
/** 这位玩家自己（或替他的人机）做了点什么，不是超时代做的。 */
function actedBy(room: LobbyRoomSnapshot, playerId: string): boolean {
  const events = room.game?.events ?? [];
  const acted = events.some((event) => event.type === "Submitted" && event.player === playerId);
  const timedOut = events.some((event) => event.type === "TimedOut" && event.players.includes(playerId));
  return acted && !timedOut;
}
/** 这一步里这位玩家是被超时代做的。 */
function timedOut(room: LobbyRoomSnapshot, playerId: string): boolean {
  return room.game?.events.some((event) => event.type === "TimedOut" && event.players.includes(playerId)) === true;
}
/** 对局结束。 */
function finished(game: GameState | undefined): boolean {
  return game?.phase === "gameOver";
}
/** 最小的房间人数选项、开局至少几人。 */
const MIN_CAPACITY: Capacity = 2;
const MIN_PLAYERS = 2;
/** 「一个人加满人机」用几人房；「加满后加不了」用几人房。 */
const SOLO_CAPACITY: Capacity = 4;
const FULL_TEST_CAPACITY: Capacity = 3;
// ----------------------------------------

// 人机立刻行动、每一步 300 ms 超时，测试才跑得快（服务端在导入时读这两个变量）。
process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "300";


type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
let nameSeq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    client.on("room:updated", (room) => latest.set(client, room));
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function nick(prefix: string): string {
  nameSeq += 1;
  return `${prefix}${nameSeq}`;
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

async function create(client: TestSocket, name: string, capacity: Capacity): Promise<LobbyRoomSnapshot> {
  const response = await call<LobbyRoomSnapshot>((ack) => client.emit("room:create", { name, capacity } as never, ack));
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

const addBot = (client: TestSocket) => call<void>((ack) => client.emit("room:add-bot", ack));

/** 再加几个人机，凑够开局人数。 */
async function addBotsUpTo(host: TestSocket, humansSeated: number): Promise<void> {
  for (let seat = humansSeated; seat < MIN_PLAYERS; seat += 1) expect((await addBot(host)).ok).toBe(true);
}
const start = (client: TestSocket) => call<LobbyRoomSnapshot>((ack) => client.emit("room:start", ack));

function lobby(client: TestSocket): Promise<PublicRoomSummary[]> {
  return new Promise((resolve) => client.emit("lobby:get", (response) => resolve(response.ok ? response.data : [])));
}

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 20_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

function seatOf(client: TestSocket): string {
  return latest.get(client)?.members.find((member) => member.id === client.id)?.playerId ?? "";
}

/** 轮到这个真人时按 humanMove 自动行动；返回停止函数。 */
function autoplay(client: TestSocket): () => void {
  let sentFor = "";
  const handler = (room: LobbyRoomSnapshot) => {
    const game = room.game;
    if (!game || finished(game) || !needsMe(game, seatOf(client))) return;
    const actions = legalActions(game, seatOf(client));
    const key = String(game.version);
    if (actions.length === 0 || sentFor === key) return;
    sentFor = key;
    client.emit("game:command", humanMove(game, actions), () => {});
  };
  client.on("room:updated", handler);
  const current = latest.get(client);
  if (current) handler(current);
  return () => client.off("room:updated", handler);
}

describe("人机", () => {
  beforeAll(async () => {
    const serverModule = await import("../src/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
  });

  it("只有房主能加人机；坐满后加不了；房主能移出人机；首页列表标出人机", async () => {
    const host = await connect();
    const hostName = nick("房主");
    const { code } = await create(host, hostName, FULL_TEST_CAPACITY);
    const guest = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("客人"), code }, ack))).ok).toBe(true);

    expect((await addBot(guest)).ok).toBe(false);
    for (let seat = 2; seat < FULL_TEST_CAPACITY; seat += 1) expect((await addBot(host)).ok).toBe(true);
    const room = await updateWhere(host, (snapshot) => snapshot.members.length === FULL_TEST_CAPACITY);
    const bot = room.members.find((member) => member.bot)!;
    expect(bot).toMatchObject({ name: "咕噜一号", isHost: false, connected: true, bot: true });
    expect((await addBot(host)).ok).toBe(false);

    const summary = (await lobby(host)).find((candidate) => candidate.players[0]?.name === hostName)!;
    expect(summary.players.find((player) => player.name === "咕噜一号")?.bot).toBe(true);

    expect((await call<void>((ack) => host.emit("room:kick", bot.id, ack))).ok).toBe(true);
    await updateWhere(host, (snapshot) => snapshot.members.length === 2 && !snapshot.members.some((member) => member.bot));
  });

  it("6 人房一个人加满 5 个人机：名字排到咕噜五号，再加就满了；开局后人机真的在交", async () => {
    const host = await connect();
    await create(host, nick("六人"), 6);
    for (let seat = 1; seat < 6; seat += 1) expect((await addBot(host)).ok).toBe(true);
    expect((await addBot(host)).ok).toBe(false);
    const room = await updateWhere(host, (snapshot) => snapshot.members.length === 6);
    expect(room.members.slice(1).map((member) => member.name)).toEqual(["咕噜一号", "咕噜二号", "咕噜三号", "咕噜四号", "咕噜五号"]);
    expect(room.members.slice(1).every((member) => member.bot === true)).toBe(true);
    expect((await start(host)).ok).toBe(true);
    // 真人不动：5 个人机都交了，只等我一个
    const waiting = await updateWhere(host, (snapshot) => snapshot.game?.phase === "play" && snapshot.game.players.filter((player) => player.submitted).length === 5);
    expect(waiting.game!.players.find((player) => !player.submitted)!.id).toBe(seatOf(host));
    expect((await call<void>((ack) => host.emit("room:dissolve", ack))).ok).toBe(true);
  }, 30_000);

  it("一个人加满人机就能开局，人机把整局打完；人机自动同意再来一局", async () => {
    const host = await connect();
    await create(host, nick("独行"), SOLO_CAPACITY);
    for (let seat = 1; seat < SOLO_CAPACITY; seat += 1) expect((await addBot(host)).ok).toBe(true);
    const names = (await updateWhere(host, (snapshot) => snapshot.members.length === SOLO_CAPACITY)).members.map((member) => member.name);
    expect(names.slice(1)).toEqual(["咕噜一号", "咕噜二号", "咕噜三号", "咕噜四号"].slice(0, SOLO_CAPACITY - 1));

    expect((await start(host)).ok).toBe(true);
    const stop = autoplay(host);
    const over = await updateWhere(host, (snapshot) => finished(snapshot.game), 60_000);
    stop();
    const bots = over.members.filter((member) => member.bot).map((member) => member.id);
    expect(over.rematch?.acceptedIds.sort()).toEqual(bots.sort());

    expect((await call<void>((ack) => host.emit("room:rematch", true, ack))).ok).toBe(true);
    const again = await updateWhere(host, (snapshot) => snapshot.game !== undefined && !finished(snapshot.game) && !snapshot.rematch);
    expect(again.game!.players).toHaveLength(SOLO_CAPACITY);
  }, 90_000);

  it("等待中最后一个真人离开，只剩人机的房间直接关掉", async () => {
    const host = await connect();
    const hostName = nick("房主");
    await create(host, hostName, MIN_CAPACITY);
    expect((await addBot(host)).ok).toBe(true);
    expect((await lobby(host)).some((candidate) => candidate.players[0]?.name === hostName)).toBe(true);
    expect((await call<void>((ack) => host.emit("room:leave", ack))).ok).toBe(true);
    expect((await lobby(host)).some((candidate) => candidate.players.some((player) => player.name === hostName))).toBe(false);
  });

  it("连续超时两次转托管，由人机代打；取消托管后交还", async () => {
    const idle = await connect();
    const active = await connect();
    const { code } = await create(idle, nick("发呆"), MIN_CAPACITY);
    expect((await call<LobbyRoomSnapshot>((ack) => active.emit("room:join", { name: nick("认真"), code }, ack))).ok).toBe(true);
    await addBotsUpTo(idle, 2);
    expect((await start(idle)).ok).toBe(true);
    const stop = autoplay(active);

    const isAuto = (snapshot: LobbyRoomSnapshot) => snapshot.members.find((member) => member.id === idle.id)?.auto === true;
    const autoRoom = await updateWhere(idle, isAuto);
    const idleSeat = seatOf(idle);
    expect(timedOut(autoRoom, idleSeat)).toBe(true);

    // 托管后人机替他交：之后不再是超时代做，而是人机真的行动（大家同时交，倒计时共用，所以不看 turnRemainingMs）
    await updateWhere(idle, (snapshot) => isAuto(snapshot) && actedBy(snapshot, idleSeat));

    expect((await call<void>((ack) => idle.emit("room:auto", false, ack))).ok).toBe(true);
    await updateWhere(idle, (snapshot) => !isAuto(snapshot));
    stop();
  }, 30_000);

  it("掉线的人轮到时由人机代打（不算超时），用原昵称回来后交还", async () => {
    const leaver = await connect();
    const stayer = await connect();
    const leaverName = nick("掉线");
    const { code } = await create(leaver, leaverName, MIN_CAPACITY);
    expect((await call<LobbyRoomSnapshot>((ack) => stayer.emit("room:join", { name: nick("留下"), code }, ack))).ok).toBe(true);
    await addBotsUpTo(leaver, 2);
    const started = await start(leaver);
    if (!started.ok) throw new Error(started.error);
    const leaverSeat = started.data.members.find((member) => member.id === leaver.id)!.playerId;
    const stop = autoplay(stayer);
    leaver.disconnect();

    const played = await updateWhere(stayer, (snapshot) => actedBy(snapshot, leaverSeat));
    expect(timedOut(played, leaverSeat)).toBe(false);
    expect(played.members.find((member) => member.playerId === leaverSeat)).toMatchObject({ connected: false });

    const back = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => back.emit("room:join", { name: leaverName, code }, ack));
    expect(rejoined.ok && rejoined.data.members.find((member) => member.id === back.id)).toMatchObject({ playerId: leaverSeat, connected: true });
    stop();
  }, 30_000);
});
