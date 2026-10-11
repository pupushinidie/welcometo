/**
 * 欢迎来到：数值表。全部按补充文件第一节（勘误），原规则书第 2、5、10 节的数值作废。
 */
import type { Action, Card } from "./types.js";

export const ACTIONS: readonly Action[] = ["fence", "improve", "park", "pool", "temp", "bis"];

/** 界面上的中文名。 */
export const ACTION_NAMES: Record<Action, string> = {
  fence: "栅栏",
  improve: "改造",
  park: "公园",
  pool: "泳池",
  temp: "临时工",
  bis: "bis",
};

/** 三条街的门牌位数（补充 1.1）：共 33。 */
export const STREET_LENGTHS: readonly number[] = [10, 11, 12];
export const TOTAL_HOUSES = 33;

/** 带泳池的门牌位（0 起；补充 1.1 是从 1 数的 3,7,8 / 1,4,8 / 2,7,11）。共 9 个。 */
export const POOL_SLOTS: readonly (readonly number[])[] = [
  [2, 6, 7],
  [0, 3, 7],
  [1, 6, 10],
];

/** 公园轨（含开头 0），最后一格是建满的奖励。 */
export const PARK_TRACKS: readonly (readonly number[])[] = [
  [0, 2, 4, 10],
  [0, 2, 4, 6, 14],
  [0, 2, 4, 6, 8, 18],
];

/** 泳池轨（含开头 0），9 格可勾。 */
export const POOL_TRACK: readonly number[] = [0, 3, 6, 9, 13, 17, 21, 26, 31, 36];

/** 临时工格数。 */
export const TEMP_MAX = 11;
/** 临时工多数比拼：第 1/2/3 名（按不同的格数排，并列同档）。 */
export const TEMP_MAJORITY: readonly number[] = [7, 4, 1];

/** bis 罚分轨（含开头 0），9 格可勾。 */
export const BIS_TRACK: readonly number[] = [0, 1, 3, 6, 9, 12, 16, 20, 24, 28];

/** 拒批罚分轨（含开头 0），3 格可勾，勾满第 3 格触发终局。 */
export const REFUSAL_TRACK: readonly number[] = [0, 0, 3, 5];
export const MAX_REFUSALS = 3;

/** 小区尺寸列（改造）：下标 0 = 尺寸 1。第一格是基础价，往下勾一格涨一档。 */
export const ESTATE_TRACKS: readonly (readonly number[])[] = [
  [1, 3],
  [2, 3, 4],
  [3, 4, 5, 6],
  [4, 5, 6, 7, 8],
  [5, 6, 7, 8, 9, 10],
  [6, 7, 8, 9, 10, 11, 12],
];

/** 门牌号能写的范围（临时工可以把 1 改到 0、15 改到 17）。 */
export const MIN_NUMBER = 0;
export const MAX_NUMBER = 17;
/** 小区最多 6 座；7 座及以上的一串不计分。 */
export const MAX_ESTATE = 6;

/**
 * 81 张原版建造牌：每个数字背面的行动张数（补充 1.3，BGA Tips 页明细）。
 * 行 = 行动（栅栏、改造、公园、泳池、临时工、bis），列 = 数字 1–15。
 */
export const CARD_TABLE: Record<Action, readonly number[]> = {
  //       1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
  fence: [1, 1, 1, 0, 2, 2, 1, 2, 1, 2, 2, 0, 1, 1, 1],
  improve: [1, 1, 0, 1, 2, 1, 2, 2, 2, 1, 2, 1, 0, 1, 1],
  park: [1, 1, 0, 1, 2, 1, 2, 2, 2, 1, 2, 1, 0, 1, 1],
  pool: [0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0],
  temp: [0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0],
  bis: [0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0],
};

/** 81 张牌（按数字、行动排好，id 0–80）。 */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (let num = 1; num <= 15; num += 1) {
    for (const action of ACTIONS) {
      const count = CARD_TABLE[action][num - 1]!;
      for (let k = 0; k < count; k += 1) cards.push({ id: cards.length, num, action });
    }
  }
  return cards;
}

export const DECK_SIZE = 81;
export const STACK_COUNT = 3;

/** 18 张基础目标卡（补充 1.4）：need 从小到大，high / low = 项目面 / 获批面。 */
export interface PlanDef {
  readonly id: string;
  readonly tier: number;
  readonly need: readonly number[];
  readonly high: number;
  readonly low: number;
}

export const PLAN_DEFS: readonly PlanDef[] = [
  { id: "1-1", tier: 0, need: [1, 1, 1, 1, 1, 1], high: 8, low: 4 },
  { id: "1-2", tier: 0, need: [2, 2, 2, 2], high: 8, low: 4 },
  { id: "1-3", tier: 0, need: [3, 3, 3], high: 8, low: 4 },
  { id: "1-4", tier: 0, need: [4, 4], high: 6, low: 3 },
  { id: "1-5", tier: 0, need: [5, 5], high: 8, low: 4 },
  { id: "1-6", tier: 0, need: [6, 6], high: 10, low: 6 },
  { id: "2-1", tier: 1, need: [3, 6], high: 8, low: 4 },
  { id: "2-2", tier: 1, need: [3, 3, 4], high: 12, low: 7 },
  { id: "2-3", tier: 1, need: [4, 5], high: 9, low: 5 },
  { id: "2-4", tier: 1, need: [1, 1, 1, 4], high: 9, low: 5 },
  { id: "2-5", tier: 1, need: [2, 2, 5], high: 10, low: 6 },
  { id: "2-6", tier: 1, need: [1, 1, 1, 6], high: 11, low: 6 },
  { id: "3-1", tier: 2, need: [3, 4], high: 7, low: 3 },
  { id: "3-2", tier: 2, need: [2, 5], high: 7, low: 3 },
  { id: "3-3", tier: 2, need: [1, 4, 5], high: 13, low: 7 },
  { id: "3-4", tier: 2, need: [2, 3, 5], high: 13, low: 7 },
  { id: "3-5", tier: 2, need: [1, 2, 6], high: 12, low: 7 },
  { id: "3-6", tier: 2, need: [1, 2, 2, 3], high: 11, low: 6 },
];

export function planDef(id: string): PlanDef {
  const def = PLAN_DEFS.find((plan) => plan.id === id);
  if (!def) throw new Error(`没有这张目标卡：${id}`);
  return def;
}
