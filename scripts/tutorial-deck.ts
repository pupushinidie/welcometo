/**
 * 给教程剧本找牌序：每回合想要的 3 组「号码·行动」，摆进 3 堆（可以换堆），
 * 每堆第 r 张的行动 = 第 r 回合这组的行动、第 r 张的号码 = 第 r 回合这组的号码（翻牌机制：数字来自下一张）。
 * 用法：npx tsx scripts/tutorial-deck.ts   打印每堆前几张牌的 id，抄进 packages/game/src/tutorial.ts。
 */
import { buildDeck, type Action, type Card } from "../packages/game/src/index.js";

type C = [number, Action];
const ROUNDS: C[][] = JSON.parse(process.argv[2] ?? "[]");
const deck = buildDeck();

function perms<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => perms([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

// 每堆的组序列：stackCombos[s][r]
function solve(r: number, assign: C[][]): C[][] | null {
  if (r === ROUNDS.length) return assign;
  for (const p of perms(ROUNDS[r]!)) {
    const next = assign.map((list, s) => [...list, p[s]!]);
    if (feasible(next)) {
      const done = solve(r + 1, next);
      if (done) return done;
    }
  }
  return null;
}

function cardsFor(assign: C[][]): Card[][] | null {
  const used = new Set<number>();
  const take = (test: (card: Card) => boolean) => {
    const card = deck.find((c) => !used.has(c.id) && test(c));
    if (card) used.add(card.id);
    return card;
  };
  const stacks: Card[][] = [];
  for (const list of assign) {
    const cards: Card[] = [];
    // c0：行动 = 第 1 回合的行动；c_r（r ≥ 1）：号码 = 第 r 回合的号码，行动 = 第 r+1 回合的行动（最后一张行动随意）
    const first = take((c) => c.action === list[0]![1]);
    if (!first) return null;
    cards.push(first);
    for (let r = 0; r < list.length; r += 1) {
      const num = list[r]![0];
      const nextAction = list[r + 1]?.[1];
      const card = take((c) => c.num === num && (nextAction === undefined || c.action === nextAction));
      if (!card) return null;
      cards.push(card);
    }
    stacks.push(cards);
  }
  return stacks;
}

function feasible(assign: C[][]): boolean {
  return cardsFor(assign) !== null;
}

const assign = solve(0, [[], [], []]);
if (!assign) {
  console.log("找不到");
  process.exit(1);
}
const stacks = cardsFor(assign)!;
console.log(JSON.stringify(assign));
console.log(JSON.stringify(stacks.map((s) => s.map((c) => c.id))));
console.log(stacks.map((s) => s.map((c) => `${c.num}${c.action}`).join(" ")).join("\n"));
