/**
 * 人机（占位）：从合法手里随机挑一个。人机阶段换成正式策略。
 * 输入只能是 redactGameForViewer(game, playerId) 的结果。
 */
import { randomSubmission } from "./baseline.js";
import { createRng } from "./rng.js";
import type { GameState, Submission } from "./types.js";

export function botCommand(view: GameState, playerId: string): Submission | null {
  if (view.phase !== "play") return null;
  const me = view.players.find((player) => player.id === playerId);
  if (!me || me.submitted) return null;
  let hash = view.version * 31 + view.round;
  for (const char of playerId) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return randomSubmission(view, playerId, createRng(hash));
}
