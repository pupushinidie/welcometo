/**
 * 枚举合法的一手（人机、基线、随机对局测试用）。
 */

import {
  applyMove,

  canImprove,
  canPark,
  canUseBis,
  comboNumbers,
  isPoolSlot,
  legalBis,
  legalFences,
  legalHouses,
  lockEstates,
  pickEstates,
} from "./sheet.js";
import type { Combo, Move, Plan, Sheet } from "./types.js";

/** 只填数字（不含行动参数）的所有合法放法：组、临时工调整、位置。 */
export function placements(sheet: Sheet, combos: readonly Combo[]): { move: Move; num: number }[] {
  const result: { move: Move; num: number }[] = [];
  combos.forEach((combo, index) => {
    for (const option of comboNumbers(sheet, combo)) {
      for (const spot of legalHouses(sheet, option.num)) {
        const move: Move = option.temp === undefined
          ? { combo: index, street: spot.street, house: spot.house }
          : { combo: index, street: spot.street, house: spot.house, temp: option.temp };
        result.push({ move, num: option.num });
      }
    }
    // 临时工 ±0（要勾一格，但数字不变）
    if (combo.action === "temp" && comboNumbers(sheet, combo).length > 1) {
      for (const spot of legalHouses(sheet, combo.num)) {
        result.push({ move: { combo: index, street: spot.street, house: spot.house, temp: 0 }, num: combo.num });
      }
    }
  });
  return result;
}

/** 填完数字后（sheet 是填完的表）这组行动能怎么用：每一种参数各一个 Move；不含「不用行动」。 */
export function actionVariants(after: Sheet, base: Move, combo: Combo): Move[] {
  const variants: Move[] = [];
  switch (combo.action) {
    case "fence":
      for (const fence of legalFences(after)) variants.push({ ...base, fence });
      break;
    case "improve":
      for (let size = 1; size <= 6; size += 1) if (canImprove(after, size)) variants.push({ ...base, improve: size });
      break;
    case "park":
      if (canPark(after, base.street)) variants.push({ ...base, park: true });
      break;
    case "pool":
      if (isPoolSlot(base.street, base.house)) variants.push({ ...base, pool: true });
      break;
    case "bis":
      if (canUseBis(after)) for (const bis of legalBis(after)) variants.push({ ...base, bis });
      break;
    case "temp":
      break;
  }
  return variants;
}

/** 所有合法的一手（含不用行动的）。拒批时为空。 */
export function legalMoves(sheet: Sheet, combos: readonly Combo[], round = 0): Move[] {
  const moves: Move[] = [];
  for (const { move } of placements(sheet, combos)) {
    const combo = combos[move.combo]!;
    moves.push(move);
    const after = applyMove(sheet, { combo: move.combo, street: move.street, house: move.house, ...(move.temp !== undefined ? { temp: move.temp } : {}) }, combo, round).sheet;
    moves.push(...actionVariants(after, move, combo));
  }
  return moves;
}

/** 这张表现在能一起验证的目标卡（按 n°1、n°2、n°3 依次挑小区，挑得出来的都算）。 */
export function claimablePlans(sheet: Sheet, plans: readonly Plan[]): number[] {
  const result: number[] = [];
  let current = sheet;
  plans.forEach((plan, index) => {
    if (current.plans[index] !== null) return;
    const picked = pickEstates(current, plan.need);
    if (!picked) return;
    current = lockEstates(current, picked, index);
    result.push(index);
  });
  return result;
}

