/**
 * 随机对局：每步随机挑一个合法动作（随机交 / 贪心交 / 撤回重交 / 偶尔整回合超时），
 * 每步用普通代码查不变量（牌守恒、表合法、回合推进、房子只增不减），最后汇总再 expect。
 */
import {
  apply,
  createGame,
  createRng,
  fallbackSubmission,
  filledCount,
  greedySubmission,
  randomSubmission,
  scoreAll,
  stateProblems,
  timeoutTurn,
  waitingFor,
  type GameState,
} from "../src/index.js";

export interface RandomStats {
  games: number;
  problems: string[];
  maxRounds: number;
  rounds: number[];
  reasons: Record<string, number>;
}

export function runRandomGames(players: number, games: number, seedBase: number): RandomStats {
  const stats: RandomStats = { games: 0, problems: [], maxRounds: 0, rounds: [], reasons: {} };
  for (let g = 0; g < games; g += 1) {
    const seed = seedBase + g;
    const rng = createRng(seed * 7 + 3);
    let state: GameState = createGame(
      Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
      seed,
    );
    const fail = (text: string) => {
      if (stats.problems.length < 20) stats.problems.push(`${players}人 种子${seed} 第${state.round}回合：${text}`);
    };
    let steps = 0;
    while (state.phase === "play") {
      steps += 1;
      if (steps > 2000) {
        fail("步数超过 2000，疑似死循环");
        break;
      }
      const before = state;
      const filledBefore = before.players.map((player) => filledCount(player.sheet) + player.sheet.refusals);
      const roll = rng.next();
      if (roll < 0.03) {
        state = timeoutTurn(state, (view, id) => greedySubmission(view, id));
      } else {
        const waiting = waitingFor(state);
        const submitted = state.players.filter((player) => player.submitted).map((player) => player.id);
        if (waiting.length === 0) {
          fail("对局中没人要交，卡住");
          break;
        }
        if (roll < 0.08 && submitted.length > 0) {
          state = apply(state, rng.pick(submitted), { type: "retract" }, rng).state;
        } else {
          const id = rng.pick(waiting);
          const pick = rng.next();
          const submission = pick < 0.5 ? randomSubmission(state, id, rng) : pick < 0.9 ? greedySubmission(state, id) : fallbackSubmission(state, id);
          try {
            state = apply(state, id, { type: "submit", submission }, rng).state;
          } catch (error) {
            fail(`合法手被拒：${(error as Error).message} ${JSON.stringify(submission)}`);
            break;
          }
        }
      }
      for (const problem of stateProblems(state)) fail(problem);
      if (state.round !== before.round || state.phase === "gameOver") {
        if (state.phase === "play" && state.round !== before.round + 1) fail("回合没有加 1");
        state.players.forEach((player, index) => {
          const now = filledCount(player.sheet) + player.sheet.refusals;
          const delta = now - filledBefore[index]!;
          if (delta < 1 || delta > 2) fail(`${player.name} 这回合房子+拒批变化 ${delta}`);
        });
      }
    }
    if (state.phase === "gameOver") {
      const result = state.finalResult!;
      const scores = scoreAll(state);
      for (const player of state.players) {
        if (scores[player.id]!.total !== result.scores[player.id]!.total) fail("终局分数和重算的不一致");
      }
      if (result.winners.length === 0) fail("没有胜者");
      for (const reason of result.reasons) stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
    } else {
      fail("没有打到终局");
    }
    stats.rounds.push(state.round);
    stats.maxRounds = Math.max(stats.maxRounds, state.round);
    stats.games += 1;
  }
  return stats;
}
