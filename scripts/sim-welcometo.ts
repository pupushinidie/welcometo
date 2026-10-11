/**
 * 人机强度模拟：npx tsx scripts/sim-welcometo.ts [局数=300] [人数列表=2,3,4,6] [对手=random,greedy,self]
 * - random / greedy：1 个人机 vs (人数−1) 个基线，人机轮流坐各个座位；报人机胜率（并列平分）、公平值、平均分、平均名次。
 * - self：全是人机的自对弈，报平均分、终局原因、回合数，并断言每一步合法、不超过最大步数。
 * 所有策略都只拿 redactGameForViewer 之后的视角。报决策耗时（平均 / 最坏 / 超过 50ms 的比例）。
 */
import {
  apply,
  botCommand,
  checkSubmission,
  createGame,
  createRng,
  greedySubmission,
  randomSubmission,
  redactGameForViewer,
  waitingFor,
  type GameState,
  type Submission,
} from "../packages/game/src/index.js";

type Policy = (view: GameState, id: string) => Submission;

const timing = { count: 0, total: 0, max: 0, over50: 0 };
const rng = createRng(4242);
const bot: Policy = (view, id) => {
  const t0 = performance.now();
  const submission = botCommand(view, id)!;
  const ms = performance.now() - t0;
  timing.count += 1;
  timing.total += ms;
  timing.max = Math.max(timing.max, ms);
  if (ms > 50) timing.over50 += 1;
  return submission;
};
const random: Policy = (view, id) => randomSubmission(view, id, rng);
const greedy: Policy = (view, id) => greedySubmission(view, id);

const MAX_STEPS = 2000;
function play(policies: Policy[], seed: number) {
  const players = policies.map((_, index) => ({ id: `p${index}`, name: `p${index}` }));
  let state = createGame(players, seed);
  const gameRng = createRng(seed * 31 + 7);
  let steps = 0;
  while (state.phase === "play") {
    if (++steps > MAX_STEPS) throw new Error(`超过 ${MAX_STEPS} 步，可能死循环`);
    const id = waitingFor(state)[0]!;
    const index = Number(id.slice(1));
    const view = redactGameForViewer(state, id);
    const submission = policies[index]!(view, id);
    const problem = checkSubmission(state, id, submission);
    if (problem) throw new Error(`不合法的一手（座位 ${index}）：${problem} ${JSON.stringify(submission)}`);
    state = apply(state, id, { type: "submit", submission }, gameRng).state;
  }
  return state;
}

const games = Number(process.argv[2] ?? 300);
const counts = (process.argv[3] ?? "2,3,4,6").split(",").map(Number);
const modes = (process.argv[4] ?? "random,greedy,self").split(",");

for (const mode of modes) {
  for (const n of counts) {
    let wins = 0;
    let botScore = 0;
    let oppScore = 0;
    let rankSum = 0;
    let rounds = 0;
    const reasons: Record<string, number> = {};
    const t0 = performance.now();
    for (let g = 0; g < games; g += 1) {
      const seat = g % n;
      const opp = mode === "random" ? random : mode === "greedy" ? greedy : bot;
      const policies = Array.from({ length: n }, (_, index) => (index === seat ? bot : opp));
      const end = play(policies, 1000 * n + g);
      const result = end.finalResult!;
      const id = `p${seat}`;
      if (result.winners.includes(id)) wins += 1 / result.winners.length;
      botScore += result.scores[id]!.total;
      const others = end.players.filter((player) => player.id !== id);
      oppScore += others.reduce((sum, player) => sum + result.scores[player.id]!.total, 0) / others.length;
      rankSum += result.ranks[id]!;
      rounds += result.rounds;
      for (const reason of result.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    const label = mode === "self" ? `自对弈 ${n} 人` : `人机 vs ${n - 1} 个${mode === "random" ? "随机" : "贪心"}`;
    console.log(
      `${label}：${games} 局，人机胜率 ${((wins / games) * 100).toFixed(1)}%（公平值 ${(100 / n).toFixed(1)}%），` +
        `人机平均 ${(botScore / games).toFixed(1)} 分 / 对手平均 ${(oppScore / games).toFixed(1)} 分，平均名次 ${(rankSum / games).toFixed(2)}，` +
        `平均 ${(rounds / games).toFixed(1)} 回合，终局原因 ${JSON.stringify(reasons)}，用时 ${((performance.now() - t0) / 1000).toFixed(1)}s`,
    );
  }
}
console.log(`决策耗时：${timing.count} 次，平均 ${(timing.total / timing.count).toFixed(2)}ms，最坏 ${timing.max.toFixed(1)}ms，超过 50ms ${(timing.over50 / timing.count * 100).toFixed(2)}%`);
