/**
 * 两个基线策略（测强度、随机对局、预览局面用）：
 * - randomSubmission：随机合法手（随机放法，一半概率随机用行动），能验证的目标卡都验证；
 * - greedySubmission：贪心基线（补充 2.5）——只看「理想位置」（数字越大越往右），行动能用就用（取第一个合法参数）。
 */
import { STREET_LENGTHS } from "./data.js";
import { actionVariants, claimablePlans, placements } from "./moves.js";
import type { Rng } from "./rng.js";
import { applyMove, mustRefuse, sheetAfter } from "./sheet.js";
import type { GameState, Move, Submission } from "./types.js";

function sheetOf(state: GameState, playerId: string) {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("你不在这局里。");
  return player.sheet;
}

/** 填完这一手后能验证的目标卡都带上。 */
function withPlans(state: GameState, playerId: string, move: Move | null): Submission {
  const after = sheetAfter(sheetOf(state, playerId), move, state.combos, state.round);
  const plans = claimablePlans(after, state.plans);
  return plans.length > 0 ? { move, plans } : { move };
}

export function randomSubmission(state: GameState, playerId: string, rng: Rng): Submission {
  const sheet = sheetOf(state, playerId);
  if (mustRefuse(sheet, state.combos)) return withPlans(state, playerId, null);
  const options = placements(sheet, state.combos);
  const base = rng.pick(options).move;
  const combo = state.combos[base.combo]!;
  let move = base;
  if (rng.next() < 0.5) {
    const after = applyMove(sheet, base, combo, state.round).sheet;
    const variants = actionVariants(after, base, combo);
    if (variants.length > 0) move = rng.pick(variants);
  }
  return withPlans(state, playerId, move);
}

/** 数字 n 在长 L 的街上的理想下标（补充 2.2）。 */
export function idealIndex(num: number, length: number): number {
  return Math.round((num / 17) * (length - 1));
}

export function greedySubmission(state: GameState, playerId: string): Submission {
  const sheet = sheetOf(state, playerId);
  if (mustRefuse(sheet, state.combos)) return withPlans(state, playerId, null);
  let best: Move | null = null;
  let bestScore = -Infinity;
  for (const { move, num } of placements(sheet, state.combos)) {
    if (move.temp !== undefined && move.temp === 0) continue;
    const score = -Math.abs(idealIndex(num, STREET_LENGTHS[move.street]!) - move.house) - (move.temp !== undefined ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  const base = best!;
  const combo = state.combos[base.combo]!;
  const after = applyMove(sheet, base, combo, state.round).sheet;
  const variants = actionVariants(after, base, combo);
  return withPlans(state, playerId, variants[0] ?? base);
}
