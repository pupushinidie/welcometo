import type { Column } from "./board.js";

export interface Config {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 占领几条赛道获胜。 */
  readonly columnsToWin: number;
  /** 临时标记（登山者）个数：一回合最多推进几条不同赛道。 */
  readonly runners: number;
  /** 每一步（掷骰、选配对、决定再掷还是收手）的限时；超时自动处理，见 timeoutTurn。 */
  readonly stepTimeoutSec: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 座位色下标 0–3（红、蓝、绿、黄），开局按入座顺序定。 */
  readonly color: number;
  /** 已占领的赛道数；房间列表里当作「分数」显示。 */
  score: number;
  /** 各赛道已锁定的永久高度（营地）：下标是赛道编号 2–12，0 表示还没上这条赛道。 */
  progress: number[];
}

/** 本回合的一个临时标记（登山者）：在哪条赛道、爬到第几格（1 = 最底下一格）。 */
export interface Runner {
  readonly column: Column;
  height: number;
}

/** 一种推进方式：按顺序推进的赛道；[7, 7] 表示 7 号赛道走 2 步。 */
export interface MoveOption {
  readonly sums: Column[];
  /** 哪几种配对能得到这个推进（PAIRINGS 的下标），界面用来标出骰子怎么分组。 */
  readonly pairings: number[];
}

/**
 * roll：回合开始，只能掷骰；
 * choose：骰子已掷出，必须选一种推进方式；
 * decide：推进完毕，选择再掷或收手。
 */
export type Stage = "roll" | "choose" | "decide";

export type GameCommand =
  | { readonly type: "ROLL" }
  | { readonly type: "CHOOSE"; readonly sums: number[] }
  | { readonly type: "STOP" };

/** 某条赛道上本次收手锁定的进度。 */
export interface SavedProgress {
  readonly column: Column;
  readonly from: number;
  readonly to: number;
}

export type GameEvent =
  | { readonly type: "Rolled"; readonly player: string; readonly dice: number[] }
  | { readonly type: "Advanced"; readonly player: string; readonly sums: Column[] }
  /** 怎么配对都走不了：本回合的临时进度全部作废。 */
  | { readonly type: "Busted"; readonly player: string; readonly dice: number[]; readonly lost: Runner[] }
  | { readonly type: "Stopped"; readonly player: string; readonly saved: SavedProgress[] }
  | { readonly type: "ColumnClaimed"; readonly player: string; readonly column: Column; readonly bumped: string[] }
  | { readonly type: "TurnStarted"; readonly player: string }
  | { readonly type: "GameEnded"; readonly winner: string }
  | { readonly type: "TurnTimedOut"; readonly player: string; readonly stage: Stage };

/** 最近一次掷骰，留在桌上给所有人看（爆掉后也保留到下一次掷骰）。 */
export interface LastRoll {
  readonly player: string;
  readonly dice: number[];
  readonly bust: boolean;
  /** 选了哪种推进（选完才有）。 */
  readonly chosen?: Column[];
}

export interface FinalResult {
  readonly winner: string;
  /** 每位玩家占领的赛道。 */
  readonly claimed: Record<string, Column[]>;
}

export interface GameState {
  readonly config: Config;
  phase: "playing" | "finished";
  players: Player[];
  /** 当前玩家在 players 里的下标。 */
  currentPlayer: number;
  /** 第几个回合（每换一位玩家 +1，从 1 开始）。 */
  turn: number;
  /** 本回合内第几步；服务端按 turn + step 给每一步单独计时。 */
  step: number;
  stage: Stage;
  /** 本回合的临时标记，最多 config.runners 个。 */
  runners: Runner[];
  /** 已被占领（关闭）的赛道：赛道编号 → 玩家 id。 */
  owners: Partial<Record<Column, string>>;
  /** 当前骰子（choose 阶段）可选的推进方式。 */
  options: MoveOption[];
  lastRoll?: LastRoll;
  /** 本回合掷了几次骰（界面显示用）。 */
  rollsThisTurn: number;
  events: GameEvent[];
  finalResult?: FinalResult;
  /** 每个动作 +1；前端据此判断是不是新事件。 */
  version: number;
  /** 以下只在服务端：随机数状态、动作序列。 */
  seed?: number;
  rngState?: number;
  log?: { player: string; command: GameCommand | { type: "TIMEOUT" } }[];
}
