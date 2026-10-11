/**
 * 预览局面工厂（对外接口）：界面预览页、教程、自测都靠它造局面。
 *
 * - parseSheet(spec)：用一行字写一条街，造出精确的表；
 * - buildGame(spec)：按参数造任意精确局面（每人的表、本回合 3 组、目标卡和是否已翻面、回合数、谁交了）；
 * - createScene(name)：按名字造常见局面（开局、每种行动之前、验证目标卡、拒批、终局含并列、6 人桌……）；
 * - createSceneRoom(game, opts)：包成房间快照（离线、人机、托管、观战、倒计时），直接喂给 GameBoard。
 */
import { greedySubmission, randomSubmission } from "./baseline.js";
import { PLAN_DEFS, POOL_SLOTS, STREET_LENGTHS, buildDeck } from "./data.js";
import { apply, createGame, redactGameForSpectator, redactGameForViewer, scoreAll, rankPlayers } from "./engine.js";
import { createRng, type Rng } from "./rng.js";
import { DEFAULT_ROOM_ACCESS, type Capacity, type LobbyMember, type LobbyRoomSnapshot } from "./roomTypes.js";
import { emptySheet, filledCount } from "./sheet.js";
import type { Card, Combo, GameState, Plan, Sheet, Submission, UsedEstate } from "./types.js";

export const SCENE_PLAYER_NAMES = ["我", "阿花", "老王", "小美", "大刘", "二丫"] as const;
const BOT_NAMES = ["咕噜一号", "咕噜二号", "咕噜三号", "咕噜四号", "咕噜五号"];

/**
 * 一张表的写法。streets 每条街一行，用空格分隔：
 * - `_` 空位，`7` 门牌号，`7b` bis 复制来的，`7p` 写在泳池位上而且泳池建成了；
 * - `|` 栅栏（画在前后两座之间）。
 * 例：`"1 2 | 3 4 5 | _ _ 9p _ _"`。其余字段直接给数（不给就是 0 / 没验证）。
 * poolTrack 不给时按 `p` 的个数算；usedEstates 给目标卡用掉的小区。
 */
export interface SheetSpec {
  readonly streets?: readonly [string, string, string];
  readonly parks?: readonly [number, number, number];
  readonly poolTrack?: number;
  readonly improve?: readonly number[];
  readonly temps?: number;
  readonly bis?: number;
  readonly refusals?: number;
  readonly plans?: readonly (number | null)[];
  readonly usedEstates?: readonly UsedEstate[];
}

export function parseStreet(sheet: Sheet, street: number, text: string, round = 1): void {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  for (const token of tokens) {
    if (token === "|") {
      if (index === 0 || index >= STREET_LENGTHS[street]!) throw new Error(`第 ${street + 1} 条街的栅栏位置不对：${text}`);
      sheet.fences[street]![index - 1] = true;
      continue;
    }
    if (index >= STREET_LENGTHS[street]!) throw new Error(`第 ${street + 1} 条街写多了：${text}`);
    if (token !== "_") {
      const match = /^(\d+)([bp]*)$/.exec(token);
      if (!match) throw new Error(`看不懂：${token}`);
      const num = Number(match[1]);
      sheet.houses[street]![index] = { num, bis: match[2]!.includes("b"), round };
      if (match[2]!.includes("p")) {
        if (!POOL_SLOTS[street]!.includes(index)) throw new Error(`第 ${street + 1} 条街第 ${index + 1} 位不是泳池位`);
        sheet.pools[street]![index] = true;
      }
    }
    index += 1;
  }
  if (index !== STREET_LENGTHS[street]) throw new Error(`第 ${street + 1} 条街要写 ${STREET_LENGTHS[street]} 位，写了 ${index} 位：${text}`);
}

export function parseSheet(spec: SheetSpec = {}): Sheet {
  const sheet = emptySheet();
  if (spec.streets) spec.streets.forEach((text, street) => parseStreet(sheet, street, text));
  if (spec.parks) sheet.parks = [...spec.parks];
  sheet.poolTrack = spec.poolTrack ?? sheet.pools.flat().filter(Boolean).length;
  if (spec.improve) sheet.improve = [...spec.improve, 0, 0, 0, 0, 0, 0].slice(0, 6);
  if (spec.temps !== undefined) sheet.temps = spec.temps;
  if (spec.bis !== undefined) sheet.bis = spec.bis;
  if (spec.refusals !== undefined) sheet.refusals = spec.refusals;
  if (spec.plans) sheet.plans = [...spec.plans, null, null, null].slice(0, 3);
  if (spec.usedEstates) sheet.usedEstates = [...spec.usedEstates];
  return sheet;
}

/** 表写回一行字（调试、测试失败时看）。 */
export function sheetToText(sheet: Sheet): string[] {
  return sheet.houses.map((row, street) =>
    row
      .map((house, index) => {
        const token = house ? `${house.num}${house.bis ? "b" : ""}${sheet.pools[street]![index] ? "p" : ""}` : "_";
        return index < row.length - 1 && sheet.fences[street]![index] ? `${token} |` : token;
      })
      .join(" "),
  );
}

export interface PlayerSpec {
  readonly id?: string;
  readonly name?: string;
  readonly sheet?: SheetSpec | Sheet;
  /** 这回合已经交了（给了就用这一手；true = 交了一手兜底的）。 */
  readonly submitted?: Submission | true;
}

export interface ExactSpec {
  /** 玩家（第一个是「我」p1）。不给就 4 人空表。 */
  readonly players?: readonly PlayerSpec[] | number;
  /** 本回合 3 组。不给就按种子翻。 */
  readonly combos?: readonly Combo[];
  /** 3 张目标卡编号；approved 给已经翻到获批面的（下标 0–2 → 在第几回合翻的）。 */
  readonly plans?: readonly string[];
  readonly approved?: Readonly<Record<number, number>>;
  readonly round?: number;
  readonly seed?: number;
  /** 每堆还剩几张没翻（含露出数字那张），默认 26。 */
  readonly drawLeft?: number;
}

function isSheet(value: SheetSpec | Sheet): value is Sheet {
  return Array.isArray((value as Sheet).houses);
}

/**
 * 把 3 堆摆成能翻出指定 3 组的样子：每堆翻开的那张行动 = combo.action，露出的那张数字 = combo.num；
 * 其余牌洗匀分进 3 堆（81 张守恒）。
 */
function stacksFor(combos: readonly Combo[], rng: Rng, drawLeft: number): GameState["stacks"] {
  const pool = rng.shuffle(buildDeck());
  const take = (test: (card: Card) => boolean): Card => {
    const index = pool.findIndex(test);
    if (index < 0) throw new Error("凑不出这组牌。");
    return pool.splice(index, 1)[0]!;
  };
  const flipped = combos.map((combo) => take((card) => card.action === combo.action));
  const tops = combos.map((combo) => take((card) => card.num === combo.num));
  const rest = pool;
  const left = Math.max(1, Math.min(26, drawLeft));
  return combos.map((_, index) => {
    const others = rest.splice(0, index === combos.length - 1 ? rest.length : 25);
    const draw = [tops[index]!, ...others.slice(0, left - 1)];
    const discard = [...others.slice(left - 1), flipped[index]!];
    return { draw, drawCount: draw.length, discard };
  });
}

/** 按参数造一个精确局面（数字种子，状态里带 seed，可以直接 apply 往下走）。 */
export function buildGame(spec: ExactSpec = {}): GameState {
  const seed = spec.seed ?? 7;
  const playerSpecs: readonly PlayerSpec[] = typeof spec.players === "number"
    ? Array.from({ length: spec.players }, () => ({}))
    : spec.players ?? [{}, {}, {}, {}];
  const players = playerSpecs.map((player, index) => ({
    id: player.id ?? `p${index + 1}`,
    name: player.name ?? SCENE_PLAYER_NAMES[index] ?? `玩家${index + 1}`,
  }));
  const planIds = spec.plans ?? ["1-1", "2-3", "3-1"];
  const game = createGame(players, seed, { plans: planIds });
  const rng = createRng(seed + 1);
  if (spec.combos) {
    if (spec.combos.length !== 3) throw new Error("本回合要正好 3 组。");
    game.stacks = stacksFor(spec.combos, rng, spec.drawLeft ?? 26);
    game.combos = spec.combos.map((combo) => ({ ...combo }));
  }
  game.round = spec.round ?? 1;
  game.plans = game.plans.map((plan, index): Plan => {
    const round = spec.approved?.[index];
    return round !== undefined ? { ...plan, approvedRound: round } : plan;
  });
  playerSpecs.forEach((player, index) => {
    const target = game.players[index]!;
    if (player.sheet) target.sheet = isSheet(player.sheet) ? player.sheet : parseSheet(player.sheet);
  });
  game.events = [];
  game.rngState = rng.state;
  // 已交的人
  playerSpecs.forEach((player, index) => {
    if (!player.submitted) return;
    const target = game.players[index]!;
    target.pending = player.submitted === true ? greedySubmission(game, target.id) : player.submitted;
    target.submitted = true;
  });
  return game;
}

/** 所有人按策略交一回合（默认贪心基线；random 给 rng 就随机）。返回结算后的状态。 */
export function playRound(state: GameState, rng: Rng, chooser: "greedy" | "random" = "greedy"): GameState {
  let current = state;
  for (const player of state.players) {
    if (current.phase !== "play" || current.round !== state.round) break;
    const me = current.players.find((candidate) => candidate.id === player.id)!;
    if (me.submitted) continue;
    const submission = chooser === "greedy" ? greedySubmission(current, player.id) : randomSubmission(current, player.id, rng);
    current = apply(current, player.id, { type: "submit", submission }, rng).state;
  }
  return current;
}

/** 从 state 起自动打 rounds 回合（到终局就停）。 */
export function autoPlay(state: GameState, rounds: number, seed = 1, chooser: "greedy" | "random" = "greedy"): GameState {
  const rng = createRng(seed);
  let current = state;
  for (let i = 0; i < rounds && current.phase === "play"; i += 1) current = playRound(current, rng, chooser);
  return current;
}

/** 自动打到终局。 */
export function autoPlayToEnd(state: GameState, seed = 1, chooser: "greedy" | "random" = "greedy"): GameState {
  return autoPlay(state, 200, seed, chooser);
}

export const SCENE_NAMES = [
  "start",
  "fence",
  "improve",
  "park",
  "pool",
  "temp",
  "bis",
  "plan",
  "refuse",
  "submitted",
  "approved",
  "mid",
  "six",
  "late",
  "gameover",
  "gameover-tie",
] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

export const SCENE_DESCRIPTIONS: Record<SceneName, string> = {
  start: "开局：4 人空表，第 1 回合 3 组",
  fence: "栅栏之前：有一组栅栏，画上就能围出完成小区",
  improve: "改造之前：有一组改造，已有几个 3 房小区",
  park: "公园之前：有一组公园，第 1 条街公园差一格建满",
  pool: "泳池之前：有一组泳池，泳池位还空着",
  temp: "临时工之前：有一组临时工，原数字只能放在不好的位置",
  bis: "bis 之前：有一组 bis，旁边有能复制的房子",
  plan: "验证目标卡：这一手填完就能完成 n°3，可勾重洗",
  refuse: "必须拒批：3 组都填不进去",
  submitted: "我已交，等别人（别人有的交了有的没交）",
  approved: "上一回合别人首批验证了 n°1（卡已翻面）",
  mid: "中盘：4 人各打了 12 回合",
  six: "6 人桌：中盘，最多人数",
  late: "后期：表快填满，拒批 2 次",
  gameover: "终局：表铺满，有胜者",
  "gameover-tie": "终局：两人完全并列获胜",
};

export interface SceneOptions {
  readonly players?: number;
  readonly seed?: number;
}

const FULL_A: SheetSpec = {
  streets: ["1 2 | 3 4 5 | 6 7 8 | 9 10", "0 1 | 2 3 | 4 5 6 | 7 8 9 10", "1 2 3 | 4 5 6 | 7 8 9 | 10 11 12"],
  parks: [3, 2, 3],
  improve: [0, 1, 2, 0, 0, 0],
  temps: 3,
  bis: 0,
  plans: [8, 9, 7],
  usedEstates: [],
};

/** 按名字造常见局面。 */
export function createScene(name: SceneName, opts: SceneOptions = {}): GameState {
  const seed = opts.seed ?? 11;
  const n = opts.players ?? 4;
  switch (name) {
    case "start":
      return buildGame({ players: n, seed, combos: [{ num: 3, action: "fence" }, { num: 8, action: "park" }, { num: 12, action: "pool" }] });
    case "fence":
      return buildGame({
        players: [{ sheet: { streets: ["1 3 4 _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"] } }, {}, {}, {}],
        combos: [{ num: 6, action: "fence" }, { num: 9, action: "park" }, { num: 13, action: "improve" }],
        seed,
        round: 4,
      });
    case "improve":
      return buildGame({
        players: [{ sheet: { streets: ["1 2 3 | _ _ _ _ _ _ _", "_ _ _ | 5 6 7 | _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"] } }, {}, {}, {}],
        combos: [{ num: 10, action: "improve" }, { num: 4, action: "fence" }, { num: 14, action: "park" }],
        seed,
        round: 6,
      });
    case "park":
      return buildGame({
        players: [{ sheet: { streets: ["2 _ _ 6 _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"], parks: [2, 0, 0] } }, {}, {}, {}],
        combos: [{ num: 8, action: "park" }, { num: 5, action: "fence" }, { num: 11, action: "improve" }],
        seed,
        round: 4,
      });
    case "pool":
      return buildGame({
        players: [{ sheet: { streets: ["1 _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"] } }, {}, {}, {}],
        combos: [{ num: 6, action: "pool" }, { num: 2, action: "fence" }, { num: 13, action: "park" }],
        seed,
        round: 2,
      });
    case "temp":
      return buildGame({
        players: [{ sheet: { streets: ["1 2 3 _ _ _ _ _ 13 15", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"] } }, {}, {}, {}],
        combos: [{ num: 6, action: "temp" }, { num: 9, action: "fence" }, { num: 12, action: "park" }],
        seed,
        round: 5,
      });
    case "bis":
      return buildGame({
        players: [{ sheet: { streets: ["1 2 3 4 _ 6 _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"] } }, {}, {}, {}],
        combos: [{ num: 9, action: "bis" }, { num: 11, action: "fence" }, { num: 14, action: "improve" }],
        seed,
        round: 6,
      });
    case "plan":
      return buildGame({
        players: [{ sheet: { streets: ["1 2 3 | 4 5 6 _ | _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"] } }, {}, {}, {}],
        combos: [{ num: 7, action: "fence" }, { num: 10, action: "park" }, { num: 2, action: "improve" }],
        plans: ["1-3", "2-2", "3-1"],
        seed,
        round: 8,
      });
    case "refuse":
      return buildGame({
        players: [
          { sheet: { streets: ["1 2 3 4 5 _ 6 7 8 9", "1 2 3 4 5 6 _ 7 8 9 10", "1 2 3 4 5 6 7 _ 8 9 10 11"], refusals: 1 } },
          {},
          {},
          {},
        ],
        combos: [{ num: 3, action: "fence" }, { num: 9, action: "park" }, { num: 12, action: "bis" }],
        seed,
        round: 20,
      });
    case "submitted": {
      const game = autoPlay(createScene("start", { players: n, seed }), 3, seed);
      return withSubmitted(game, [0, 2]);
    }
    case "approved": {
      // 别人（p2）上一回合首批验证了 n°1（6 个 1 房）
      const base = buildGame({
        players: [
          {},
          { sheet: { streets: ["1 | 2 | 3 | 4 | 5 | _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"] } },
          {},
          {},
        ],
        combos: [{ num: 6, action: "fence" }, { num: 8, action: "park" }, { num: 11, action: "improve" }],
        plans: ["1-1", "2-3", "3-1"],
        seed,
        round: 7,
      });
      const rng = createRng(seed);
      let game = base;
      game = apply(game, "p2", { type: "submit", submission: { move: { combo: 0, street: 0, house: 5, fence: { street: 0, pos: 5 } }, plans: [0] } }, rng).state;
      return playRound(game, rng);
    }
    case "mid":
      return autoPlay(createScene("start", { players: n, seed }), 12, seed);
    case "six":
      return autoPlay(createScene("start", { players: 6, seed }), 14, seed);
    case "late": {
      const game = autoPlay(createScene("start", { players: n, seed }), 22, seed);
      if (game.phase !== "play") return autoPlay(createScene("start", { players: n, seed: seed + 1 }), 18, seed);
      game.players[0]!.sheet.refusals = Math.max(2, game.players[0]!.sheet.refusals);
      return game;
    }
    case "gameover":
      return autoPlayToEnd(createScene("start", { players: n, seed }), seed);
    case "gameover-tie": {
      const game = buildGame({
        players: [{ sheet: FULL_A }, { sheet: FULL_A }, { sheet: { streets: ["1 2 _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"], refusals: 2 } }],
        combos: [{ num: 3, action: "fence" }, { num: 9, action: "park" }, { num: 12, action: "bis" }],
        plans: ["1-1", "2-3", "3-1"],
        approved: { 0: 5, 1: 9, 2: 12 },
        seed,
        round: 24,
      });
      return finishScene(game);
    }
  }
}

/** 把局面直接判成终局（按现在的表算分），预览用。 */
export function finishScene(game: GameState): GameState {
  const scores = scoreAll(game);
  const ranks = rankPlayers(scores);
  const winners = game.players.map((player) => player.id).filter((id) => ranks[id] === 1);
  const reasons: ("refusals" | "plans" | "full")[] = [];
  if (game.players.some((player) => player.sheet.refusals >= 3)) reasons.push("refusals");
  if (game.players.some((player) => player.sheet.plans.every((value) => value !== null))) reasons.push("plans");
  if (game.players.some((player) => filledCount(player.sheet) >= 33)) reasons.push("full");
  return {
    ...game,
    phase: "gameOver",
    combos: [],
    finalResult: { winners, scores, ranks, reasons: reasons.length ? reasons : ["full"], rounds: game.round },
    events: [{ type: "GameEnded", winners, reasons: reasons.length ? reasons : ["full"] }],
    version: game.version + 1,
  };
}

/** 让第 seats 号座位（0 起）已经交了这回合（贪心一手）。 */
export function withSubmitted(game: GameState, seats: readonly number[]): GameState {
  const next: GameState = { ...game, players: game.players.map((player) => ({ ...player })) };
  for (const seat of seats) {
    const player = next.players[seat];
    if (!player) continue;
    player.pending = greedySubmission(next, player.id);
    player.submitted = true;
  }
  return next;
}

export interface SceneRoomOptions {
  /** 从哪个座位看（默认 p1）；spectator 为 true 时忽略。 */
  readonly viewer?: string;
  readonly spectator?: boolean;
  readonly seeAll?: boolean;
  /** 这些座位离线。 */
  readonly offline?: readonly string[];
  /** 这些座位是人机（咕噜一号…）。 */
  readonly bots?: readonly string[];
  /** 这些座位在托管中。 */
  readonly auto?: readonly string[];
  /** 本回合剩余毫秒（默认满 90 秒）；给小的数就是「快超时」。 */
  readonly turnRemainingMs?: number;
}

/** 把局面包成房间快照（对局中），直接喂给 GameBoard。 */
export function createSceneRoom(game: GameState, opts: SceneRoomOptions = {}): LobbyRoomSnapshot {
  const viewer = opts.viewer ?? "p1";
  let botIndex = 0;
  const members: LobbyMember[] = game.players.map((player, index) => {
    const bot = opts.bots?.includes(player.id) === true;
    return {
      id: `sock-${player.id}`,
      playerId: player.id,
      name: bot ? BOT_NAMES[botIndex++] ?? player.name : player.name,
      isHost: index === 0,
      connected: !(opts.offline?.includes(player.id) ?? false),
      ...(bot ? { bot: true } : {}),
      ...(opts.auto?.includes(player.id) ? { auto: true } : {}),
    };
  });
  const view = opts.spectator ? redactGameForSpectator(game, opts.seeAll === true) : redactGameForViewer(game, viewer);
  // 人机座位的名字也改到对局里
  view.players = view.players.map((player) => {
    const member = members.find((candidate) => candidate.playerId === player.id);
    return member && member.name !== player.name ? { ...player, name: member.name } : player;
  });
  return {
    code: opts.spectator ? "" : "WEL327",
    spectators: opts.spectator ? [{ id: "sock-watcher", name: "看客" }] : [],
    access: { ...DEFAULT_ROOM_ACCESS, ...(opts.seeAll ? { spectatorsSeeAll: true } : {}) },
    capacity: Math.max(2, game.players.length) as Capacity,
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: view,
    ...(game.phase !== "gameOver" ? { turnRemainingMs: opts.turnRemainingMs ?? game.config.turnSec * 1000 } : {}),
    ...(game.phase === "gameOver"
      ? { rematch: { remainingMs: 60_000, acceptedIds: members.filter((member) => member.bot).map((member) => member.id) } }
      : {}),
  };
}

/** 所有目标卡编号（预览页下拉用）。 */
export const ALL_PLAN_IDS = PLAN_DEFS.map((plan) => plan.id);
