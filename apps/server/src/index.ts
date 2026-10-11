import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "socket.io";
import {
  animationMs,
  applyCommand,
  botCommand,
  checkSubmission,
  fallbackSubmission,
  scoreAll,
  CAPACITY_OPTIONS,
  createGame,
  DEFAULT_ROOM_ACCESS,
  redactGameForSpectator,
  redactGameForViewer,
  stepKey,
  timeoutTurn,
  waitingFor,
  type Capacity,
  type GameCommand,
  type Submission,
  type TimeoutPolicy,
  type ClientToServerEvents,
  type IceServerConfig,
  type CreateRoomPayload,
  type GameState,
  type JoinRoomPayload,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type RoomAccess,
  type RoomChatMessage,
  type ServerToClientEvents,
  type Spectator,
  type VoiceSignal,
} from "@welcometo/game";

interface RoomState {
  code: string;
  /** 对外展示用的随机标识，不泄露房间码。 */
  publicId: string;
  capacity: Capacity;
  status: "waiting" | "playing";
  ownerId: string;
  members: LobbyMember[];
  /** 观战的人：不占座位，离开或断线就移出。 */
  spectators: Spectator[];
  /** 拿房间码进来（或者本来坐着改成观战）的观战者：看得到房间码，也能坐下。从列表进来的只有公开房间才能坐下。 */
  invited: Set<string>;
  access: RoomAccess;
  chat: RoomChatMessage[];
  game?: GameState;
  /** 下一位加入者的座位编号；座位 id 在对局里固定，断线重连只换连接 id。 */
  nextSeat: number;
  /** 对局中所有玩家都离线时启动的关闭计时器。 */
  abandonTimer?: ReturnType<typeof setTimeout>;
  /** 在语音里的成员及其是否静音。 */
  voice: Map<string, { muted: boolean }>;
  /** 整轮结束后的继续投票。 */
  rematch?: { deadline: number; accepted: Set<string>; timer: ReturnType<typeof setTimeout> };
  /**
   * 当前这一步（选牌 / 规则 C 选排 / 局末）的截止时间，到点由系统代做（timeoutTurn）。
   * key 是 stepKey(game)：只在换回合时变，别人交 / 撤回不会重置倒计时。
   */
  turn?: { deadline: number; timer: ReturnType<typeof setTimeout>; key: string };
  /** 人机座位、托管、离线的人各自的下一步计时器（座位 id → 计时器）；key 同 turn。选牌是大家同时做的，所以每个座位一个。 */
  botTimers: Map<string, { timer: ReturnType<typeof setTimeout>; key: string }>;
  /** 每位真人连续超时的次数（座位 id → 次数）；自己动一下就清零，到 AUTO_AFTER_TIMEOUTS 次转托管。 */
  timeouts: Map<string, number>;
  /** 座位 id → 坐这个座位的那次登录（X-GC-Session）。同一次登录不能在同一桌既坐着又观战（首发验收 I8）。没有网关时为空。 */
  seatSessions: Map<string, string>;
}

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const ROOM_CHAT_LIMIT = 100;
const ROOM_CHAT_MAX_LENGTH = 200;
const ROOM_CHAT_RATE_LIMIT_MS = 1_000;
/** 每个连接每秒最多发这么多个对局动作（防止刷动作把服务器拖垮）。 */
const COMMAND_RATE_LIMIT = 20;
const ROOM_ABANDON_MS = Number(process.env.ROOM_ABANDON_MS ?? 2 * 60_000);
const REMATCH_TIMEOUT_MS = Number(process.env.REMATCH_TIMEOUT_MS ?? 60_000);
const ADMIN_RETRY_DELAY_MS = 2_000;
const VOICE_SIGNAL_MAX_LENGTH = 20_000;
const MAX_SPECTATORS = 20;
/** 每一步的计时（毫秒）；默认用规则里的 stepTimeoutSec，测试时可以用环境变量缩短。 */
const TURN_MS_OVERRIDE = process.env.TURN_MS ? Number(process.env.TURN_MS) : undefined;
/** 人机的名字，按顺序取第一个没人用的（最多 10 座，排到九号）。 */
const BOT_NAMES = ["咕噜一号", "咕噜二号", "咕噜三号", "咕噜四号", "咕噜五号", "咕噜六号", "咕噜七号", "咕噜八号", "咕噜九号"];
/** 人机每一步的停顿乘上这个倍数；测试时设成 0 让人机立刻行动。 */
const BOT_DELAY_SCALE = Number(process.env.BOT_DELAY_SCALE ?? 1);
/** 离线的人轮到时先等这么久再由人机代打（刷新页面、短暂断线的人来得及回来）。 */
const OFFLINE_GRACE_MS = 3_000;
/** 连续超时几次转托管。 */
const AUTO_AFTER_TIMEOUTS = 2;
/**
 * 超时代做（补充文件第四节：超时由人机代为决策）：没交的人由正式人机（botCommand）替他交这一手，
 * 人机出错或给了不合法的一手时引擎退回兜底的一手（fallbackSubmission）。连续 2 次超时转托管。
 */
const timeoutPolicy: TimeoutPolicy = (view, playerId) => botCommand(view, playerId);
/** 每局结束后把种子和动作序列追加到这里，便于复盘。 */
const GAME_LOG = process.env.GAME_LOG ?? resolve(process.cwd(), "logs/games.jsonl");
const TURN_CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;
const rooms = new Map<string, RoomState>();
const socketRooms = new Map<string, string>();
const roomChatTimes = new Map<string, number>();
/** 每个连接这一秒发了几个对局动作。 */
const commandCounts = new Map<string, { second: number; count: number }>();
const adminFailureTimes = new Map<string, number>();

export const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "welcometo-server" }));
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

/** 本地开发时网页的端口（和 vite 的 WEB_PORT 一致，默认 5298）。 */
const DEV_WEB_PORT = process.env.WEB_PORT ?? "5298";

const configuredWebOrigins = new Set(
  (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? `http://localhost:${DEV_WEB_PORT}`)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return first === 10 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31;
}

function isAllowedWebOrigin(origin: string | undefined): boolean {
  if (!origin || configuredWebOrigins.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:"
      && parsed.port === DEV_WEB_PORT
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || isPrivateIpv4(parsed.hostname));
  } catch {
    return false;
  }
}

export const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedWebOrigin(origin)),
    methods: ["GET", "POST"],
  },
});

/**
 * 看不见、或者会改变文字方向的字符：软连字符、零宽空格 / 连接符、方向标记和覆盖（LRO/RLO 等）、隔离符、BOM、
 * 变体选择符、韩文填充符等。昵称和聊天里一律去掉（首发验收 I10：能用它们做出看起来一样的名字、倒着显示的字）。
 */
const INVISIBLE_CHARS = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
/** 人机的名字（咕噜一号…九号这一类）留给人机，真人不能用。 */
const BOT_NAME_PATTERN = /^咕噜.{1,3}号$/;

function normalizeChatMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.replace(INVISIBLE_CHARS, "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().replace(/\s+/g, " ");
  return message.length >= 1 && message.length <= ROOM_CHAT_MAX_LENGTH ? message : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(INVISIBLE_CHARS, "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 18 ? name : null;
}

function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "");
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

function isCapacity(value: unknown): value is Capacity {
  return (CAPACITY_OPTIONS as readonly unknown[]).includes(value);
}

function generateRoomCode(): string {
  return Array.from({ length: ROOM_CODE_LENGTH }, () =>
    ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)],
  ).join("");
}

function snapshot(room: RoomState, viewerId: string): LobbyRoomSnapshot {
  const seated = room.members.some((member) => member.id === viewerId);
  return {
    code: seated || room.invited.has(viewerId) ? room.code : "",
    spectators: room.spectators.map((spectator) => ({ ...spectator })),
    access: { ...room.access },
    capacity: room.capacity,
    status: room.status,
    members: room.members.map((member) => ({ ...member })),
    chat: room.chat.map((entry) => ({ ...entry })),
    voice: [...room.voice].map(([id, state]) => ({ id, muted: state.muted })),
    ...(room.turn ? { turnRemainingMs: Math.max(0, room.turn.deadline - Date.now()) } : {}),
    ...(room.rematch ? { rematch: { remainingMs: Math.max(0, room.rematch.deadline - Date.now()), acceptedIds: [...room.rematch.accepted] } } : {}),
    ...(room.game ? { game: seated ? redactGameForViewer(room.game, seatOf(room, viewerId)) : spectatorGame(room) } : {}),
  };
}

/** 观战的人看到的对局：默认谁的手牌和已选的牌都看不到；房主打开「观战看手牌」后都看得到。没发的牌、种子永远不给。 */
function spectatorGame(room: RoomState): GameState {
  return redactGameForSpectator(room.game!, room.access.spectatorsSeeAll);
}

function isSpectator(room: RoomState, socketId: string): boolean {
  return room.spectators.some((spectator) => spectator.id === socketId);
}

function nameTaken(room: RoomState, name: string): boolean {
  return room.members.some((member) => member.name === name) || room.spectators.some((spectator) => spectator.name === name);
}

function seatOf(room: RoomState, memberId: string): string {
  return room.members.find((member) => member.id === memberId)?.playerId ?? "";
}

/** 真人玩家（不含人机）。房间里没有真人就关掉，房主也只交给真人。 */
function humans(room: RoomState): LobbyMember[] {
  return room.members.filter((member) => !member.bot);
}

/** 这个座位由人机行动：人机座位、托管、离线的人。 */
function robotSeat(room: RoomState, playerId: string): boolean {
  const member = room.members.find((candidate) => candidate.playerId === playerId);
  return !member || member.bot === true || member.auto === true || !member.connected;
}

function setAuto(room: RoomState, playerId: string, enabled: boolean): void {
  room.members = room.members.map((member) => {
    if (member.playerId !== playerId) return member;
    const { auto: _auto, ...rest } = member;
    return enabled ? { ...rest, auto: true } : rest;
  });
}

function roomSummaries(): PublicRoomSummary[] {
  const order = { playing: 0, waiting: 1, finished: 2 } as const;
  return [...rooms.values()]
    .map((room): PublicRoomSummary => {
      const game = room.game;
      const status = room.status === "waiting" ? "waiting" : game?.phase === "gameOver" ? "finished" : "playing";
      const waiting = game ? waitingFor(game) : [];
      const scores = game ? (game.finalResult?.scores ?? scoreAll(game)) : {};
      return {
        id: room.publicId,
        status,
        capacity: room.capacity,
            open: room.access.open,
        allowSpectators: room.access.allowSpectators,
        spectators: room.spectators.length,
        players: room.members.map((member) => {
          const player = game?.players.find((candidate) => candidate.id === member.playerId);
          return {
            name: member.name,
            isHost: member.isHost,
            connected: member.connected,
            ...(member.bot ? { bot: true } : {}),
            ...(player ? {
              score: scores[player.id]?.total ?? 0,
              isActive: waiting.includes(player.id),
              isWinner: game!.finalResult?.winners.includes(player.id) === true,
            } : {}),
          };
        }),
      };
    })
    .sort((left, right) => order[left.status] - order[right.status]);
}

/** 「在线牌桌」列表最多每秒推送一次，期间的变化合并到下一次。 */
const LOBBY_UPDATE_INTERVAL_MS = 1_000;
let lobbyUpdateTimer: ReturnType<typeof setTimeout> | undefined;
let lobbyUpdatePending = false;

/** 只推送给停留在首页（不在任何房间里）的连接；房间里的玩家看不到这个列表。 */
function sendLobbyUpdate(): void {
  const summaries = roomSummaries();
  for (const [socketId, client] of io.sockets.sockets) {
    if (!socketRooms.has(socketId)) client.emit("lobby:updated", summaries);
  }
}

function emitLobbyUpdate(): void {
  if (lobbyUpdateTimer) {
    lobbyUpdatePending = true;
    return;
  }
  sendLobbyUpdate();
  const flush = () => {
    if (!lobbyUpdatePending) {
      lobbyUpdateTimer = undefined;
      return;
    }
    lobbyUpdatePending = false;
    sendLobbyUpdate();
    lobbyUpdateTimer = setTimeout(flush, LOBBY_UPDATE_INTERVAL_MS);
    lobbyUpdateTimer.unref();
  };
  lobbyUpdateTimer = setTimeout(flush, LOBBY_UPDATE_INTERVAL_MS);
  lobbyUpdateTimer.unref();
}

function emitRoomUpdate(room: RoomState): void {
  // 每位成员单独发送（各自的座位视角）。
  for (const member of room.members) {
    io.to(member.id).emit("room:updated", snapshot(room, member.id));
  }
  for (const spectator of room.spectators) io.to(spectator.id).emit("room:updated", snapshot(room, spectator.id));
  emitLobbyUpdate();
}

function findRoomForSocket(socketId: string): RoomState | undefined {
  const code = socketRooms.get(socketId);
  return code ? rooms.get(code) : undefined;
}

function removeWaitingMember(socketId: string): void {
  const code = socketRooms.get(socketId);
  if (!code) return;
  socketRooms.delete(socketId);
  rooms.get(code)?.voice.delete(socketId);

  const room = rooms.get(code);
  if (!room) return;
  if (isSpectator(room, socketId)) {
    room.spectators = room.spectators.filter((spectator) => spectator.id !== socketId);
    room.invited.delete(socketId);
    emitRoomUpdate(room);
    return;
  }
  if (room.status === "playing") {
    room.members = room.members.map((member) =>
      member.id === socketId ? { ...member, connected: false } : member,
    );
    if (humans(room).every((member) => !member.connected)) scheduleAbandonedRoomClose(room);
    // 轮到的是这个人的话，改由人机代打
    updateTurnTimer(room);
    emitRoomUpdate(room);
    return;
  }

  room.members = room.members.filter((member) => member.id !== socketId);
  if (humans(room).length === 0) {
    deleteRoom(room, "玩家都离开了，房间已关闭。");
    return;
  }
  if (room.ownerId === socketId) {
    room.ownerId = humans(room)[0]!.id;
    room.members = room.members.map((member) => ({
      ...member,
      isHost: member.id === room.ownerId,
    }));
  }
  emitRoomUpdate(room);
}

/** 所有玩家离线满 ROOM_ABANDON_MS 后关闭房间；期间有人重新加入则取消。 */
function scheduleAbandonedRoomClose(room: RoomState): void {
  clearTimeout(room.abandonTimer);
  room.abandonTimer = setTimeout(() => {
    if (rooms.get(room.code) !== room || humans(room).some((member) => member.connected)) return;
    deleteRoom(room, "玩家都离线了，房间已关闭。");
  }, ROOM_ABANDON_MS);
  room.abandonTimer.unref();
}

/** 通知某个连接已被移出房间，并断开它和房间的关联。 */
function closeMemberConnection(room: RoomState, memberId: string, reason: string): void {
  socketRooms.delete(memberId);
  const memberSocket = io.sockets.sockets.get(memberId);
  if (!memberSocket) return;
  void memberSocket.leave(room.code);
  memberSocket.emit("room:closed", { reason });
}

/** 删除房间；还在看的观战者会收到 reason。 */
function deleteRoom(room: RoomState, reason = "房间已关闭。"): void {
  for (const spectator of room.spectators) closeMemberConnection(room, spectator.id, reason);
  room.spectators = [];
  clearTimeout(room.abandonTimer);
  clearGameTimers(room);
  clearTimeout(room.rematch?.timer);
  for (const member of room.members) socketRooms.delete(member.id);
  rooms.delete(room.code);
  emitLobbyUpdate();
}

function dissolveRoom(room: RoomState, reason: string): void {
  for (const member of room.members) closeMemberConnection(room, member.id, reason);
  deleteRoom(room, reason);
}

/** 移出成员并在需要时转移房主；房间空了就删除。返回房间是否还在。 */
function removeMembers(room: RoomState, memberIds: string[], reason: string): boolean {
  for (const memberId of memberIds) closeMemberConnection(room, memberId, reason);
  for (const memberId of memberIds) room.voice.delete(memberId);
  room.members = room.members.filter((member) => !memberIds.includes(member.id));
  if (humans(room).length === 0) {
    deleteRoom(room);
    return false;
  }
  if (!room.members.some((member) => member.id === room.ownerId)) room.ownerId = humans(room)[0]!.id;
  room.members = room.members.map((member) => ({ ...member, isHost: member.id === room.ownerId }));
  return true;
}

/** 有人拒绝或超时：移出这些人和已离线的人，其余玩家回到等待大厅。 */
function returnToWaiting(room: RoomState, kickedIds: string[], reason: string): void {
  clearTimeout(room.rematch?.timer);
  delete room.rematch;
  clearTimeout(room.abandonTimer);
  delete room.abandonTimer;
  const offlineIds = room.members.filter((member) => !member.connected && !kickedIds.includes(member.id)).map((member) => member.id);
  if (!removeMembers(room, [...kickedIds, ...offlineIds], reason)) return;
  room.status = "waiting";
  clearGameTimers(room);
  delete room.game;
  // 回到等候房间：托管标记和超时次数清掉（等候时不能取消托管）
  for (const member of room.members) setAuto(room, member.playerId, false);
  room.timeouts.clear();
  emitRoomUpdate(room);
}

function clearTurnTimer(room: RoomState): void {
  clearTimeout(room.turn?.timer);
  delete room.turn;
}

function clearBotTimers(room: RoomState): void {
  for (const entry of room.botTimers.values()) clearTimeout(entry.timer);
  room.botTimers.clear();
}

function clearGameTimers(room: RoomState): void {
  clearTurnTimer(room);
  clearBotTimers(room);
}

function setTurnDeadline(room: RoomState, deadline: number, key: string): void {
  clearTurnTimer(room);
  const timer = setTimeout(() => expireTurn(room, key), Math.max(0, deadline - Date.now()));
  timer.unref();
  room.turn = { deadline, timer, key };
}

/** 这一回合的限时（毫秒）：开工拍板 90 秒，加上上一回合的结算动画。测试用 TURN_MS 覆盖。 */
function stepMs(game: GameState): number {
  if (TURN_MS_OVERRIDE !== undefined) return TURN_MS_OVERRIDE;
  return game.config.turnSec * 1000 + animationMs(game.events);
}

/**
 * 每次对局变化、有人掉线 / 回来、托管开关后重新安排：
 * - 每一步一个截止时间（key = stepKey），选牌时大家共用；换了 key 才重新计时，所以别人选牌 / 撤回不会重置倒计时；
 * - 要做决定的人里，人机座位、托管、离线的人各排一个计时器，停顿一下（见 botDelay）由人机替他做；
 *   已经不用他做（选好了、key 变了、人回来了）的计时器取消。
 */
function updateTurnTimer(room: RoomState): void {
  const game = room.game;
  if (!game || game.phase === "gameOver") {
    clearGameTimers(room);
    return;
  }
  const key = stepKey(game);
  if (room.turn?.key !== key) setTurnDeadline(room, Date.now() + stepMs(game), key);
  const waiting = new Set(waitingFor(game));
  for (const [playerId, entry] of room.botTimers) {
    if (entry.key === key && waiting.has(playerId) && robotSeat(room, playerId)) continue;
    clearTimeout(entry.timer);
    room.botTimers.delete(playerId);
  }
  for (const playerId of waiting) {
    if (!robotSeat(room, playerId) || room.botTimers.has(playerId)) continue;
    const timer = setTimeout(() => runBot(room, playerId, key), botDelay(room, game, playerId));
    timer.unref();
    room.botTimers.set(playerId, { timer, key });
  }
}

/** 人机每一步前停多久：先等这一步的结算动画放完，再「想」一会儿；离线的人至少等 3 秒（来得及刷新回来）。 */
function botDelay(room: RoomState, game: GameState, playerId: string): number {
  const think = 2500 + 3500 * Math.random();
  let ms = animationMs(game.events) + think;
  const member = room.members.find((candidate) => candidate.playerId === playerId);
  // 离线的真人：等够 3 秒（来得及刷新回来）就由人机替他交，不再额外「想」
  if (member && !member.bot && !member.connected) ms = animationMs(game.events) + OFFLINE_GRACE_MS;
  return ms * BOT_DELAY_SCALE;
}

function runBot(room: RoomState, playerId: string, key: string): void {
  if (room.botTimers.get(playerId)?.key === key) room.botTimers.delete(playerId);
  const game = room.game;
  if (rooms.get(room.code) !== room || !game || game.phase === "gameOver" || stepKey(game) !== key) return;
  if (!waitingFor(game).includes(playerId) || !robotSeat(room, playerId)) return;
  const view = redactGameForViewer(game, playerId);
  let submission: Submission | null = null;
  try {
    submission = botCommand(view, playerId);
  } catch (error) {
    console.error("人机出错，改用兜底的一手", error);
  }
  // 人机没给、或者给了不合法的一手：交兜底的一手（能填就填最左、不能填就拒批），保证不卡住
  if (!submission || checkSubmission(game, playerId, submission) !== null) submission = fallbackSubmission(game, playerId);
  const command: GameCommand = { type: "submit", submission };
  // 托管、离线的真人由人机代打：标成代做（结算记录里标 auto）；人机座位自己的动作不标
  const member = room.members.find((candidate) => candidate.playerId === playerId);
  try {
    room.game = applyCommand(game, playerId, command, { auto: member?.bot !== true });
  } catch (error) {
    console.error("人机行动失败", error);
    return;
  }
  afterGameChange(room);
  emitRoomUpdate(room);
}

/** 这一步到点：还没做决定的人由系统按 timeoutPolicy 代做。选牌和选排超时的真人记一次超时，连续 2 次转托管（局末没点「继续」不算）。 */
function expireTurn(room: RoomState, key: string): void {
  const game = room.game;
  if (rooms.get(room.code) !== room || !game || game.phase === "gameOver" || stepKey(game) !== key) return;
  delete room.turn;
  {
    for (const playerId of waitingFor(game)) {
      if (robotSeat(room, playerId)) continue;
      const count = (room.timeouts.get(playerId) ?? 0) + 1;
      room.timeouts.set(playerId, count);
      if (count >= AUTO_AFTER_TIMEOUTS) setAuto(room, playerId, true);
    }
  }
  try {
    room.game = timeoutTurn(game, timeoutPolicy);
  } catch (error) {
    // 换了超时策略出错时退回基线，不能让计时器回调把整个进程弄挂
    console.error("超时代做出错，改用基线", error);
    try {
      room.game = timeoutTurn(game);
    } catch (fallbackError) {
      console.error("基线超时代做也出错", fallbackError);
      return;
    }
  }
  afterGameChange(room);
  emitRoomUpdate(room);
}

/** 对局状态变化后：结束则清空聊天并发起继续投票，否则更新回合计时。 */
function afterGameChange(room: RoomState): void {
  if (room.game?.phase === "gameOver") {
    clearGameTimers(room);
    room.chat = [];
    void logFinishedGame(room.game);
    startRematchVote(room);
    return;
  }
  updateTurnTimer(room);
}

/**
 * 种子是服务端 crypto 生成的 256 位密钥，引擎用 ChaCha20 洗牌（见 packages/game/src/rng.ts）。
 * 以前是 32 位种子 + mulberry32，玩家看自己的 10 张牌和 4 个排头就能穷举出种子、算出所有人的手牌（首发验收 I7）。
 * 种子只在服务端（不下发），对局结束写进 logs/games.jsonl 方便复盘。新的一场托管和超时次数都清零。
 */
function newGame(room: RoomState, seed: number | string = randomBytes(32).toString("hex")): GameState {
  for (const member of room.members) setAuto(room, member.playerId, false);
  room.timeouts.clear();
  clearGameTimers(room);
  return createGame(room.members.map((member) => ({ id: member.playerId, name: member.name })), seed);
}

/** 记录一局的种子、玩家和动作序列，同一种子重放这串动作就能复现整局。 */
async function logFinishedGame(game: GameState): Promise<void> {
  try {
    await mkdir(dirname(GAME_LOG), { recursive: true });
    const entry = {
      endedAt: new Date().toISOString(),
      seed: game.seed,
      players: game.players.map((player) => ({ id: player.id, name: player.name, total: game.finalResult?.scores[player.id]?.total })),
      winners: game.finalResult?.winners,
      log: game.log,
    };
    await appendFile(GAME_LOG, JSON.stringify(entry) + "\n");
  } catch (error) {
    console.error("写对局记录失败", error);
  }
}

/** 整轮结束：所有人需在 REMATCH_TIMEOUT_MS 内确认是否继续。 */
function startRematchVote(room: RoomState): void {
  clearTimeout(room.rematch?.timer);
  const timer = setTimeout(() => {
    if (rooms.get(room.code) !== room || !room.rematch) return;
    const accepted = room.rematch.accepted;
    const pending = room.members.filter((member) => !accepted.has(member.id)).map((member) => member.id);
    returnToWaiting(room, pending, "没有在 1 分钟内确认继续，已被移出房间。");
  }, REMATCH_TIMEOUT_MS);
  timer.unref();
  // 人机总是同意再来一局
  const bots = room.members.filter((member) => member.bot).map((member) => member.id);
  room.rematch = { deadline: Date.now() + REMATCH_TIMEOUT_MS, accepted: new Set(bots), timer };
}

/** 未配置 ADMIN_TOKEN 时管理功能关闭。 */
const adminTokenHash = process.env.ADMIN_TOKEN
  ? createHash("sha256").update(process.env.ADMIN_TOKEN).digest()
  : null;

/**
 * 管理员口令。口令错了以后，这条连接**和这个来源 IP** 都要等 2 秒才能再试（只按连接记的话，换一条连接就绕过了，首发验收 I9）。
 * 大厅从本机直连（127.0.0.1，没有转发头），外面的连接经 Caddy 带着 X-Forwarded-For，所以外面猜口令不会拖累大厅的挤登录。
 */
function checkAdminToken(socketId: string, ip: string, token: unknown): string | null {
  if (!adminTokenHash) return "管理功能未启用。";
  const now = Date.now();
  // 本机直连（大厅、测试）不按 IP 记：外面的连接都经 Caddy、带 X-Forwarded-For，冒充不了本机
  const ipKey = isLoopback(ip) ? null : `ip:${ip}`;
  if (now - (adminFailureTimes.get(socketId) ?? 0) < ADMIN_RETRY_DELAY_MS || (ipKey !== null && now - (adminFailureTimes.get(ipKey) ?? 0) < ADMIN_RETRY_DELAY_MS)) {
    return "尝试太频繁了，请稍后再试。";
  }
  const tokenHash = createHash("sha256").update(typeof token === "string" ? token : "").digest();
  if (!timingSafeEqual(tokenHash, adminTokenHash)) {
    adminFailureTimes.set(socketId, now);
    if (ipKey !== null) adminFailureTimes.set(ipKey, now);
    return "管理员口令不正确。";
  }
  return null;
}

function isLoopback(ip: string): boolean {
  return /^(::1|127\.|::ffff:127\.)/.test(ip);
}

/** 来源 IP：经 Caddy 时取 X-Forwarded-For 的最后一个（Caddy 追加的那个，客户端伪造不了），直连时取连接地址。 */
function clientIp(socket: { handshake: { headers: Record<string, string | string[] | undefined>; address: string } }): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded.at(-1) : forwarded;
  const last = value?.split(",").at(-1)?.trim();
  return last || socket.handshake.address;
}

/** 简单的固定窗口限速：key 在 windowMs 里第 max+1 次起返回 true。 */
const rateWindows = new Map<string, { start: number; count: number }>();
function overLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateWindows.get(key);
  if (!entry || now - entry.start >= windowMs) {
    rateWindows.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}
/** 定期清掉过期的限速记录和口令冷却记录（按 IP 记的不会随连接断开清掉）。 */
const rateSweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateWindows) if (now - entry.start > 60_000) rateWindows.delete(key);
  for (const [key, at] of adminFailureTimes) if (now - at > 60_000) adminFailureTimes.delete(key);
}, 60_000);
rateSweeper.unref();

/**
 * 语音用的 STUN/TURN 配置。配置了 TURN_HOST 和 TURN_SECRET 时，按 coturn 的
 * use-auth-secret 约定发放 24 小时有效的临时凭证；否则只靠局域网直连（本地开发）。
 */
function iceServersFor(memberId: string): IceServerConfig[] {
  const host = process.env.TURN_HOST;
  const secret = process.env.TURN_SECRET;
  if (!host || !secret) return [];
  const username = `${Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS}:${memberId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return [
    { urls: `stun:${host}:3478` },
    { urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username, credential },
  ];
}

function isVoiceSignal(value: unknown): value is VoiceSignal {
  if (!value || typeof value !== "object") return false;
  if (JSON.stringify(value).length > VOICE_SIGNAL_MAX_LENGTH) return false;
  const data = value as { description?: { type?: unknown; sdp?: unknown }; candidate?: { candidate?: unknown } };
  if (data.description) {
    return (data.description.type === "offer" || data.description.type === "answer") && typeof data.description.sdp === "string";
  }
  return Boolean(data.candidate) && typeof data.candidate?.candidate === "string";
}

/** 把离线玩家的座位交给新的连接，保留其对局状态。 */
function reassignMember(room: RoomState, previousId: string, nextId: string): void {
  const swap = (id: string) => (id === previousId ? nextId : id);
  room.members = room.members.map((member) =>
    member.id === previousId ? { ...member, id: nextId, connected: true } : member,
  );
  room.ownerId = swap(room.ownerId);
  room.chat = room.chat.map((entry) => ({ ...entry, senderId: swap(entry.senderId) }));
  if (room.rematch) room.rematch.accepted = new Set([...room.rematch.accepted].map(swap));
}

function invalidNameMessage(payload: CreateRoomPayload | JoinRoomPayload): string | null {
  const name = normalizeName(payload?.name);
  if (!name) return "昵称长度需为 2–18 个字符。";
  if (BOT_NAME_PATTERN.test(name.replace(/\s/g, ""))) return "「咕噜X号」是人机的名字，换一个昵称吧。";
  return null;
}

/**
 * 同一个账号同时登录的设备有上限。网关（Caddy forward_auth）把每条连接属于哪次登录放在
 * X-GC-Session 请求头里；游戏中心挤掉某次登录时发 admin:kick-session，这里断开它的所有连接。
 */
const socketsBySession = new Map<string, Set<string>>();
/** 每条连接属于哪次登录（X-GC-Session）；没有网关时（本地开发、qa-env）没有这个头。 */
const sessionOfSocket = new Map<string, string>();

/** 记下这个座位是哪次登录坐的（断线后座位还在，登录也还算它的）。 */
function rememberSeat(room: RoomState, playerId: string, socketId: string): void {
  const session = sessionOfSocket.get(socketId);
  if (session) room.seatSessions.set(playerId, session);
  else room.seatSessions.delete(playerId);
}

/** 这次登录在这一桌有没有座位（含离线的座位）；except 是不算在内的座位。 */
function seatedLogin(room: RoomState, session: string, exceptPlayerId = ""): boolean {
  return room.members.some((member) => !member.bot && member.playerId !== exceptPlayerId && room.seatSessions.get(member.playerId) === session);
}

/** 这次登录在这一桌有没有别的观战窗口。 */
function spectatingLogin(room: RoomState, session: string, exceptSocketId: string): boolean {
  return room.spectators.some((spectator) => spectator.id !== exceptSocketId && sessionOfSocket.get(spectator.id) === session);
}

/**
 * 每个事件除了回执以外有几个参数。客户端漏发回执、或者多发 / 少发参数时，按这个整理好再交给处理函数：
 * 不整理的话，漏了回执的事件会在处理函数里调用 ack(...) 抛 TypeError，把整个服务器进程弄挂（所有房间一起断）。
 * voice:signal 没有回执，不在表里。
 */
const EVENT_ARITY: Record<string, number> = {
  "lobby:get": 0,
  "room:create": 1,
  "room:join": 1,
  "room:start": 0,
  "room:leave": 0,
  "game:command": 1,
  "room:chat": 1,
  "room:rematch": 1,
  "room:kick": 1,
  "room:access": 1,
  "room:sit": 0,
  "room:stand": 0,
  "room:dissolve": 0,
  "room:add-bot": 0,
  "room:auto": 1,
  "admin:verify": 1,
  "admin:dissolve": 1,
  "admin:kick-session": 1,
  "voice:join": 1,
  "voice:mute": 1,
  "voice:leave": 0,
};

io.on("connection", (socket) => {
  socket.use((packet, next) => {
    const arity = EVENT_ARITY[packet[0] as string];
    if (arity !== undefined) {
      const args = packet.slice(1);
      const ack = typeof args[args.length - 1] === "function" ? args.pop() : () => {};
      const fixed = Array.from({ length: arity }, (_, index) => args[index]);
      packet.splice(1, packet.length - 1, ...fixed, ack);
    }
    next();
  });
  const loginSession = socket.handshake.headers["x-gc-session"];
  const ip = clientIp(socket);
  if (typeof loginSession === "string" && loginSession) {
    const sockets = socketsBySession.get(loginSession) ?? new Set<string>();
    sockets.add(socket.id);
    socketsBySession.set(loginSession, sockets);
    sessionOfSocket.set(socket.id, loginSession);
    socket.on("disconnect", () => {
      sockets.delete(socket.id);
      sessionOfSocket.delete(socket.id);
      if (sockets.size === 0 && socketsBySession.get(loginSession) === sockets) socketsBySession.delete(loginSession);
    });
  }
  const login = typeof loginSession === "string" && loginSession ? loginSession : null;
  /** 加入、建房：每条连接 10 秒 10 次、每个 IP 10 秒 40 次（猜房间码，首发验收 I9）。 */
  // 本机直连（大厅、测试、陪玩脚本，没有转发头）不按 IP 限；线上外面的连接都经 Caddy、带 X-Forwarded-For。
  const loopback = isLoopback(ip);
  const joinTooFast = () => overLimit(`join:${socket.id}`, 10, 10_000) || (!loopback && overLimit(`join-ip:${ip}`, 40, 10_000));
  /** 改开房选项、房间设置：每条连接 5 秒 10 次（每次都会广播给全房间）。 */
  const settingsTooFast = () => overLimit(`settings:${socket.id}`, 10, 5_000);

  socket.on("lobby:get", (ack) => {
    ack({ ok: true, data: roomSummaries() });
  });

  socket.on("room:create", (payload, ack) => {
    if (joinTooFast()) {
      ack({ ok: false, error: "操作太频繁了，请稍后再试。" });
      return;
    }
    if (socketRooms.has(socket.id)) {
      ack({ ok: false, error: "请先离开当前房间，再创建新房间。" });
      return;
    }
    const invalidName = invalidNameMessage(payload);
    if (invalidName) {
      ack({ ok: false, error: invalidName });
      return;
    }
    if (!isCapacity(payload?.capacity)) {
      ack({ ok: false, error: "房间人数必须是 2–6 人。" });
      return;
    }

    let code = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = generateRoomCode();
      if (!rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      ack({ ok: false, error: "暂时无法分配房间码，请重试。" });
      return;
    }

    const room: RoomState = {
      code,
      publicId: randomUUID(),
      capacity: payload.capacity,
      status: "waiting",
      ownerId: socket.id,
      members: [{ id: socket.id, playerId: "p1", name: normalizeName(payload.name)!, isHost: true, connected: true }],
      nextSeat: 2,
      spectators: [],
      invited: new Set(),
      access: { ...DEFAULT_ROOM_ACCESS },
      chat: [],
      voice: new Map(),
      timeouts: new Map(),
      botTimers: new Map(),
      seatSessions: new Map(),
    };
    rememberSeat(room, "p1", socket.id);
    rooms.set(code, room);
    socketRooms.set(socket.id, code);
    void socket.join(code);
    ack({ ok: true, data: snapshot(room, socket.id) });
    emitRoomUpdate(room);
  });

  socket.on("room:join", (payload, ack) => {
    if (joinTooFast()) {
      ack({ ok: false, error: "操作太频繁了，请稍后再试。" });
      return;
    }
    if (socketRooms.has(socket.id)) {
      ack({ ok: false, error: "请先离开当前房间，再加入新房间。" });
      return;
    }
    const invalidName = invalidNameMessage(payload);
    if (invalidName) {
      ack({ ok: false, error: invalidName });
      return;
    }
    // 从首页列表点进来的带 roomId（公开 id），用房间码进来的带 code。
    const viaList = typeof payload.roomId === "string";
    let room: RoomState | undefined;
    if (viaList) {
      room = [...rooms.values()].find((candidate) => candidate.publicId === payload.roomId);
      if (!room) {
        ack({ ok: false, error: "这个房间已经不在了。" });
        return;
      }
    } else {
      const code = normalizeCode(payload?.code);
      if (!code) {
        ack({ ok: false, error: "请输入有效的 6 位房间码。" });
        return;
      }
      room = rooms.get(code);
      if (!room) {
        ack({ ok: false, error: "找不到这个房间，请检查房间码。" });
        return;
      }
    }
    const code = room.code;
    const name = normalizeName(payload.name)!;

    if (payload.spectate === true) {
      if (!room.access.allowSpectators) {
        ack({ ok: false, error: "这个房间没有开放观战。" });
        return;
      }
      if (room.spectators.length >= MAX_SPECTATORS) {
        ack({ ok: false, error: "观战的人已经满了。" });
        return;
      }
      if (nameTaken(room, name)) {
        ack({ ok: false, error: "房间里已有同名的人，请换一个昵称。" });
        return;
      }
      if (login && seatedLogin(room, login)) {
        ack({ ok: false, error: "你在这一桌有座位，不能再开一个窗口观战。" });
        return;
      }
      room.spectators.push({ id: socket.id, name });
      if (!viaList) room.invited.add(socket.id);
      socketRooms.set(socket.id, code);
      void socket.join(code);
      ack({ ok: true, data: snapshot(room, socket.id) });
      emitRoomUpdate(room);
      return;
    }

    if (room.status !== "waiting") {
      if (viaList) {
        ack({ ok: false, error: "对局已经开始了，可以进去观战。" });
        return;
      }
      // 对局中只允许离线玩家用原昵称回到自己的座位。
      const seat = room.members.find((member) => member.name === name);
      if (!seat) {
        ack({ ok: false, error: "对局已经开始，只有原房间玩家可以用原昵称重新加入。" });
        return;
      }
      if (seat.connected) {
        // 同一次登录（刷新页面、手机断网后旧连接还没超时）：直接顶替旧连接；没有网关时只能等旧连接超时
        const sameLogin = login !== null && room.seatSessions.get(seat.playerId) === login;
        if (!sameLogin) {
          ack({ ok: false, error: "这个昵称的玩家仍在线，无法重新加入。" });
          return;
        }
        const old = io.sockets.sockets.get(seat.id);
        socketRooms.delete(seat.id);
        if (old) {
          void old.leave(code);
          old.emit("room:closed", { reason: "你在另一个窗口回到了座位。" });
        }
      }
      clearTimeout(room.abandonTimer);
      delete room.abandonTimer;
      if (login && spectatingLogin(room, login, socket.id)) {
        ack({ ok: false, error: "你正在用另一个窗口观战这一桌，先关掉那个窗口再回座位。" });
        return;
      }
      reassignMember(room, seat.id, socket.id);
      rememberSeat(room, seat.playerId, socket.id);
      socketRooms.set(socket.id, code);
      void socket.join(code);
      // 回来了：不再由人机代打（托管中的除外）
      updateTurnTimer(room);
      ack({ ok: true, data: snapshot(room, socket.id) });
      emitRoomUpdate(room);
      return;
    }
    if (viaList && !room.access.open) {
      ack({ ok: false, error: "这个房间是邀请制，要有房间码才能加入。" });
      return;
    }
    if (room.members.length >= room.capacity) {
      ack({ ok: false, error: "房间已满。" });
      return;
    }
    if (nameTaken(room, name)) {
      ack({ ok: false, error: "房间里已有同名的人，请换一个昵称。" });
      return;
    }
    if (login && spectatingLogin(room, login, socket.id)) {
      ack({ ok: false, error: "你正在用另一个窗口观战这一桌，先关掉那个窗口再坐下。" });
      return;
    }

    const member: LobbyMember = {
      id: socket.id,
      playerId: `p${room.nextSeat++}`,
      name,
      isHost: false,
      connected: true,
    };
    room.members.push(member);
    rememberSeat(room, member.playerId, socket.id);
    socketRooms.set(socket.id, code);
    void socket.join(code);
    ack({ ok: true, data: snapshot(room, socket.id) });
    emitRoomUpdate(room);
  });

  socket.on("room:access", (settings, ack) => {
    if (settingsTooFast()) {
      ack({ ok: false, error: "操作太频繁了，请稍后再试。" });
      return;
    }
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以修改房间设置。" });
      return;
    }
    // 「观战看手牌」只能在等候房间打开；对局中只能关（首发验收 I8：边打边开个观战窗口看别人的牌）
    if (room.status !== "waiting" && settings?.spectatorsSeeAll === true && !room.access.spectatorsSeeAll) {
      ack({ ok: false, error: "对局开始后不能再打开「观战看手牌」，这一场结束后回等候房间再改。" });
      return;
    }
    const next = { ...room.access };
    for (const key of ["allowSpectators", "spectatorsSeeAll", "open"] as const) {
      const value = settings?.[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean") {
        ack({ ok: false, error: "设置内容不正确。" });
        return;
      }
      next[key] = value;
    }
    room.access = next;
    if (!next.allowSpectators && room.spectators.length > 0) {
      for (const spectator of room.spectators) closeMemberConnection(room, spectator.id, "房主关闭了观战。");
      room.spectators = [];
      room.invited.clear();
    }
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:sit", (ack) => {
    const room = findRoomForSocket(socket.id);
    const spectator = room?.spectators.find((candidate) => candidate.id === socket.id);
    if (!room || !spectator) {
      ack({ ok: false, error: "你现在不在观战。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局开始后不能再坐下，等这局结束吧。" });
      return;
    }
    if (room.members.length >= room.capacity) {
      ack({ ok: false, error: "座位已经满了。" });
      return;
    }
    if (!room.access.open && !room.invited.has(socket.id)) {
      ack({ ok: false, error: "这个房间是邀请制，要有房间码才能坐下。" });
      return;
    }
    if (login && spectatingLogin(room, login, socket.id)) {
      ack({ ok: false, error: "你还有一个窗口在观战这一桌，先关掉那个窗口再坐下。" });
      return;
    }
    room.spectators = room.spectators.filter((candidate) => candidate.id !== socket.id);
    room.invited.delete(socket.id);
    const seatId = `p${room.nextSeat++}`;
    room.members.push({ id: socket.id, playerId: seatId, name: spectator.name, isHost: false, connected: true });
    rememberSeat(room, seatId, socket.id);
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:stand", (ack) => {
    const room = findRoomForSocket(socket.id);
    const member = room?.members.find((candidate) => candidate.id === socket.id);
    if (!room || !member) {
      ack({ ok: false, error: "你当前不在座位上。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局中不能离开座位。" });
      return;
    }
    if (member.isHost) {
      ack({ ok: false, error: "房主不能改成观战。" });
      return;
    }
    if (!room.access.allowSpectators) {
      ack({ ok: false, error: "这个房间没有开放观战。" });
      return;
    }
    if (login && seatedLogin(room, login, member.playerId)) {
      ack({ ok: false, error: "你在这一桌还有别的座位，不能改成观战。" });
      return;
    }
    room.members = room.members.filter((candidate) => candidate.id !== socket.id);
    room.seatSessions.delete(member.playerId);
    room.voice.delete(socket.id);
    room.spectators.push({ id: socket.id, name: member.name });
    room.invited.add(socket.id);
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:start", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    if (room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以开始对局。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局已经开始。" });
      return;
    }
    if (room.members.length < 2) {
      ack({ ok: false, error: "至少需要 2 位玩家才能开始。" });
      return;
    }

    try {
      room.game = newGame(room);
      room.status = "playing";
      updateTurnTimer(room);
      const roomSnapshot = snapshot(room, socket.id);
      ack({ ok: true, data: roomSnapshot });
      emitRoomUpdate(room);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法开始对局。";
      ack({ ok: false, error: message });
    }
  });

  socket.on("room:leave", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    if (room.status === "playing" && !isSpectator(room, socket.id)) {
      ack({ ok: false, error: "对局开始后暂不能离开房间。" });
      return;
    }
    const code = room.code;
    removeWaitingMember(socket.id);
    void socket.leave(code);
    ack({ ok: true, data: undefined });
  });

  socket.on("game:command", (command, ack) => {
    const second = Math.floor(Date.now() / 1000);
    const counter = commandCounts.get(socket.id);
    if (counter && counter.second === second) counter.count += 1;
    else commandCounts.set(socket.id, { second, count: 1 });
    if ((commandCounts.get(socket.id)?.count ?? 0) > COMMAND_RATE_LIMIT) {
      ack({ ok: false, error: "操作太快了，请稍等一下。" });
      return;
    }
    const room = findRoomForSocket(socket.id);
    if (!room || room.status !== "playing" || !room.game) {
      ack({ ok: false, error: "当前没有进行中的对局。" });
      return;
    }
    if (isSpectator(room, socket.id)) {
      ack({ ok: false, error: "观战中不能操作。" });
      return;
    }

    try {
      const playerId = seatOf(room, socket.id);
      room.game = applyCommand(room.game, playerId, command);
      // 自己动了一下：超时次数清零，托管也取消
      room.timeouts.delete(playerId);
      setAuto(room, playerId, false);
      afterGameChange(room);
      const roomSnapshot = snapshot(room, socket.id);
      ack({ ok: true, data: roomSnapshot });
      emitRoomUpdate(room);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法执行这个行动。";
      ack({ ok: false, error: message });
    }
  });

  socket.on("room:rematch", (accept, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room?.rematch || !room.members.some((member) => member.id === socket.id)) {
      ack({ ok: false, error: "现在不需要确认。" });
      return;
    }
    ack({ ok: true, data: undefined });
    if (accept !== true) {
      returnToWaiting(room, [socket.id], "你选择了不继续，已离开房间。");
      return;
    }
    room.rematch.accepted.add(socket.id);
    if (room.members.every((member) => room.rematch!.accepted.has(member.id))) {
      clearTimeout(room.rematch.timer);
      delete room.rematch;
      room.game = newGame(room);
      updateTurnTimer(room);
    }
    emitRoomUpdate(room);
  });

  socket.on("room:kick", (memberId, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以移出玩家。" });
      return;
    }
    if (isSpectator(room, memberId)) {
      // 观战的人随时可以移出。
      closeMemberConnection(room, memberId, "你已被房主移出房间。");
      room.spectators = room.spectators.filter((spectator) => spectator.id !== memberId);
      room.invited.delete(memberId);
      ack({ ok: true, data: undefined });
      emitRoomUpdate(room);
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局中不能移出玩家；有人挂机可以解散房间。" });
      return;
    }
    if (memberId === socket.id || !room.members.some((member) => member.id === memberId)) {
      ack({ ok: false, error: "找不到这位玩家。" });
      return;
    }
    removeMembers(room, [memberId], "你已被房主移出房间。");
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:add-bot", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以加人机。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局开始后不能再加人机。" });
      return;
    }
    if (room.members.length >= room.capacity) {
      ack({ ok: false, error: "座位已经满了。" });
      return;
    }
    const name = BOT_NAMES.find((candidate) => !nameTaken(room, candidate));
    if (!name) {
      ack({ ok: false, error: "人机已经加满了。" });
      return;
    }
    room.members.push({ id: `bot-${randomUUID()}`, playerId: `p${room.nextSeat++}`, name, isHost: false, connected: true, bot: true });
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:auto", (enabled, ack) => {
    const room = findRoomForSocket(socket.id);
    const member = room?.members.find((candidate) => candidate.id === socket.id);
    if (!room || !member || room.status !== "playing" || !room.game) {
      ack({ ok: false, error: "现在没有你参加的对局。" });
      return;
    }
    room.timeouts.delete(member.playerId);
    setAuto(room, member.playerId, enabled === true);
    updateTurnTimer(room);
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:dissolve", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以解散房间。" });
      return;
    }
    ack({ ok: true, data: undefined });
    dissolveRoom(room, "房主解散了房间。");
  });

  socket.on("admin:verify", (token, ack) => {
    const error = checkAdminToken(socket.id, ip, token);
    ack(error ? { ok: false, error } : { ok: true, data: undefined });
  });

  socket.on("admin:kick-session", (payload, ack) => {
    const error = checkAdminToken(socket.id, ip, payload?.token);
    if (error) {
      ack({ ok: false, error });
      return;
    }
    const ids = typeof payload?.sessionId === "string" ? [...(socketsBySession.get(payload.sessionId) ?? [])] : [];
    let kicked = 0;
    for (const id of ids) {
      const target = io.sockets.sockets.get(id);
      if (!target) continue;
      target.emit("session:kicked");
      target.disconnect(true);
      kicked += 1;
    }
    ack({ ok: true, data: kicked });
  });

  socket.on("admin:dissolve", (payload, ack) => {
    const error = checkAdminToken(socket.id, ip, payload?.token);
    if (error) {
      ack({ ok: false, error });
      return;
    }
    const room = [...rooms.values()].find((candidate) => candidate.publicId === payload.roomId);
    if (!room) {
      ack({ ok: false, error: "这个房间已经不存在。" });
      return;
    }
    dissolveRoom(room, "管理员解散了这个房间。");
    ack({ ok: true, data: undefined });
  });

  socket.on("voice:join", (payload, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    if (isSpectator(room, socket.id)) {
      ack({ ok: false, error: "观战时不能加入语音。" });
      return;
    }
    room.voice.set(socket.id, { muted: payload?.muted === true });
    ack({ ok: true, data: iceServersFor(socket.id) });
    emitRoomUpdate(room);
  });

  socket.on("voice:mute", (muted, ack) => {
    const room = findRoomForSocket(socket.id);
    const state = room?.voice.get(socket.id);
    if (!room || !state) {
      ack({ ok: false, error: "你还没有加入语音。" });
      return;
    }
    state.muted = muted === true;
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("voice:leave", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (room?.voice.delete(socket.id)) emitRoomUpdate(room);
    ack({ ok: true, data: undefined });
  });

  socket.on("voice:signal", (payload) => {
    // 只在同一房间、都在语音里的两人之间转发。
    const room = findRoomForSocket(socket.id);
    if (!room || !room.voice.has(socket.id) || !room.voice.has(payload?.to) || payload.to === socket.id) return;
    if (!isVoiceSignal(payload.data)) return;
    io.to(payload.to).emit("voice:signal", { from: socket.id, data: payload.data });
  });

  socket.on("room:chat", (payload, ack) => {
    const room = findRoomForSocket(socket.id);
    const member = room?.members.find((candidate) => candidate.id === socket.id)
      ?? room?.spectators.find((candidate) => candidate.id === socket.id);
    if (!room || !member) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    const spectator = isSpectator(room, socket.id);
    const message = normalizeChatMessage(payload?.message);
    if (!message) {
      ack({ ok: false, error: `消息需为 1–${ROOM_CHAT_MAX_LENGTH} 个字符。` });
      return;
    }
    const now = Date.now();
    if (now - (roomChatTimes.get(socket.id) ?? 0) < ROOM_CHAT_RATE_LIMIT_MS) {
      ack({ ok: false, error: "发送太快了，请稍等一下。" });
      return;
    }

    roomChatTimes.set(socket.id, now);
    room.chat = [
      ...room.chat,
      { id: randomUUID(), senderId: socket.id, name: member.name, message, createdAt: new Date(now).toISOString(), ...(spectator ? { spectator: true } : {}) },
    ].slice(-ROOM_CHAT_LIMIT);
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("disconnect", () => {
    roomChatTimes.delete(socket.id);
    commandCounts.delete(socket.id);
    adminFailureTimes.delete(socket.id);
    removeWaitingMember(socket.id);
  });
});

/** 仅供测试：直接把某个房间的对局标记为结束并发起继续投票。 */
export const testHooks = {
  finishGame(code: string): void {
    const room = rooms.get(code);
    if (!room?.game) throw new Error("no game");
    const players = room.game.players;
    room.game = {
      ...room.game,
      phase: "gameOver" as const,
      finalResult: (() => {
        const scores = scoreAll(room.game!);
        return { winners: [players[0]!.id], scores, ranks: Object.fromEntries(players.map((player, index) => [player.id, index + 1])), reasons: ["full" as const], rounds: room.game!.round };
      })(),
    };
    clearGameTimers(room);
    startRematchVote(room);
    emitRoomUpdate(room);
  },
  /** 服务端对局状态里的种子和随机数状态（只给测试看：确认服务器用的是 256 位密钥，I7）。 */
  rngOf(code: string): { seed: GameState["seed"]; rngState: GameState["rngState"] } {
    const room = rooms.get(code);
    if (!room?.game) throw new Error("no game");
    return { seed: room.game.seed, rngState: room.game.rngState };
  },
  /** 用指定种子重开当前对局，方便测试固定开局。 */
  reseed(code: string, seed: number): void {
    const room = rooms.get(code);
    if (!room) throw new Error("no room");
    room.game = newGame(room, seed);
    updateTurnTimer(room);
    emitRoomUpdate(room);
  },
  /** 让当前这一步立即超时。 */
  expireTurn(code: string): void {
    const room = rooms.get(code);
    if (!room?.game) throw new Error("no room");
    expireTurn(room, stepKey(room.game));
  },
  /** 换成指定的对局状态（比如 buildGame 造的精确局面），方便测规则 C、局末这些情况。 */
  setGame(code: string, game: GameState): void {
    const room = rooms.get(code);
    if (!room) throw new Error("no room");
    clearGameTimers(room);
    room.game = game;
    room.status = "playing";
    updateTurnTimer(room);
    emitRoomUpdate(room);
  },
  /** 当前这一步的截止时间（计时 key 测试用）。 */
  deadline(code: string): { deadline: number; key: string } | null {
    const turn = rooms.get(code)?.turn;
    return turn ? { deadline: turn.deadline, key: turn.key } : null;
  },
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 3027);
  httpServer.listen(port, () => {
    console.log(`Welcometo server listening on http://localhost:${port}`);
  });
}
