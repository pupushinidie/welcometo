import { COLUMNS, COLUMN_HEIGHTS, MAX_HEIGHT, PAIRINGS, isColumn, type Column } from "./board.js";
import { createRng, type Rng } from "./rng.js";
import type {
  Config,
  GameCommand,
  GameEvent,
  GameState,
  MoveOption,
  Player,
  Runner,
  SavedProgress,
} from "./types.js";

export function defaultConfig(_playerCount: number, overrides: Partial<Config> = {}): Config {
  return {
    minPlayers: 2,
    maxPlayers: 4,
    columnsToWin: 3,
    runners: 3,
    stepTimeoutSec: 45,
    ...overrides,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

function currentPlayerId(state: GameState): string {
  return state.players[state.currentPlayer]?.id ?? "";
}

function currentPlayer(state: GameState): Player {
  const player = state.players[state.currentPlayer];
  if (!player) throw new Error("找不到当前玩家。");
  return player;
}

/**
 * 在临时标记上按顺序推进 sums，返回推进后的标记；做不到（赛道已关闭、已在顶格、没有空闲的临时标记）返回 null。
 * 新上一条赛道时，从自己的营地（永久标记）上方一格开始；还没上过就从最底下一格开始。
 */
export function advanceRunners(
  state: Pick<GameState, "owners" | "config">,
  player: Pick<Player, "progress">,
  runners: readonly Runner[],
  sums: readonly Column[],
): Runner[] | null {
  const next = runners.map((runner) => ({ ...runner }));
  for (const column of sums) {
    if (state.owners[column]) return null;
    const runner = next.find((entry) => entry.column === column);
    if (runner) {
      if (runner.height >= COLUMN_HEIGHTS[column]) return null;
      runner.height += 1;
    } else {
      if (next.length >= state.config.runners) return null;
      next.push({ column, height: (player.progress[column] ?? 0) + 1 });
    }
  }
  return next;
}

/**
 * 这把骰子所有合法的推进方式。每种配对得到两个和：两个都能走就必须都走；
 * 只能走其中一个（比如只剩 1 个临时标记、两条都是新赛道）就各算一种选择。
 * 不同配对得到同样的推进时合并成一项。没有任何选择就是爆掉。
 */
export function moveOptions(
  state: Pick<GameState, "owners" | "config">,
  player: Pick<Player, "progress">,
  runners: readonly Runner[],
  dice: readonly number[],
): MoveOption[] {
  const found = new Map<string, { sums: Column[]; pairings: number[] }>();
  const add = (sums: Column[], pairing: number) => {
    const key = sums.join("+");
    const existing = found.get(key);
    if (!existing) found.set(key, { sums, pairings: [pairing] });
    else if (!existing.pairings.includes(pairing)) existing.pairings.push(pairing);
  };
  PAIRINGS.forEach(([[a, b], [c, d]], index) => {
    const first = (dice[a]! + dice[b]!) as Column;
    const second = (dice[c]! + dice[d]!) as Column;
    const low = Math.min(first, second) as Column;
    const high = Math.max(first, second) as Column;
    if (advanceRunners(state, player, runners, [low, high])) {
      add([low, high], index);
      return;
    }
    if (advanceRunners(state, player, runners, [low])) add([low], index);
    if (high !== low && advanceRunners(state, player, runners, [high])) add([high], index);
  });
  return [...found.values()];
}

/** 当前玩家再掷一次爆掉的概率（枚举 6^4 种结果）。 */
export function bustProbability(state: GameState): number {
  const player = state.players[state.currentPlayer];
  if (!player) return 0;
  let busts = 0;
  const dice = [1, 1, 1, 1];
  for (let roll = 0; roll < 1296; roll += 1) {
    dice[0] = (roll % 6) + 1;
    dice[1] = (Math.floor(roll / 6) % 6) + 1;
    dice[2] = (Math.floor(roll / 36) % 6) + 1;
    dice[3] = Math.floor(roll / 216) + 1;
    if (moveOptions(state, player, state.runners, dice).length === 0) busts += 1;
  }
  return busts / 1296;
}

function endTurn(state: GameState, events: GameEvent[]): void {
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  state.turn += 1;
  state.step = 0;
  state.stage = "roll";
  state.runners = [];
  state.options = [];
  state.rollsThisTurn = 0;
  events.push({ type: "TurnStarted", player: currentPlayerId(state) });
}

function finishGame(state: GameState, winner: Player, events: GameEvent[]): void {
  state.phase = "finished";
  state.stage = "roll";
  state.runners = [];
  state.options = [];
  const claimed = Object.fromEntries(
    state.players.map((player) => [player.id, COLUMNS.filter((column) => state.owners[column] === player.id)]),
  );
  state.finalResult = { winner: winner.id, claimed };
  events.push({ type: "GameEnded", winner: winner.id });
}

function applyRoll(state: GameState, player: Player, rng: Rng, events: GameEvent[]): void {
  if (state.stage === "choose") throw new Error("先选一种推进方式。");
  const dice = Array.from({ length: 4 }, () => rng.int(6) + 1);
  state.rollsThisTurn += 1;
  events.push({ type: "Rolled", player: player.id, dice });
  const options = moveOptions(state, player, state.runners, dice);
  if (options.length === 0) {
    events.push({ type: "Busted", player: player.id, dice, lost: state.runners.map((runner) => ({ ...runner })) });
    state.lastRoll = { player: player.id, dice, bust: true };
    endTurn(state, events);
    return;
  }
  state.lastRoll = { player: player.id, dice, bust: false };
  state.options = options;
  state.stage = "choose";
  state.step += 1;
}

function applyChoose(state: GameState, player: Player, sums: unknown, events: GameEvent[]): void {
  if (state.stage !== "choose") throw new Error("现在不需要选择推进方式。");
  if (!Array.isArray(sums) || !sums.every(isColumn)) throw new Error("推进方式不正确。");
  const option = state.options.find((entry) =>
    entry.sums.length === sums.length && entry.sums.every((column, index) => column === sums[index]),
  );
  if (!option) throw new Error("这把骰子不能这样走。");
  state.runners = advanceRunners(state, player, state.runners, option.sums)!;
  state.options = [];
  if (state.lastRoll) state.lastRoll = { ...state.lastRoll, chosen: option.sums };
  state.stage = "decide";
  state.step += 1;
  events.push({ type: "Advanced", player: player.id, sums: option.sums });
}

function applyStop(state: GameState, player: Player, events: GameEvent[]): void {
  if (state.stage === "roll") throw new Error("这回合还没掷骰，不能收手。");
  if (state.stage === "choose") throw new Error("先选一种推进方式。");
  const saved: SavedProgress[] = state.runners.map((runner) => ({
    column: runner.column,
    from: player.progress[runner.column] ?? 0,
    to: runner.height,
  }));
  for (const runner of state.runners) player.progress[runner.column] = runner.height;
  events.push({ type: "Stopped", player: player.id, saved });

  for (const runner of state.runners) {
    if (runner.height < COLUMN_HEIGHTS[runner.column]) continue;
    // 登顶：占领这条赛道，其他人在这条赛道上的营地全部撤下，赛道永久关闭。
    state.owners[runner.column] = player.id;
    const bumped: string[] = [];
    for (const other of state.players) {
      if (other.id === player.id || (other.progress[runner.column] ?? 0) === 0) continue;
      other.progress[runner.column] = 0;
      bumped.push(other.id);
    }
    player.score += 1;
    events.push({ type: "ColumnClaimed", player: player.id, column: runner.column, bumped });
  }
  state.runners = [];
  if (player.score >= state.config.columnsToWin) {
    finishGame(state, player, events);
    return;
  }
  endTurn(state, events);
}

export function apply(state: GameState, playerId: string, command: GameCommand, rng: Rng): { state: GameState; events: GameEvent[] } {
  if (state.phase === "finished") throw new Error("对局已经结束。");
  if (currentPlayerId(state) !== playerId) throw new Error("还没轮到你。");

  const next = structuredClone(state);
  const player = currentPlayer(next);
  const events: GameEvent[] = [];
  switch (command?.type) {
    case "ROLL":
      applyRoll(next, player, rng, events);
      break;
    case "CHOOSE":
      applyChoose(next, player, command.sums, events);
      break;
    case "STOP":
      applyStop(next, player, events);
      break;
    default:
      throw new Error("未知的行动。");
  }
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

function runCommand(state: GameState, playerId: string, command: GameCommand): { state: GameState; events: GameEvent[] } {
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const { state: next, events } = apply(state, playerId, command, rng);
  next.rngState = rng.state;
  next.log = [...(state.log ?? []), { player: playerId, command }];
  return { state: next, events };
}

export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  return runCommand(state, playerId, command).state;
}

export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase === "finished" || currentPlayerId(state) !== playerId) return [];
  switch (state.stage) {
    case "roll":
      return [{ type: "ROLL" }];
    case "choose":
      return state.options.map((option) => ({ type: "CHOOSE", sums: [...option.sums] }));
    case "decide":
      return [{ type: "ROLL" }, { type: "STOP" }];
  }
}

/**
 * 当前这一步超时：
 * - 回合开始还没掷骰 → 跳过这回合；
 * - 掷了骰没选 → 自动选第一种推进方式，然后收手；
 * - 推进完没决定 → 收手（保住本回合进度）。
 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "finished") return state;
  const playerId = currentPlayerId(state);
  const stage = state.stage;
  let current: GameState;
  const events: GameEvent[] = [];
  if (stage === "roll") {
    current = structuredClone(state);
    endTurn(current, events);
    current.version += 1;
    current.log = [...(state.log ?? []), { player: playerId, command: { type: "TIMEOUT" } }];
  } else {
    current = state;
    if (stage === "choose") {
      const step = runCommand(current, playerId, { type: "CHOOSE", sums: [...state.options[0]!.sums] });
      events.push(...step.events);
      current = step.state;
    }
    const step = runCommand(current, playerId, { type: "STOP" });
    events.push(...step.events);
    current = step.state;
  }
  current.events = [{ type: "TurnTimedOut", player: playerId, stage }, ...events];
  return current;
}

/** 这个游戏没有隐藏信息，只去掉服务端才需要的种子、随机数状态和动作序列。 */
export function redactGameForViewer(state: GameState, _viewerId: string): GameState {
  const { seed: _seed, rngState: _rngState, log: _log, ...rest } = state;
  return rest;
}

export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  overrides: Partial<Config> = {},
): GameState {
  const config = defaultConfig(players.length, overrides);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  const rng = createRng(seed);
  const startPlayer = rng.int(players.length);
  const state: GameState = {
    config,
    phase: "playing",
    players: players.map((player, index) => ({
      id: player.id,
      name: player.name,
      color: index,
      score: 0,
      progress: new Array<number>(MAX_HEIGHT).fill(0),
    })),
    currentPlayer: startPlayer,
    turn: 1,
    step: 0,
    stage: "roll",
    runners: [],
    owners: {},
    options: [],
    rollsThisTurn: 0,
    events: [],
    version: 0,
    seed,
  };
  state.events = [{ type: "TurnStarted", player: currentPlayerId(state) }];
  state.rngState = rng.state;
  return state;
}
