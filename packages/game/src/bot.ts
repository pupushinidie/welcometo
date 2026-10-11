/**
 * 人机（「普通」难度，补充文件第二节）：每回合把所有合法手（组 × 临时工调整 × 位置 × 行动参数）全枚举，
 * 用一个估值函数给「这一手之后的表」打分，挑最高的；能验证的目标卡都验证，不重洗。不搜索、不看牌堆。
 *
 * 估值 = 已经到手的分（目标卡、公园、泳池、完成小区、−bis、−拒批）
 *      + 没完成的小区的潜力 + 目标卡进度 + 临时工多数的预估
 *      − 数字放得不好（偏离理想位置、死格、挤）− 拒批风险。
 * 权重都在 BOT_WEIGHTS，方便调强度。输入只能是 redactGameForViewer(game, 自己) 的结果。
 */
import {
  ACTION_NAMES,
  BIS_TRACK,
  CARD_TABLE,
  ESTATE_TRACKS,
  MAX_ESTATE,
  PARK_TRACKS,
  POOL_TRACK,
  REFUSAL_TRACK,
  STREET_LENGTHS,
  TEMP_MAJORITY,
} from "./data.js";
import { actionVariants, claimablePlans, placements } from "./moves.js";
import { createRng } from "./rng.js";
import { applyMove, lockEstates, mustRefuse, pickEstates, segments } from "./sheet.js";
import type { GameState, Move, Plan, Sheet, Submission } from "./types.js";

export const BOT_WEIGHTS = {
  /** 没完成的小区：潜力 = 单价 × 填满比例² × 这个系数。 */
  estatePotential: 0.55,
  /** 7 座以上的一串（以后还能切）：每座已填的房子值这么多。 */
  longRunPerHouse: 0.25,
  /** 目标卡进度：分值 × 进度² × 这个系数（完成就是实打实的分）。 */
  planProgress: 0.6,
  /** 每偏离理想位置一格扣这么多（再乘 0.35）。 */
  deviation: 0.9,
  /** 每个死格（空位夹在两个号码之间，已经没有数字能填）扣这么多。 */
  deadSlot: 3,
  /** 空位挤：k 个空位只有 m 个数字可填时，每个「k − m×挤度」扣这么多。 */
  crowd: 1.2,
  crowdRatio: 0.55,
  /** 拒批风险：(1 − 覆盖率)³ × 这么多。 */
  refusalRisk: 30,
  /** 临时工多数：每分预估值的折扣（还没到终局，别人也会雇）。 */
  tempMajority: 0.5,
  /** 改造：每涨 1 分单价，按以后大概还会有几个这种尺寸的小区算。 */
  improveFuture: 0.6,
  /** 公园：离建满的大奖越近越值钱的额外系数。 */
  parkFuture: 0.25,
  /** bis：除了轨道上的罚分，每格再额外扣这么多（bis 越往后越贵，只在能救死格、凑小区时用）。 */
  bisExtra: 1.5,
};

export type BotWeights = typeof BOT_WEIGHTS;

/** 每个数字（0–17）出现的概率（81 张里的张数）。 */
const NUM_FREQ: number[] = (() => {
  const freq: number[] = new Array(18).fill(0);
  for (const row of Object.values(CARD_TABLE)) row.forEach((count, index) => (freq[index + 1]! += count));
  return freq.map((count) => count / 81);
})();
/** 数字 n 的累积位置（0–1）：8 在中间，1、15 在两头。 */
const NUM_RANK: number[] = (() => {
  const rank: number[] = new Array(18).fill(0);
  let cum = 0;
  for (let n = 0; n <= 17; n += 1) {
    rank[n] = Math.min(1, Math.max(0, cum + NUM_FREQ[n]! / 2));
    cum += NUM_FREQ[n]!;
  }
  rank[0] = 0;
  rank[16] = 1;
  rank[17] = 1;
  return rank;
})();

/** 数字 n 在长 L 的街上的理想下标（按牌的分布，8 落在中间）。 */
export function idealSlot(num: number, length: number): number {
  return NUM_RANK[Math.max(0, Math.min(17, num))]! * (length - 1);
}

interface EvalContext {
  readonly plans: readonly Plan[];
  /** 别人的临时工格数。 */
  readonly otherTemps: readonly number[];
  readonly weights: BotWeights;
}

function estateValue(sheet: Sheet, size: number): number {
  return ESTATE_TRACKS[size - 1]![sheet.improve[size - 1]!]!;
}

/** 一条街的排位：偏离理想位置、死格、挤。 */
function streetShape(sheet: Sheet, street: number, w: BotWeights): number {
  const row = sheet.houses[street]!;
  const length = row.length;
  let penalty = 0;
  let prevValue = 0; // 左边界：比 1 小
  let empties = 0;
  const flush = (nextValue: number) => {
    if (empties === 0) return;
    const available = Math.max(0, nextValue - prevValue - 1);
    if (available < empties) penalty += (empties - available) * w.deadSlot;
    const crowd = empties - available * w.crowdRatio;
    if (crowd > 0) penalty += crowd * w.crowd;
    empties = 0;
  };
  for (let i = 0; i < length; i += 1) {
    const house = row[i];
    if (!house) {
      empties += 1;
      continue;
    }
    flush(house.num);
    prevValue = house.num;
    if (!house.bis) penalty += Math.abs(i - idealSlot(house.num, length)) * w.deviation * 0.35;
  }
  flush(16);
  return -penalty;
}

/** 下回合随便翻一个数字，有地方填的概率（不算临时工）。 */
function coverage(sheet: Sheet): number {
  let covered = 0;
  for (let num = 1; num <= 15; num += 1) {
    let ok = false;
    for (let street = 0; street < 3 && !ok; street += 1) {
      const row = sheet.houses[street]!;
      let lower = 0;
      for (let i = 0; i < row.length; i += 1) {
        const house = row[i];
        if (house) {
          lower = house.num;
          continue;
        }
        if (lower >= num) continue;
        let upper = 99;
        for (let j = i + 1; j < row.length; j += 1) {
          const right = row[j];
          if (right) {
            upper = right.num;
            break;
          }
        }
        if (upper > num) {
          ok = true;
          break;
        }
      }
    }
    if (ok) covered += NUM_FREQ[num]!;
  }
  return covered;
}

type Segs = ReturnType<typeof segments>;

function filledIn(sheet: Sheet, segment: Segs[number]): number {
  let filled = 0;
  for (let k = segment.start; k < segment.start + segment.size; k += 1) if (sheet.houses[segment.street]![k]) filled += 1;
  return filled;
}

/** 目标卡进度（0–1）：每个要求的尺寸挑一段尺寸正好、填得最满的（完成的最好），没有就 0。 */
function planProgress(sheet: Sheet, need: readonly number[], segs: Segs): number {
  const free = segs.filter((segment) => segment.plan === null && segment.size <= MAX_ESTATE);
  const used = new Set<number>();
  let total = 0;
  for (const size of [...need].sort((a, b) => b - a)) {
    let best = -1;
    let bestFill = -1;
    free.forEach((segment, index) => {
      if (used.has(index) || segment.size !== size) return;
      const fill = filledIn(sheet, segment) / segment.size;
      if (fill > bestFill) {
        bestFill = fill;
        best = index;
      }
    });
    if (best >= 0) {
      used.add(best);
      total += bestFill;
    }
  }
  return total / need.length;
}

/** 给一张表估值（越大越好）。 */
export function evaluateSheet(sheet: Sheet, ctx: EvalContext): number {
  const w = ctx.weights;
  let value = 0;
  // 已经到手的
  value += sheet.plans.reduce<number>((sum, score) => sum + (score ?? 0), 0);
  value += sheet.parks.reduce((sum, count, street) => sum + PARK_TRACKS[street]![count]!, 0);
  value += POOL_TRACK[sheet.poolTrack]!;
  value -= BIS_TRACK[sheet.bis]! + sheet.bis * w.bisExtra;
  value -= REFUSAL_TRACK[sheet.refusals]!;
  // 公园离大奖越近越值钱
  sheet.parks.forEach((count, street) => {
    const track = PARK_TRACKS[street]!;
    if (count < track.length - 1) value += (count / (track.length - 1)) * (track[track.length - 1]! - track[count]!) * w.parkFuture;
  });
  // 小区
  const segs = segments(sheet);
  const sizeInPlay = [0, 0, 0, 0, 0, 0];
  for (const segment of segs) {
    const filled = filledIn(sheet, segment);
    if (segment.size <= MAX_ESTATE) {
      const unit = estateValue(sheet, segment.size);
      sizeInPlay[segment.size - 1]! += filled / segment.size;
      if (segment.complete) value += unit;
      else {
        const fill = filled / segment.size;
        value += unit * fill * fill * w.estatePotential;
      }
    } else {
      value += filled * w.longRunPerHouse;
    }
  }
  // 改造的远期价值：这个尺寸以后大概还会有多少个
  for (let size = 1; size <= 6; size += 1) {
    const gained = estateValue(sheet, size) - ESTATE_TRACKS[size - 1]![0]!;
    if (gained > 0) value += gained * (0.4 + (0.2 * Math.min(size, 4)) / 4) * w.improveFuture * (1 + sizeInPlay[size - 1]! * 0.2);
  }
  // 目标卡
  ctx.plans.forEach((plan, index) => {
    if (sheet.plans[index] !== null) return;
    const score = plan.approvedRound === null ? plan.high : plan.low;
    const progress = planProgress(sheet, plan.need, segs);
    value += score * progress * progress * w.planProgress;
  });
  // 临时工多数（和别人现在的格数比）
  if (sheet.temps > 0) {
    const distinct = [...new Set([...ctx.otherTemps, sheet.temps].filter((count) => count > 0))].sort((a, b) => b - a);
    const rank = distinct.indexOf(sheet.temps);
    value += (rank < TEMP_MAJORITY.length ? TEMP_MAJORITY[rank]! : 0) * w.tempMajority;
  }
  // 排位和拒批风险
  for (let street = 0; street < STREET_LENGTHS.length; street += 1) value += streetShape(sheet, street, w);
  const miss = 1 - coverage(sheet);
  const refusalWeight = sheet.refusals >= 2 ? 2 : 1;
  value -= miss * miss * miss * w.refusalRisk * refusalWeight;
  return value;
}

export interface BotDecision {
  readonly submission: Submission;
  /** 给玩家看的一句理由（教程「提示」用）。 */
  readonly reason: string;
  readonly value: number;
}

const STREET_NAMES = ["第 1 条街", "第 2 条街", "第 3 条街"];

function claimAll(sheet: Sheet, plans: readonly Plan[]): { sheet: Sheet; plans: number[] } {
  const indices = claimablePlans(sheet, plans);
  let current = sheet;
  for (const index of indices) {
    const plan = plans[index]!;
    const picked = pickEstates(current, plan.need);
    if (!picked) continue;
    current = lockEstates(current, picked, index);
    current.plans[index] = plan.approvedRound === null ? plan.high : plan.low;
  }
  return { sheet: current, plans: indices };
}

function describe(view: GameState, sheet: Sheet, move: Move, after: Sheet, claimed: number[]): string {
  const combo = view.combos[move.combo]!;
  const num = combo.num + (move.temp ?? 0);
  const where = `${STREET_NAMES[move.street]}第 ${move.house + 1} 格`;
  const length = STREET_LENGTHS[move.street]!;
  const ideal = idealSlot(num, length);
  const spot = Math.abs(ideal - move.house) <= 1.5
    ? num <= 5 ? "小号码放左边" : num >= 11 ? "大号码放右边" : "中间的号码放中间"
    : "这里最不挤";
  const parts: string[] = [`选「${combo.num} · ${ACTION_NAMES[combo.action]}」，把 ${num} 写在${where}（${spot}）`];
  if (move.temp !== undefined) {
    parts[0] = `选「${combo.num} · 临时工」，${move.temp === 0 ? "号码不变也雇一个临时工（比谁雇得多）" : `改成 ${num}`}，写在${where}（${spot}）`;
  }
  if (move.pool) parts.push(`这是泳池房，泳池建成（泳池轨涨到 ${POOL_TRACK[after.poolTrack]} 分）`);
  if (move.park) parts.push(`这条街多一个公园（公园 ${PARK_TRACKS[move.street]![after.parks[move.street]!]} 分）`);
  if (move.improve !== undefined) parts.push(`改造 ${move.improve} 房小区，单价涨到 ${estateValue(after, move.improve)}`);
  if (move.fence) {
    const fence = move.fence;
    const beforeCount = segments(sheet).filter((segment) => segment.complete).length;
    const now = segments(after).filter((segment) => segment.complete);
    const made = now.length > beforeCount
      ? now.find((segment) => segment.street === fence.street && (segment.start === fence.pos + 1 || segment.start + segment.size - 1 === fence.pos))
      : undefined;
    parts.push(made ? `画栅栏围出一个 ${made.size} 房小区` : `在${STREET_NAMES[fence.street]}画栅栏，把这段分成好凑小区的长度`);
  }
  if (move.bis) parts.push("bis 复制一个号码，填上一个不好填的空位（bis 会扣分）");
  if (claimed.length > 0) parts.push(`完成目标卡 ${claimed.map((index) => `n°${index + 1}`).join("、")}，马上验证拿分`);
  return `${parts.join("，")}。`;
}

function hashOf(text: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash >>> 0;
}

/**
 * 每个座位一点「性格」：权重各自上下浮动 15%（按座位 id 固定），再给每个候选加一点点随机（按回合变），
 * 免得一桌几个人机看到同样的 3 组就填出一模一样的表。
 */
function personalWeights(playerId: string, base: BotWeights): BotWeights {
  const rng = createRng(hashOf(playerId, 17));
  const result = { ...base };
  for (const key of Object.keys(result) as (keyof BotWeights)[]) {
    if (key === "crowdRatio") continue;
    result[key] = base[key] * (0.85 + 0.3 * rng.next());
  }
  return result;
}

/**
 * 人机这回合交什么、为什么。view 必须是 redactGameForViewer(game, playerId)。对局不在进行中时返回 null。
 */
export function botDecision(view: GameState, playerId: string, weights: Partial<BotWeights> = {}): BotDecision | null {
  if (view.phase !== "play") return null;
  const me = view.players.find((player) => player.id === playerId);
  if (!me) return null;
  const w: BotWeights = personalWeights(playerId, { ...BOT_WEIGHTS, ...weights });
  const noise = createRng(hashOf(playerId, view.round * 7919 + view.version));
  const ctx: EvalContext = {
    plans: view.plans,
    otherTemps: view.players.filter((player) => player.id !== playerId).map((player) => player.sheet.temps),
    weights: w,
  };
  const sheet = me.sheet;
  if (mustRefuse(sheet, view.combos)) {
    const refused: Sheet = { ...sheet, refusals: sheet.refusals + 1 };
    const claim = claimAll(refused, view.plans);
    const submission: Submission = claim.plans.length > 0 ? { move: null, plans: claim.plans } : { move: null };
    return { submission, reason: "三组号码都写不进去，只能拒批（拒批满 3 次游戏就结束）。", value: evaluateSheet(claim.sheet, ctx) };
  }
  let best: { move: Move; after: Sheet; claimed: number[]; value: number } | null = null;
  for (const { move } of placements(sheet, view.combos)) {
    const combo = view.combos[move.combo]!;
    const placed = applyMove(sheet, move, combo, view.round).sheet;
    const candidates: { move: Move; after: Sheet }[] = [{ move, after: placed }];
    for (const variant of actionVariants(placed, move, combo)) {
      candidates.push({ move: variant, after: applyMove(sheet, variant, combo, view.round).sheet });
    }
    for (const candidate of candidates) {
      const claim = claimAll(candidate.after, view.plans);
      const value = evaluateSheet(claim.sheet, ctx) + noise.next() * 0.3;
      if (!best || value > best.value + 1e-9) best = { move: candidate.move, after: candidate.after, claimed: claim.plans, value };
    }
  }
  if (!best) return null;
  const submission: Submission = best.claimed.length > 0 ? { move: best.move, plans: best.claimed } : { move: best.move };
  return { submission, reason: describe(view, sheet, best.move, best.after, best.claimed), value: best.value };
}

/** 服务器、超时代做、托管用：只要这一手。已经交了返回 null。 */
export function botCommand(view: GameState, playerId: string, weights: Partial<BotWeights> = {}): Submission | null {
  const me = view.players.find((player) => player.id === playerId);
  if (!me || me.submitted) return null;
  return botDecision(view, playerId, weights)?.submission ?? null;
}

/** 教程「提示」：就算已经交了也给一个建议和理由。 */
export function botHint(view: GameState, playerId: string): BotDecision | null {
  return botDecision(view, playerId);
}
