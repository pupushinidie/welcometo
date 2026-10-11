/**
 * 欢迎来到：类型。数值表（街长、泳池位、各轨道印面值、牌库、目标卡）在 data.ts。
 *
 * 一回合 = 全员同时提交一手（选组 + 填位 + 行动参数 + 验证目标卡 + 是否重洗），
 * 提交前可撤回；最后一人提交的瞬间服务器一次性结算所有人，再翻下一回合的 3 组。
 */

/** 6 种行动：栅栏 / 改造 / 公园 / 泳池 / 临时工 / bis。 */
export type Action = "fence" | "improve" | "park" | "pool" | "temp" | "bis";

/** 一张建造牌：正面数字、背面行动（印死的配对，见补充文件 1.3）。id 0–80 全局唯一。 */
export interface Card {
  readonly id: number;
  readonly num: number;
  readonly action: Action;
}

/** 本回合的一组「数字 + 行动」：数字来自这堆露出的那张（下一张），行动来自刚翻开的那张。 */
export interface Combo {
  readonly num: number;
  readonly action: Action;
}

/** 房子：门牌号、是不是 bis 复制来的、第几回合填的（界面放动画、日志用）。 */
export interface House {
  readonly num: number;
  readonly bis: boolean;
  readonly round: number;
}

/** 一个被目标卡用掉的小区（在房子上方画线）：之后不能再拆、不能再给别的卡用。 */
export interface UsedEstate {
  readonly street: number;
  /** 第一座房子的下标（0 起）。 */
  readonly start: number;
  readonly size: number;
  /** 给哪张目标卡用的（0–2）。 */
  readonly plan: number;
}

/** 一个玩家的表（公开）。 */
export interface Sheet {
  /** 3 条街，长度 10/11/12；null = 还没填。 */
  houses: (House | null)[][];
  /** 每条街相邻两房之间的栅栏：fences[s][i] = 第 i 和第 i+1 座之间有没有栅栏（两端固定有，不存）。 */
  fences: boolean[][];
  /** 每条街每个门牌位的泳池是不是建成了（只有泳池位能是 true）。 */
  pools: boolean[][];
  /** 每条街公园轨已勾几格。 */
  parks: number[];
  /** 泳池轨已勾几格（= 建成的泳池数）。 */
  poolTrack: number;
  /** 小区尺寸 1–6 各列已改造几格（下标 0 = 尺寸 1）。 */
  improve: number[];
  /** 临时工已勾几格（0–11）。 */
  temps: number;
  /** bis 罚分轨已勾几格（0–9）。 */
  bis: number;
  /** 拒批轨已勾几格（0–3）。 */
  refusals: number;
  /** 3 张目标卡各自记的分（null = 还没验证）。 */
  plans: (number | null)[];
  /** 用于目标卡的小区。 */
  usedEstates: UsedEstate[];
}

/** 一张目标卡（公开）。 */
export interface Plan {
  /** 卡编号，如 "1-3"（n°1 的第 3 张）。 */
  readonly id: string;
  /** 0 / 1 / 2 = n°1 / n°2 / n°3。 */
  readonly tier: number;
  /** 需要的完成小区尺寸，从小到大，如 [3, 4] = 1 个 3 房 + 1 个 4 房。 */
  readonly need: readonly number[];
  /** 项目面（首批验证）分值。 */
  readonly high: number;
  /** 获批面（之后验证）分值。 */
  readonly low: number;
  /** 首批验证在第几回合（null = 还没人验证，仍是项目面）。 */
  approvedRound: number | null;
}

/**
 * 一手：选第 combo 组，把数字（临时工调整后）写进 street 街 house 号位，再按需用这组的行动。
 * 行动参数只能给和这组行动对应的那一个；不给 = 不用行动（行动是可选的）。
 */
export interface Move {
  readonly combo: number;
  readonly street: number;
  readonly house: number;
  /** 临时工：这组行动是临时工时，-2..2（0 也算用了，要勾一格）。不给 = 不用临时工。 */
  readonly temp?: number;
  /** 栅栏：画在 street 街第 pos 和 pos+1 座之间（任意一条街）。 */
  readonly fence?: { readonly street: number; readonly pos: number };
  /** 改造：尺寸 1–6。 */
  readonly improve?: number;
  /** 公园：勾在填数字的那条街。 */
  readonly park?: boolean;
  /** 泳池：数字写进还没建泳池的泳池位时圈出泳池、勾泳池轨。 */
  readonly pool?: boolean;
  /** bis：把 street 街 house 号位旁边（from = -1 左边 / 1 右边）那座的号码复制进这个空位（任意一条街）。 */
  readonly bis?: { readonly street: number; readonly house: number; readonly from: -1 | 1 };
}

/** 一回合交上去的整手：要么一手 move，要么拒批（3 组都填不进去时）；都可以顺带验证目标卡。 */
export interface Submission {
  /** 拒批时为 null。 */
  readonly move: Move | null;
  /** 本手要验证的目标卡（0–2），在这手填完、行动用完之后的表上判定；用哪几个小区由服务器自动挑（pickEstates）。 */
  readonly plans?: readonly number[];
  /** 勾了「如果我首个完成目标卡就重洗」：这回合是某张目标卡的首批验证者时，把 81 张建造牌全部重洗。 */
  readonly reshuffle?: boolean;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly seat: number;
  sheet: Sheet;
  /** 这回合交了没有（公开）。 */
  submitted: boolean;
  /** 这回合交的那一手。**隐藏**：结算前只有自己看得到，别人看到 null。 */
  pending: Submission | null;
}

/** 上一回合一个人做了什么。 */
export interface PlayRecord {
  readonly submission: Submission;
  /** 实际写下的数字（临时工调整后）；拒批为 null。 */
  readonly number: number | null;
  /** 超时 / 托管 / 离线代做。 */
  readonly auto?: true;
  /** 这一手验证成功的目标卡和记的分。 */
  readonly claimed: { readonly plan: number; readonly score: number }[];
}

/** 上一回合的结算（结算后公开，给界面放动画、日志、重连补看）。 */
export interface RoundRecord {
  readonly round: number;
  readonly combos: Combo[];
  readonly plays: Record<string, PlayRecord>;
  /** 本回合被首批验证（翻到获批面）的目标卡。 */
  readonly approved: number[];
  /** 勾了重洗、而且这回合确实触发了重洗的人。 */
  readonly reshuffledBy: string[];
}

export interface ScoreBreakdown {
  readonly plans: number;
  readonly parks: number;
  readonly pools: number;
  readonly temps: number;
  /** 每个尺寸的完成小区数（下标 0 = 尺寸 1）。 */
  readonly estateCounts: number[];
  /** 每个尺寸的单价（该列最小可见值）。 */
  readonly estateValues: number[];
  readonly estates: number;
  /** 罚分，正数，从总分里减。 */
  readonly bis: number;
  readonly refusals: number;
  readonly total: number;
}

export type EndReason = "refusals" | "plans" | "full";

export interface FinalResult {
  /** 总分最高（再比完成小区数、1 房小区数……）的人；全平就都算赢。 */
  readonly winners: string[];
  readonly scores: Record<string, ScoreBreakdown>;
  /** 名次（1 起，并列同名次）。 */
  readonly ranks: Record<string, number>;
  /** 为什么结束：拒批满 3 次 / 验证完 3 张目标卡 / 33 房填满（可能同时几条）。 */
  readonly reasons: EndReason[];
  readonly rounds: number;
}

export interface Config {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 每回合限时（秒）；超时由人机替还没交的人做。开工拍板 90 秒。 */
  readonly turnSec: number;
}

export type Phase = "play" | "gameOver";

/**
 * 玩家动作。step = 发出时看到的 stepKey(game)（回合号），对不上就拒绝（迟到的点击不落到下一回合）。网页一定要带。
 */
export type GameCommand =
  | { readonly type: "submit"; readonly submission: Submission; readonly step?: string }
  | { readonly type: "retract"; readonly step?: string };

export type GameEvent =
  /** 有人交了（不含内容）。重交也发这个。 */
  | { readonly type: "Submitted"; readonly player: string }
  | { readonly type: "Retracted"; readonly player: string }
  /** 全员交齐，结算完这一回合。 */
  | { readonly type: "RoundResolved"; readonly round: number }
  /** 目标卡首批验证（翻到获批面）。 */
  | { readonly type: "PlanApproved"; readonly plan: number; readonly players: string[] }
  | { readonly type: "PlanClaimed"; readonly plan: number; readonly player: string; readonly score: number }
  | { readonly type: "Refused"; readonly player: string; readonly count: number }
  | { readonly type: "Reshuffled"; readonly by: string[]; readonly reason: "plan" | "exhausted" }
  /** 新回合翻好 3 组。 */
  | { readonly type: "RoundStarted"; readonly round: number; readonly combos: Combo[] }
  | { readonly type: "GameEnded"; readonly winners: string[]; readonly reasons: EndReason[] }
  | { readonly type: "TimedOut"; readonly players: string[] };

export interface LogEntry {
  readonly player: string;
  readonly command: GameCommand;
  readonly auto?: true;
}

/** 一堆建造牌。 */
export interface Stack {
  /** **隐藏**：没翻的牌，draw[0] 是堆顶（露出数字的那张）。下发时清空。 */
  draw: Card[];
  /** 没翻的张数（公开，含露出数字的那张）。 */
  drawCount: number;
  /** 翻过的牌（行动面朝上），最后一张是本回合这组的行动牌（公开）。 */
  discard: Card[];
}

export interface GameState {
  readonly config: Config;
  phase: Phase;
  players: Player[];
  /** 第几回合（从 1 起）。 */
  round: number;
  /** 本回合 3 组（公开）。 */
  combos: Combo[];
  stacks: Stack[];
  plans: Plan[];
  /** 上一回合的结算（公开）。 */
  lastRound: RoundRecord | null;
  /** 最近一步产生的事件。 */
  events: GameEvent[];
  finalResult?: FinalResult;
  /** 每个动作 +1；界面看它变没变触发动画。 */
  version: number;
  /** 以下只在服务端：种子、随机数状态、动作序列。 */
  seed?: number | string;
  rngState?: number | string;
  log?: LogEntry[];
}
