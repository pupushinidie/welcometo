import { COLUMN_HEIGHTS, type Column } from "./board.js";
import { advanceRunners, legalActions, moveOptions } from "./engine.js";
import type { GameCommand, GameState, Player, Runner } from "./types.js";

/**
 * 人机（「普通」难度）：只看桌上公开的东西（这个游戏本来也没有藏起来的信息）。
 *
 * 价值：本回合每个登山者比营地多爬的格数 ÷ 这条赛道的总长（2、12 号爬一格比 7 号值钱）；
 * 爬到顶（收手就能占领）另加 CLAIM_BONUS。
 * 再掷还是收手：一步前瞻。再掷一次，爆掉（概率 p）就丢掉本回合的价值 V，
 * 不爆平均能多拿 g（每种骰子都按最好的走法算）；(1 − p)·(V + g) > V 才再掷。
 * 选走法：每种走法算出走完之后「按上面的规则决定」的期望价值，挑最大的。
 */

const CLAIM_BONUS = 0.6;
/** 对手只差一条就赢、或者自己收手就赢时的调整。 */
const DESPERATE_GAIN = 1.6;

/** 4 颗骰子去掉顺序后的 126 种组合，以及每种出现的次数（总共 1296）。 */
const ROLLS: readonly { dice: number[]; weight: number }[] = (() => {
  const counts = new Map<string, { dice: number[]; weight: number }>();
  for (let roll = 0; roll < 1296; roll += 1) {
    const dice = [roll % 6, Math.floor(roll / 6) % 6, Math.floor(roll / 36) % 6, Math.floor(roll / 216)].map((face) => face + 1);
    const key = [...dice].sort().join("");
    const entry = counts.get(key);
    if (entry) entry.weight += 1;
    else counts.set(key, { dice, weight: 1 });
  }
  return [...counts.values()];
})();

type Board = Pick<GameState, "owners" | "config">;

function runnerValue(player: Pick<Player, "progress">, runner: Runner): number {
  const height = COLUMN_HEIGHTS[runner.column];
  const climbed = runner.height - (player.progress[runner.column] ?? 0);
  return climbed / height + (runner.height >= height ? CLAIM_BONUS : 0);
}

/** 本回合登山者的总价值（收手能保住的）。 */
function turnValue(player: Pick<Player, "progress">, runners: readonly Runner[]): number {
  return runners.reduce((total, runner) => total + runnerValue(player, runner), 0);
}

/** 收手能占领的赛道数。 */
function claimsOnStop(runners: readonly Runner[]): number {
  return runners.filter((runner) => runner.height >= COLUMN_HEIGHTS[runner.column]).length;
}

/** 再掷一次：爆掉的概率，以及不爆时按最好走法平均多拿的价值。 */
function rollOutlook(board: Board, player: Pick<Player, "progress">, runners: readonly Runner[]): { bust: number; gain: number } {
  const base = turnValue(player, runners);
  let bust = 0;
  let gain = 0;
  for (const { dice, weight } of ROLLS) {
    const options = moveOptions(board, player, runners, dice);
    if (options.length === 0) {
      bust += weight;
      continue;
    }
    let best = 0;
    for (const option of options) {
      const next = advanceRunners(board, player, runners, option.sums)!;
      best = Math.max(best, turnValue(player, next) - base);
    }
    gain += best * weight;
  }
  const success = 1296 - bust;
  return { bust: bust / 1296, gain: success > 0 ? gain / success : 0 };
}

interface Plan {
  readonly roll: boolean;
  /** 照这个决定走下去的期望价值。 */
  readonly value: number;
}

/** 推进完以后：再掷还是收手。 */
function decide(state: GameState, player: Player, runners: readonly Runner[]): Plan {
  const value = turnValue(player, runners);
  const claims = claimsOnStop(runners);
  // 收手就赢：不冒险。
  if (claims > 0 && player.score + claims >= state.config.columnsToWin) return { roll: false, value: value + 10 };
  const { bust, gain } = rollOutlook(state, player, runners);
  // 对手只差一条就赢时，这回合要多拼一点。
  const threatened = state.players.some((other) => other.id !== player.id && other.score >= state.config.columnsToWin - 1);
  const continueValue = (1 - bust) * (value + gain * (threatened ? DESPERATE_GAIN : 1));
  return continueValue > value ? { roll: true, value: continueValue } : { roll: false, value };
}

/** 选走法：挑走完以后期望价值最大的。 */
function chooseSums(state: GameState, player: Player): Column[] {
  let best: { sums: Column[]; value: number } | null = null;
  for (const option of state.options) {
    const next = advanceRunners(state, player, state.runners, option.sums)!;
    const { value } = decide(state, player, next);
    if (!best || value > best.value) best = { sums: option.sums, value };
  }
  return [...best!.sums];
}

/** 轮到 playerId 时人机的下一步；没轮到它返回 null。 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  if (legalActions(state, playerId).length === 0) return null;
  const player = state.players[state.currentPlayer]!;
  switch (state.stage) {
    case "roll":
      return { type: "ROLL" };
    case "choose":
      return { type: "CHOOSE", sums: chooseSums(state, player) };
    case "decide":
      return decide(state, player, state.runners).roll ? { type: "ROLL" } : { type: "STOP" };
  }
}
