/**
 * 欢迎来到：规则引擎。纯函数 apply(state, playerId, command, rng) → { state, events }，不改输入。
 *
 * 一回合：全员同时提交（submit，可以 retract 撤回重交）→ 最后一人交齐的瞬间一次性结算所有人
 * → 目标卡（同回合首批都拿项目面高分）→ 首批验证者勾了重洗就重洗 → 判终局 → 翻下一回合 3 组。
 */
import {
  DECK_SIZE,
  MAX_REFUSALS,
  PLAN_DEFS,
  STACK_COUNT,
  TOTAL_HOUSES,
  buildDeck,
  planDef,
} from "./data.js";
import { createRng, restoreRng, rngFromSeed, type Rng } from "./rng.js";
import {
  applyMove,
  cloneSheet,
  compareScores,
  emptySheet,
  filledCount,
  lockEstates,
  mustRefuse,
  pickEstates,
  scoreSheet,
  tempMajority,
} from "./sheet.js";
import type {
  Card,
  Combo,
  Config,
  EndReason,
  FinalResult,
  GameCommand,
  GameEvent,
  GameState,
  LogEntry,
  Move,
  Plan,
  PlayRecord,
  Player,
  ScoreBreakdown,
  Sheet,
  Submission,
} from "./types.js";

export const DEFAULT_CONFIG: Config = { minPlayers: 1, maxPlayers: 6, turnSec: 90 };

export function defaultConfig(overrides: Partial<Config> = {}): Config {
  return { ...DEFAULT_CONFIG, ...overrides };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

/** 结算动画多长（毫秒）：每回合翻牌 + 填表；有目标卡首批验证时多放一段彩带。服务器把它加进下一回合的限时、人机的停顿。 */
export const ANIMATION = { roundMs: 1200, planMs: 1500 } as const;

export function animationMs(events: readonly GameEvent[]): number {
  let ms = 0;
  if (events.some((event) => event.type === "RoundResolved")) ms += ANIMATION.roundMs;
  if (events.some((event) => event.type === "PlanApproved")) ms += ANIMATION.planMs;
  return ms;
}

function findPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("你不在这局里。");
  return player;
}

// ───────────────────────── 牌堆 ─────────────────────────

/** 81 张洗好分成 3 堆，各 27 张。 */
function dealStacks(state: GameState, rng: Rng, cards: readonly Card[] = buildDeck()): void {
  const shuffled = rng.shuffle(cards);
  const per = Math.floor(shuffled.length / STACK_COUNT);
  state.stacks = Array.from({ length: STACK_COUNT }, (_, index) => {
    const draw = shuffled.slice(index * per, (index + 1) * per);
    return { draw, drawCount: draw.length, discard: [] };
  });
}

/**
 * 翻牌（补充 1.3 的实体做法）：每堆翻开堆顶一张（行动面朝上进翻牌堆），和它下面露出的那张的数字组成一组。
 * 某堆翻完了（只剩翻开的那张），把这堆翻过的其余牌洗成新堆（规则书 4.1）。
 */
function flip(state: GameState, rng: Rng, events: GameEvent[]): void {
  const combos: Combo[] = [];
  let exhausted = false;
  for (const stack of state.stacks) {
    const flipped = stack.draw.shift();
    if (!flipped) throw new Error("牌堆是空的。");
    stack.discard.push(flipped);
    if (stack.draw.length === 0) {
      stack.draw = rng.shuffle(stack.discard.slice(0, -1));
      stack.discard = [flipped];
      exhausted = true;
    }
    stack.drawCount = stack.draw.length;
    combos.push({ num: stack.draw[0]!.num, action: flipped.action });
  }
  state.combos = combos;
  if (exhausted) events.push({ type: "Reshuffled", by: [], reason: "exhausted" });
  events.push({ type: "RoundStarted", round: state.round, combos });
}

/** 首个完成目标卡的人选了重洗：81 张全部收回洗匀，重新分 3 堆，下一回合从新堆翻。 */
function reshuffleAll(state: GameState, rng: Rng): void {
  const all: Card[] = [];
  for (const stack of state.stacks) all.push(...stack.draw, ...stack.discard);
  all.sort((a, b) => a.id - b.id);
  dealStacks(state, rng, all);
}

// ───────────────────────── 校验一手 ─────────────────────────

function int(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN;
}

/** 只留规则要用的字段（客户端多塞的东西丢掉，不进校验也不进动作序列）。值对不对由 checkSubmission 管。 */
function normalizeMove(raw: unknown): Move | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") throw new Error("这一手不完整。");
  const input = raw as Record<string, unknown>;
  const move: { -readonly [K in keyof Move]: Move[K] } = { combo: int(input.combo), street: int(input.street), house: int(input.house) };
  if (input.temp !== undefined && input.temp !== null) move.temp = int(input.temp);
  if (input.improve !== undefined && input.improve !== null) move.improve = int(input.improve);
  if (input.park === true) move.park = true;
  if (input.pool === true) move.pool = true;
  if (input.fence && typeof input.fence === "object") {
    const fence = input.fence as Record<string, unknown>;
    move.fence = { street: int(fence.street), pos: int(fence.pos) };
  }
  if (input.bis && typeof input.bis === "object") {
    const bis = input.bis as Record<string, unknown>;
    const from = int(bis.from);
    move.bis = { street: int(bis.street), house: int(bis.house), from: from === -1 ? -1 : 1 };
    if (from !== -1 && from !== 1) throw new Error("bis 只能复制左右相邻的房子。");
  }
  return move;
}

function normalizeSubmission(raw: unknown): Submission {
  if (!raw || typeof raw !== "object") throw new Error("这一手不完整。");
  const input = raw as Record<string, unknown>;
  const submission: { -readonly [K in keyof Submission]: Submission[K] } = { move: normalizeMove(input.move) };
  if (Array.isArray(input.plans)) {
    const plans = input.plans.map(int);
    if (plans.length > 3 || plans.some((plan) => !(plan >= 0 && plan <= 2)) || new Set(plans).size !== plans.length) {
      throw new Error("目标卡选得不对。");
    }
    if (plans.length > 0) submission.plans = plans.sort((a, b) => a - b);
  }
  if (input.reshuffle === true) submission.reshuffle = true;
  return submission;
}

/** 把收到的动作整理成只含规则要用的字段。 */
export function normalizeCommand(raw: unknown): GameCommand {
  if (!raw || typeof raw !== "object") throw new Error("未知的行动。");
  const input = raw as Record<string, unknown>;
  const step = typeof input.step === "string" && input.step.length <= 40 ? { step: input.step } : {};
  switch (input.type) {
    case "submit":
      return { type: "submit", submission: normalizeSubmission(input.submission), ...step };
    case "retract":
      return { type: "retract", ...step };
    default:
      throw new Error("未知的行动。");
  }
}

/**
 * 把一手（含目标卡）写到表上，返回新表、写下的数字、验证成功的目标卡。不合法就抛出中文原因。
 * firstBatch(plan)：这张卡到这回合之前还没人验证过（同回合首批都记高分）。
 */
export function resolveSubmission(
  sheet: Sheet,
  submission: Submission,
  combos: readonly Combo[],
  plans: readonly Plan[],
  round: number,
): { sheet: Sheet; number: number | null; claimed: { plan: number; score: number }[]; refused: boolean } {
  let next: Sheet;
  let number: number | null = null;
  let refused = false;
  if (submission.move) {
    const move = submission.move;
    const combo = combos[move.combo];
    if (!combo) throw new Error("没有这一组。");
    const result = applyMove(sheet, move, combo, round);
    next = result.sheet;
    number = result.number;
  } else {
    if (!mustRefuse(sheet, combos)) throw new Error("还有地方能填，不能拒批。");
    if (sheet.refusals >= MAX_REFUSALS) throw new Error("拒批已经满了。");
    next = cloneSheet(sheet);
    next.refusals += 1;
    refused = true;
  }
  const claimed: { plan: number; score: number }[] = [];
  for (const planIndex of submission.plans ?? []) {
    const plan = plans[planIndex];
    if (!plan) throw new Error("没有这张目标卡。");
    if (next.plans[planIndex] !== null) throw new Error("这张目标卡你已经验证过了。");
    const picked = pickEstates(next, plan.need);
    if (!picked) throw new Error(`目标卡 n°${plan.tier + 1} 还没完成。`);
    next = lockEstates(next, picked, planIndex);
    const score = plan.approvedRound === null || plan.approvedRound === round ? plan.high : plan.low;
    next.plans[planIndex] = score;
    claimed.push({ plan: planIndex, score });
  }
  return { sheet: next, number, claimed, refused };
}

/** 只校验，不改：合法返回 null，不合法返回原因。 */
export function checkSubmission(state: GameState, playerId: string, submission: Submission): string | null {
  try {
    const player = findPlayer(state, playerId);
    resolveSubmission(player.sheet, normalizeSubmission(submission), state.combos, state.plans, state.round);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ───────────────────────── 结算 ─────────────────────────

/** 全员交齐：一次性结算所有人，判目标卡、重洗、终局，然后翻下一回合。 */
function resolveRound(state: GameState, rng: Rng, autoPlayers: ReadonlySet<string>, events: GameEvent[]): void {
  const round = state.round;
  const plays: Record<string, PlayRecord> = {};
  const claimers: string[][] = [[], [], []];
  const wantsReshuffle = new Set<string>();
  for (const player of state.players) {
    const submission = player.pending!;
    const result = resolveSubmission(player.sheet, submission, state.combos, state.plans, round);
    player.sheet = result.sheet;
    if (result.refused) events.push({ type: "Refused", player: player.id, count: result.sheet.refusals });
    for (const claim of result.claimed) {
      claimers[claim.plan]!.push(player.id);
      events.push({ type: "PlanClaimed", plan: claim.plan, player: player.id, score: claim.score });
    }
    if (submission.reshuffle) wantsReshuffle.add(player.id);
    const record: PlayRecord = autoPlayers.has(player.id)
      ? { submission, number: result.number, auto: true, claimed: result.claimed }
      : { submission, number: result.number, claimed: result.claimed };
    plays[player.id] = record;
    player.pending = null;
    player.submitted = false;
  }
  const approved: number[] = [];
  const reshuffledBy = new Set<string>();
  state.plans = state.plans.map((plan, index) => {
    if (plan.approvedRound !== null || claimers[index]!.length === 0) return plan;
    approved.push(index);
    events.push({ type: "PlanApproved", plan: index, players: claimers[index]! });
    for (const id of claimers[index]!) if (wantsReshuffle.has(id)) reshuffledBy.add(id);
    return { ...plan, approvedRound: round };
  });
  events.push({ type: "RoundResolved", round });
  const by = state.players.map((player) => player.id).filter((id) => reshuffledBy.has(id));
  state.lastRound = { round, combos: state.combos, plays, approved, reshuffledBy: by };

  const reasons: EndReason[] = [];
  if (state.players.some((player) => player.sheet.refusals >= MAX_REFUSALS)) reasons.push("refusals");
  if (state.players.some((player) => player.sheet.plans.every((score) => score !== null))) reasons.push("plans");
  if (state.players.some((player) => filledCount(player.sheet) >= TOTAL_HOUSES)) reasons.push("full");
  if (reasons.length > 0) {
    finishGame(state, reasons, events);
    return;
  }
  if (by.length > 0) {
    reshuffleAll(state, rng);
    events.push({ type: "Reshuffled", by, reason: "plan" });
  }
  state.round += 1;
  flip(state, rng, events);
}

/** 所有人的分（含临时工多数）。 */
export function scoreAll(state: Pick<GameState, "players">): Record<string, ScoreBreakdown> {
  const majority = tempMajority(Object.fromEntries(state.players.map((player) => [player.id, player.sheet.temps])));
  return Object.fromEntries(state.players.map((player) => [player.id, scoreSheet(player.sheet, majority[player.id] ?? 0)]));
}

/** 名次：按 compareScores，完全相同的并列。 */
export function rankPlayers(scores: Record<string, ScoreBreakdown>): Record<string, number> {
  const ids = Object.keys(scores).sort((a, b) => compareScores(scores[b]!, scores[a]!));
  const ranks: Record<string, number> = {};
  ids.forEach((id, index) => {
    const prev = ids[index - 1];
    ranks[id] = prev !== undefined && compareScores(scores[prev]!, scores[id]!) === 0 ? ranks[prev]! : index + 1;
  });
  return ranks;
}

function finishGame(state: GameState, reasons: EndReason[], events: GameEvent[]): void {
  const scores = scoreAll(state);
  const ranks = rankPlayers(scores);
  const winners = state.players.map((player) => player.id).filter((id) => ranks[id] === 1);
  const result: FinalResult = { winners, scores, ranks, reasons, rounds: state.round };
  state.finalResult = result;
  state.phase = "gameOver";
  state.combos = [];
  events.push({ type: "GameEnded", winners, reasons });
}

// ───────────────────────── apply ─────────────────────────

/** 复制状态给 apply 改：玩家（表整张复制）、牌堆、目标卡复制；事件清空。 */
function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, sheet: cloneSheet(player.sheet) })),
    stacks: state.stacks.map((stack) => ({ draw: stack.draw.slice(), drawCount: stack.drawCount, discard: stack.discard.slice() })),
    plans: state.plans.map((plan) => ({ ...plan })),
    combos: state.combos.slice(),
    events: [],
  };
}

function withoutStep(command: GameCommand): GameCommand {
  const { step: _step, ...rest } = command;
  return rest as GameCommand;
}

/** 本回合被代做的人（超时 / 托管 / 离线），结算时在 lastRound 里标 auto。只在服务端状态里，跟着 log 走。 */
function autoSetOf(state: GameState): Set<string> {
  const set = new Set<string>();
  const log = state.log ?? [];
  // 从后往前找本回合（上一次 RoundStarted 之后）每人最后一次 submit 是不是代做
  const seen = new Set<string>();
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const entry = log[i]!;
    if ((entry as { round?: number }).round !== undefined && (entry as { round?: number }).round !== state.round) break;
    if (entry.command.type !== "submit" || seen.has(entry.player)) continue;
    seen.add(entry.player);
    if (entry.auto) set.add(entry.player);
  }
  return set;
}

function applyInternal(
  state: GameState,
  playerId: string,
  raw: GameCommand,
  rng: Rng,
  autoPlayers: Set<string>,
): { state: GameState; events: GameEvent[] } {
  if (state.phase === "gameOver") throw new Error("对局已经结束。");
  findPlayer(state, playerId);
  const command = normalizeCommand(raw);
  if (command.step !== undefined && command.step !== stepKey(state)) {
    throw new Error("这一回合已经结算了，请看最新的局面再选。");
  }
  const next = cloneState(state);
  const player = findPlayer(next, playerId);
  const events: GameEvent[] = [];
  if (command.type === "submit") {
    const problem = checkSubmission(state, playerId, command.submission);
    if (problem) throw new Error(problem);
    player.pending = command.submission;
    player.submitted = true;
    events.push({ type: "Submitted", player: playerId });
    if (next.players.every((candidate) => candidate.submitted)) resolveRound(next, rng, autoPlayers, events);
  } else {
    if (!player.submitted) throw new Error("你还没交。");
    player.pending = null;
    player.submitted = false;
    autoPlayers.delete(playerId);
    events.push({ type: "Retracted", player: playerId });
  }
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

/**
 * 纯函数：playerId 做 command，返回新状态和这一步的事件，不改输入。随机数（翻牌、重洗）从 rng 取。
 * 教程、预览、模拟用它；服务端用 applyCommand（从 state.rngState 恢复 rng，记动作序列和代做标记）。
 */
export function apply(state: GameState, playerId: string, command: GameCommand, rng: Rng): { state: GameState; events: GameEvent[] } {
  return applyInternal(state, playerId, command, rng, new Set());
}

/** 服务端记的「本回合谁是代做的」：放在 log 里每条带回合号。 */
interface RoundLogEntry extends LogEntry {
  readonly round: number;
}

function runCommand(state: GameState, playerId: string, command: GameCommand, auto = false): { state: GameState; events: GameEvent[] } {
  const rng = state.rngState !== undefined ? restoreRng(state.rngState) : rngFromSeed(state.seed ?? 0);
  const autoPlayers = autoSetOf(state);
  const clean = withoutStep(normalizeCommand(command));
  if (clean.type === "submit") {
    if (auto) autoPlayers.add(playerId);
    else autoPlayers.delete(playerId);
  }
  const { state: next, events } = applyInternal(state, playerId, command, rng, autoPlayers);
  next.rngState = rng.state;
  const entry: RoundLogEntry = auto
    ? { player: playerId, command: clean, auto: true, round: state.round }
    : { player: playerId, command: clean, round: state.round };
  next.log = [...(state.log ?? []), entry];
  return { state: next, events };
}

/** 服务端用：随机数状态存在 state.rngState，动作记进 state.log。opts.auto：替这个座位代做的（超时、托管、离线）。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand, opts: { auto?: boolean } = {}): GameState {
  return runCommand(state, playerId, command, opts.auto === true).state;
}

/** 还要等谁交：本回合没交的人。 */
export function waitingFor(state: GameState): string[] {
  if (state.phase !== "play") return [];
  return state.players.filter((player) => !player.submitted).map((player) => player.id);
}

/** 计时的 key：只在换回合时变，别人交 / 撤回不会重置倒计时。 */
export function stepKey(state: GameState): string {
  return state.phase === "gameOver" ? "over" : `r${state.round}`;
}

export type TimeoutPolicy = (view: GameState, playerId: string) => Submission | null;

/** 最简单的合法一手：能填就挑数字最小的那组、填最左边能填的位置，不用行动；不能填就拒批。超时策略出错时兜底用。 */
export function fallbackSubmission(state: GameState, playerId: string): Submission {
  const sheet = findPlayer(state, playerId).sheet;
  if (mustRefuse(sheet, state.combos)) return { move: null };
  const order = state.combos.map((combo, index) => ({ combo, index })).sort((a, b) => a.combo.num - b.combo.num);
  for (const { combo, index } of order) {
    for (let street = 0; street < sheet.houses.length; street += 1) {
      for (let house = 0; house < sheet.houses[street]!.length; house += 1) {
        const move: Move = { combo: index, street, house };
        if (checkSubmission(state, playerId, { move }) === null) return { move };
      }
    }
    if (combo.action === "temp") {
      for (const temp of [-2, -1, 1, 2]) {
        for (let street = 0; street < sheet.houses.length; street += 1) {
          for (let house = 0; house < sheet.houses[street]!.length; house += 1) {
            const move: Move = { combo: index, street, house, temp };
            if (checkSubmission(state, playerId, { move }) === null) return { move };
          }
        }
      }
    }
  }
  return { move: null };
}

function autoSubmission(state: GameState, playerId: string, policy: TimeoutPolicy): Submission {
  const view = redactGameForViewer(state, playerId);
  let submission: Submission | null = null;
  try {
    submission = policy(view, playerId);
  } catch {
    submission = null;
  }
  if (submission && checkSubmission(state, playerId, submission) === null) return submission;
  return fallbackSubmission(state, playerId);
}

/**
 * 这一回合到点：所有没交的人由系统代做（policy，服务器传人机；默认兜底的最简单一手），最后一个交上就结算。
 * 事件最前面是 TimedOut。
 */
export function timeoutTurn(state: GameState, policy: TimeoutPolicy = fallbackSubmission): GameState {
  if (state.phase !== "play") return state;
  const players = waitingFor(state);
  let current = state;
  const events: GameEvent[] = [];
  const round = state.round;
  for (const playerId of players) {
    if (current.phase !== "play" || current.round !== round || !waitingFor(current).includes(playerId)) continue;
    const step = runCommand(current, playerId, { type: "submit", submission: autoSubmission(current, playerId, policy) }, true);
    events.push(...step.events);
    current = step.state;
  }
  if (current === state) return state;
  current.events = [{ type: "TimedOut", players }, ...events];
  return current;
}

// ───────────────────────── 隐藏信息 ─────────────────────────

function stripServerOnly(state: GameState): GameState {
  const { seed: _seed, rngState: _rngState, log: _log, ...rest } = state;
  const view = structuredClone(rest) as GameState;
  view.stacks = view.stacks.map((stack) => ({ draw: [], drawCount: stack.drawCount, discard: stack.discard }));
  return view;
}

/**
 * viewerId 能看到的状态：牌堆顺序、种子、随机数状态、动作序列去掉；别人这回合交的内容换成 null（只留「已交」）。
 * viewerId 不是玩家（比如 ""）时谁交的内容都看不到。
 */
export function redactGameForViewer(state: GameState, viewerId: string): GameState {
  const view = stripServerOnly(state);
  view.players = view.players.map((player) => (player.id === viewerId ? player : { ...player, pending: null }));
  return view;
}

/** 观战：seeAll（房主允许观战看全部）时能看到每个人这回合交了什么；牌堆顺序始终看不到。 */
export function redactGameForSpectator(state: GameState, seeAll: boolean): GameState {
  if (!seeAll) return redactGameForViewer(state, "");
  return stripServerOnly(state);
}

// ───────────────────────── 开局 ─────────────────────────

function randomSeed(): number | string {
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return Math.floor(Math.random() * 2 ** 32);
}

export interface CreateOptions {
  /** 指定 3 张目标卡的编号（如 ["1-1", "2-3", "3-6"]），测试、教程用；不给就每档随机一张。 */
  readonly plans?: readonly string[];
  /** 指定 3 堆的牌（每堆从堆顶往下，用 data.buildDeck() 的 Card），测试、教程用；不给就洗牌。 */
  readonly stacks?: readonly (readonly Card[])[];
  readonly config?: Partial<Config>;
}

/**
 * 开一场新对局（第 1 回合已翻好）。seed 决定所有洗牌：**服务器必须给 128–256 位的十六进制串**（ChaCha20）；
 * 数字种子（mulberry32）只给测试、教程、预览用。
 */
export function createGame(players: readonly NewPlayer[], seed: number | string = randomSeed(), options: CreateOptions = {}): GameState {
  const config = defaultConfig(options.config);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) throw new Error("玩家 id 重复。");
  const rng = rngFromSeed(seed);
  const planIds = options.plans ?? [0, 1, 2].map((tier) => rng.pick(PLAN_DEFS.filter((plan) => plan.tier === tier)).id);
  const plans: Plan[] = planIds.map((id, index) => {
    const def = planDef(id);
    if (def.tier !== index) throw new Error(`第 ${index + 1} 张目标卡要是 n°${index + 1}。`);
    return { id: def.id, tier: def.tier, need: def.need, high: def.high, low: def.low, approvedRound: null };
  });
  const state: GameState = {
    config,
    phase: "play",
    players: players.map((player, seat) => ({ id: player.id, name: player.name, seat, sheet: emptySheet(), submitted: false, pending: null })),
    round: 1,
    combos: [],
    stacks: [],
    plans,
    lastRound: null,
    events: [],
    version: 0,
    seed,
    log: [],
  };
  if (options.stacks) {
    const ids = options.stacks.flat().map((card) => card.id);
    if (options.stacks.length !== STACK_COUNT || ids.length !== DECK_SIZE || new Set(ids).size !== DECK_SIZE) {
      throw new Error("指定的牌堆要正好是 3 堆、81 张不重复。");
    }
    state.stacks = options.stacks.map((cards) => ({ draw: cards.slice(), drawCount: cards.length, discard: [] }));
  } else {
    dealStacks(state, rng);
  }
  const events: GameEvent[] = [];
  flip(state, rng, events);
  state.events = events;
  state.rngState = rng.state;
  return state;
}

/** 测试、模拟用：数字种子的 Rng。 */
export function testRng(seed: number): Rng {
  return createRng(seed);
}
