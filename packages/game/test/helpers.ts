import { apply, buildGame, createRng, type ExactSpec, type GameState, type SheetSpec, type Submission } from "../src/index.js";

/** 所有人依次交（按 submissions 的顺序），返回最后的状态。 */
export function submitAll(state: GameState, submissions: Record<string, Submission>, seed = 99): GameState {
  const r = createRng(seed);
  let current = state;
  for (const [id, submission] of Object.entries(submissions)) {
    current = apply(current, id, { type: "submit", submission }, r).state;
  }
  return current;
}

export function submit(state: GameState, id: string, submission: Submission, seed = 99): GameState {
  return apply(state, id, { type: "submit", submission }, createRng(seed)).state;
}

/** 一人局：自己的表 + 其余参数。 */
export function solo(sheet: SheetSpec | undefined, rest: Omit<ExactSpec, "players"> = {}): GameState {
  return buildGame({ ...rest, players: [sheet ? { sheet } : {}] });
}

export const EMPTY: readonly [string, string, string] = [
  "_ _ _ _ _ _ _ _ _ _",
  "_ _ _ _ _ _ _ _ _ _ _",
  "_ _ _ _ _ _ _ _ _ _ _ _",
];
