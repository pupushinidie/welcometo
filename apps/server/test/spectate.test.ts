import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  fallbackSubmission,
  type AckResponse,
  type Capacity,
  type ClientToServerEvents,
  type GameState,
  type JoinRoomPayload,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type RoomAccess,
  type ServerToClientEvents,
} from "@welcometo/game";

// ---------- 每款游戏不一样的地方 ----------
/** 最小的房间人数（对局要坐满才开始测）。 */
const CAPACITY: Capacity = 2;
/** 这款游戏有没有藏起来的信息：这回合交了什么（结算前）、牌堆顺序。 */
const HIDDEN_INFO = true;
/** 开局后先走几步（每步让一个还没交的人交兜底的一手），让场上有藏起来的东西：第一个人交了（还没结算）。 */
const STEPS = 1;
/** 只在服务端的字段（种子、随机数状态、动作序列），观战的人永远拿不到；牌堆顺序单独查。 */
const SERVER_ONLY = ["seed", "rngState", "log"];
/** 这份状态里看得到几样藏起来的东西：交了还没结算的那一手 + 牌堆里没翻的牌。 */
function secretsSeen(game: GameState): number {
  return game.players.reduce((total, player) => total + (player.pending !== null ? 1 : 0), 0)
    + game.stacks.reduce((total, stack) => total + stack.draw.length, 0);
}
/** 这个人现在能做的一个动作（没交就交兜底的一手）。 */
function legalActions(game: GameState, seat: string): { type: "submit"; submission: ReturnType<typeof fallbackSubmission> }[] {
  const me = game.players.find((player) => player.id === seat);
  if (!me || me.submitted || game.phase !== "play") return [];
  // 网页拿到的状态没有牌堆，兜底的一手只看自己的表和 3 组，照样算得出
  return [{ type: "submit", submission: fallbackSubmission(game, seat) }];
}
// ----------------------------------------

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
let nameSeq = 0;

/** session：模拟网关转来的 X-GC-Session（同一次登录的几个窗口）。 */
function connect(session?: string): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: session ? { "x-gc-session": session } : {},
    });
    clients.add(client);
    client.on("room:updated", (room) => latest.set(client, room));
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

/** 每次都不一样的昵称（2–18 个字符）。 */
function nick(prefix: string): string {
  nameSeq += 1;
  return `${prefix}${nameSeq}`;
}

function create(client: TestSocket, name: string): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => client.emit("room:create", { name, capacity: CAPACITY } as never, (response: AckResponse<LobbyRoomSnapshot>) => {
    if (response.ok) resolve(response.data);
    else reject(new Error(response.error));
  }));
}

function join(client: TestSocket, payload: JoinRoomPayload): Promise<AckResponse<LobbyRoomSnapshot>> {
  return new Promise((resolve) => client.emit("room:join", payload, resolve));
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

function access(client: TestSocket, value: Partial<RoomAccess>): Promise<AckResponse<void>> {
  return call((ack) => client.emit("room:access", value, ack));
}

function lobby(client: TestSocket): Promise<PublicRoomSummary[]> {
  return new Promise((resolve) => client.emit("lobby:get", (response) => resolve(response.ok ? response.data : [])));
}

/** 等到满足条件的那次房间更新（前面的操作可能还有更新在路上）。 */
function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve) => {
    const current = latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

function closed(client: TestSocket): Promise<string> {
  return new Promise((resolve) => client.once("room:closed", ({ reason }) => resolve(reason)));
}

/** 服务端字段发到前端时要么去掉，要么换成空数组。 */
function hiddenField(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

function seatOf(client: TestSocket): string {
  return latest.get(client)?.members.find((member) => member.id === client.id)?.playerId ?? "";
}

/** 用房间码把座位坐满，返回新加入的玩家。 */
async function fillSeats(code: string, seated: number): Promise<TestSocket[]> {
  const added: TestSocket[] = [];
  for (let seat = seated; seat < CAPACITY; seat += 1) {
    const client = await connect();
    expect((await join(client, { name: nick("玩家"), code })).ok).toBe(true);
    added.push(client);
  }
  return added;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("观战和公开房间", () => {
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

  it("新房间默认可观战、不公开；陌生人从列表只能观战，房主打开公开后才能坐下", async () => {
    const host = await connect();
    const hostName = nick("房主");
    const room = await create(host, hostName);
    expect(room.access).toEqual({ allowSpectators: true, spectatorsSeeAll: false, open: false });

    const stranger = await connect();
    const strangerName = nick("路人");
    const summary = (await lobby(stranger)).find((candidate) => candidate.players[0]?.name === hostName)!;
    expect(summary.open).toBe(false);
    expect(summary.allowSpectators).toBe(true);

    expect((await join(stranger, { name: strangerName, roomId: summary.id })).ok).toBe(false);

    const watching = await join(stranger, { name: strangerName, roomId: summary.id, spectate: true });
    expect(watching.ok && watching.data.spectators.map((spectator) => spectator.name)).toEqual([strangerName]);
    // 从列表进来的看不到房间码，邀请制房间也不能坐下。
    expect(watching.ok && watching.data.code).toBe("");
    expect((await call<void>((ack) => stranger.emit("room:sit", ack))).ok).toBe(false);
    expect((await lobby(await connect())).find((candidate) => candidate.id === summary.id)?.spectators).toBe(1);

    // 观战的人不能开语音；能聊天，带「观战」标记。
    expect((await call<unknown>((ack) => stranger.emit("voice:join", { muted: true }, ack as never))).ok).toBe(false);
    const chatSeen = updateWhere(host, (snapshot) => snapshot.chat.some((entry) => entry.message === "加油"));
    expect((await call<void>((ack) => stranger.emit("room:chat", { message: "加油" }, ack))).ok).toBe(true);
    expect((await chatSeen).chat.at(-1)).toMatchObject({ name: strangerName, spectator: true });

    // 不是房主不能改设置；房主打开公开后，观战的人可以坐下。
    expect((await access(stranger, { open: true })).ok).toBe(false);
    expect((await access(host, { open: true })).ok).toBe(true);
    const seated = updateWhere(host, (snapshot) => snapshot.members.some((member) => member.name === strangerName));
    expect((await call<void>((ack) => stranger.emit("room:sit", ack))).ok).toBe(true);
    expect((await seated).spectators).toEqual([]);

    // 坐满后列表加入会被拒；改回观战后空出座位，第三个人能从列表加入。
    await fillSeats(room.code, 2);
    const third = await connect();
    const thirdName = nick("路人");
    expect((await join(third, { name: thirdName, roomId: summary.id })).ok).toBe(false);
    expect((await call<void>((ack) => stranger.emit("room:stand", ack))).ok).toBe(true);
    const joined = await join(third, { name: thirdName, roomId: summary.id });
    expect(joined.ok && joined.data.members.some((member) => member.name === thirdName)).toBe(true);
  });

  it("对局中观战默认只看公开信息，房主打开「看手牌」后能看到；不能操作，随时能离开", async () => {
    const host = await connect();
    const room = await create(host, nick("玩家"));
    const players = [host, ...(await fillSeats(room.code, 1))];
    const viewer = await connect();
    const invited = await join(viewer, { name: nick("看客"), code: room.code, spectate: true });
    expect(invited.ok && invited.data.code).toBe(room.code);

    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);
    await updateWhere(viewer, (snapshot) => snapshot.game !== undefined);
    for (const client of players) await updateWhere(client, (snapshot) => snapshot.game !== undefined);

    // 先走几步，让场上有藏起来的牌。
    for (let step = 0; step < STEPS; step += 1) {
      const mover = players.find((client) => legalActions(latest.get(client)!.game!, seatOf(client)).length > 0);
      if (!mover) break;
      const action = legalActions(latest.get(mover)!.game!, seatOf(mover))[0]!;
      const version = latest.get(viewer)!.game!.version;
      expect((await call<LobbyRoomSnapshot>((ack) => mover.emit("game:command", action, ack))).ok).toBe(true);
      await updateWhere(viewer, (snapshot) => snapshot.game!.version !== version);
      await delay(20);
    }

    const blind = latest.get(viewer)!.game!;
    for (const key of SERVER_ONLY) expect(hiddenField((blind as unknown as Record<string, unknown>)[key])).toBe(true);
    // 每位玩家自己看到的那一份里，自己身上的秘密。
    const owners = players.reduce((total, client) => {
      const game = latest.get(client)!.game!;
      return total + secretsSeen({ ...game, players: game.players.filter((player) => player.id === seatOf(client)) });
    }, 0);
    if (HIDDEN_INFO) {
      expect(owners).toBeGreaterThan(0);
      expect(secretsSeen(blind)).toBeLessThan(owners);
    }

    // 对局中不能再打开「观战看手牌」（首发验收 I8），观战的人照样只有公开信息
    const refused = await access(host, { spectatorsSeeAll: true });
    expect(refused.ok).toBe(false);
    expect(latest.get(host)!.access.spectatorsSeeAll).toBe(false);
    expect(secretsSeen(latest.get(viewer)!.game!)).toBe(0);

    // 观战的人发动作会被拒。
    const anyAction = players.map((client) => legalActions(latest.get(client)!.game!, seatOf(client))[0]).find(Boolean);
    if (anyAction) {
      expect((await call<LobbyRoomSnapshot>((ack) => viewer.emit("game:command", anyAction, ack))).ok).toBe(false);
    }
    // 对局中玩家不能改成观战；观战的人随时能离开。
    expect((await call<void>((ack) => players[1]!.emit("room:stand", ack))).ok).toBe(false);
    expect((await call<void>((ack) => viewer.emit("room:leave", ack))).ok).toBe(true);
  });

  it("「观战看全部」在等候房间打开：表本来就公开，交了还没结算的那一手和牌堆仍然看不到；对局中能关不能开", async () => {
    const host = await connect();
    const room = await create(host, nick("玩家"));
    expect((await access(host, { spectatorsSeeAll: true })).ok).toBe(true);
    const players = [host, ...(await fillSeats(room.code, 1))];
    const viewer = await connect();
    expect((await join(viewer, { name: nick("看客"), code: room.code, spectate: true })).ok).toBe(true);
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);
    for (const client of [viewer, ...players]) await updateWhere(client, (snapshot) => snapshot.game !== undefined);

    // 第一位玩家交了一手（还没结算）
    const mover = players[0]!;
    const before = latest.get(viewer)!.game!.version;
    const submission = fallbackSubmission(latest.get(mover)!.game!, seatOf(mover));
    expect((await call<LobbyRoomSnapshot>((ack) => mover.emit("game:command", { type: "submit", submission }, ack))).ok).toBe(true);
    const god = (await updateWhere(viewer, (snapshot) => snapshot.game!.version !== before)).game!;
    for (const key of SERVER_ONLY) expect(hiddenField((god as unknown as Record<string, unknown>)[key])).toBe(true);
    // 表都公开、和玩家自己看到的一样；交了什么、牌堆顺序都看不到
    for (const client of players) {
      const own = latest.get(client)!.game!.players.find((player) => player.id === seatOf(client))!;
      expect(god.players.find((player) => player.id === own.id)!.sheet).toEqual(own.sheet);
    }
    expect(god.players.find((player) => player.id === seatOf(mover))!.submitted).toBe(true);
    expect(secretsSeen(god)).toBe(0);

    // 对局中可以关掉；关掉后不能再开
    expect((await access(host, { spectatorsSeeAll: false })).ok).toBe(true);
    const blind = (await updateWhere(viewer, (snapshot) => !snapshot.access.spectatorsSeeAll)).game!;
    expect(secretsSeen(blind)).toBe(0);
    expect((await access(host, { spectatorsSeeAll: true })).ok).toBe(false);
  });

  it("同一次登录不能在同一桌既坐着又观战（另开窗口看牌）", async () => {
    const host = await connect("login-host");
    const hostName = nick("玩家");
    const room = await create(host, hostName);
    expect((await access(host, { spectatorsSeeAll: true, open: true })).ok).toBe(true);
    const second = await connect("login-host");
    const summary = (await lobby(second)).find((candidate) => candidate.players.some((player) => player.name === hostName));
    // 按房间码、按列表都进不来观战
    const byCode = await join(second, { name: nick("小号"), code: room.code, spectate: true });
    expect(byCode.ok).toBe(false);
    expect(summary).toBeDefined();
    expect((await join(second, { name: nick("小号"), roomId: summary!.id, spectate: true })).ok).toBe(false);

    // 别的登录可以观战；观战的窗口所在的登录不能再坐下 / 加入
    const otherWatcher = await connect("login-watch");
    const watchName = nick("看客");
    expect((await join(otherWatcher, { name: watchName, code: room.code, spectate: true })).ok).toBe(true);
    const sameLogin = await connect("login-watch");
    expect((await join(sameLogin, { name: nick("玩家"), code: room.code })).ok).toBe(false);
    // 换一个登录就能正常坐下
    const fresh = await connect("login-fresh");
    expect((await join(fresh, { name: nick("玩家"), code: room.code })).ok).toBe(true);
  });

  it("房主关闭观战会把观战的人请出去；房间解散时观战的人也会收到通知", async () => {
    const host = await connect();
    const room = await create(host, nick("玩家"));
    const viewer = await connect();
    const viewerName = nick("看客");
    expect((await join(viewer, { name: viewerName, code: room.code, spectate: true })).ok).toBe(true);
    const kicked = closed(viewer);
    expect((await access(host, { allowSpectators: false })).ok).toBe(true);
    expect(await kicked).toContain("关闭了观战");
    expect((await join(viewer, { name: viewerName, code: room.code, spectate: true })).ok).toBe(false);

    expect((await access(host, { allowSpectators: true })).ok).toBe(true);
    expect((await join(viewer, { name: viewerName, code: room.code, spectate: true })).ok).toBe(true);
    const dissolved = closed(viewer);
    expect((await call<void>((ack) => host.emit("room:dissolve", ack))).ok).toBe(true);
    expect(await dissolved).toContain("解散");
  });

  it("同名的人不能同时在房间里（座位和观战一起算）", async () => {
    const host = await connect();
    const hostName = nick("玩家");
    const room = await create(host, hostName);
    const viewer = await connect();
    expect((await join(viewer, { name: hostName, code: room.code, spectate: true })).ok).toBe(false);
  });
});
