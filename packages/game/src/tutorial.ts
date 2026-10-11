/**
 * 新手教程的剧本（欢迎来到）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器。开局用预览局面工厂摆好（你的表先写了几个号码，省得从零开始），
 * 3 堆牌的前 7 张按剧本排好（scripts/tutorial-deck.ts 算的），所以前 6 回合翻出哪 3 组是定的；
 * 两个咕噜每回合交什么也是剧本定的，所以「你围出小区」「你和咕噜一号同回合首批完成 n°3」这几幕一定发生。
 * 剧本走完接着把这局打完（练习局）：两个咕噜交给人机，之后翻的牌是普通随机。
 *
 * 一个 do 步骤 = 交一整手（选组 → 可能改号码 → 点空地 → 可能用行动 → 确认提交）。界面按这一手自动把高亮挪到下一个要点的地方，
 * 别的地方点了没反应（stageOf / nextAnchor）。改了规则或界面，test/tutorial.test.ts 会检查剧本还能不能从头走到尾。
 */
import { buildDeck } from "./data.js";
import { createGame } from "./engine.js";
import { buildGame } from "./scenes.js";
import type { Card, GameCommand, GameState, Move, Submission } from "./types.js";

export type TutorialFace = "base" | "happy" | "surprised" | "think";

/** 剧本里的一步：谁、交什么（同时提交的游戏要写明是谁）。 */
export interface TutorialMove {
  readonly player: string;
  readonly command: GameCommand;
}

/** do 步骤里每个小阶段换一句补充说明（不给就用 note）。 */
export interface StageNotes {
  readonly combo?: string;
  readonly temp?: string;
  readonly house?: string;
  readonly action?: string;
  readonly submit?: string;
}

interface StepBase {
  readonly id: string;
  /** 侧栏进度里这一课叫什么；同一课的后几步不写。 */
  readonly lesson?: string;
  /** 主句（24px），一句话。 */
  readonly say: string;
  /** 补充（12px），最多两句。 */
  readonly note?: string;
  readonly noteTouch?: string;
  /** 高亮哪个元素（data-tutorial 的值）；数组 = 按顺序用页面上看得见的第一个。do 步骤不用写，按这一手自动算。 */
  readonly anchor?: string | readonly string[];
  readonly face?: TutorialFace;
}

export type TutorialStep =
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  | (StepBase & { readonly kind: "do"; readonly expect: TutorialMove; readonly stages?: StageNotes })
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly TutorialMove[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_BOTS = [
  { id: "p2", name: "咕噜一号" },
  { id: "p3", name: "咕噜二号" },
] as const;
const ONE = "p2";
const TWO = "p3";

/** 3 张目标卡：n°3 是剧本里要完成的（1 个 3 房 + 1 个 4 房，7 / 3 分）。 */
export const TUTORIAL_PLANS = ["1-1", "2-3", "3-1"] as const;

/**
 * 3 堆的前 7 张（牌的 id，见 data.buildDeck）：前 6 回合翻出
 *   1：5·公园 / 10·栅栏 / 13·改造    2：4·公园 / 6·泳池 / 12·栅栏    3：8·公园 / 9·栅栏 / 3·改造
 *   4：6·临时工 / 11·公园 / 14·栅栏  5：10·改造 / 4·栅栏 / 12·公园   6：7·栅栏 / 11·bis / 2·公园
 * 其余牌按固定顺序接在后面（练习局再用普通随机洗：见 TutorialMode）。
 */
export const TUTORIAL_STACK_HEADS: readonly (readonly number[])[] = [
  [2, 19, 11, 43, 23, 53, 28],
  [0, 57, 21, 48, 60, 14, 61],
  [1, 71, 66, 6, 77, 67, 3],
];

/** 开局时三个人的表（你的先写了几个号码；咕噜一号的第 1 条街已经快围好两个小区）。 */
export const TUTORIAL_SHEETS = {
  [TUTORIAL_SELF]: { streets: ["1 2 _ 7 _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "3 4 _ | _ _ _ _ _ _ _ _ _"] as [string, string, string] },
  [ONE]: { streets: ["1 2 3 | 5 6 7 _ | _ _ _", "_ _ _ _ _ _ _ _ _ _ _", "_ _ _ _ _ _ _ _ _ _ _ _"] as [string, string, string] },
  [TWO]: {},
} as const;

const sub = (move: Move | null, extra: Omit<Submission, "move"> = {}): GameCommand => ({ type: "submit", submission: { move, ...extra } });
const me = (move: Move | null, extra: Omit<Submission, "move"> = {}): TutorialMove => ({ player: TUTORIAL_SELF, command: sub(move, extra) });
const one = (move: Move, extra: Omit<Submission, "move"> = {}): TutorialMove => ({ player: ONE, command: sub(move, extra) });
const two = (move: Move): TutorialMove => ({ player: TWO, command: sub(move) });

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // ---------- 开场 ----------
  {
    kind: "info", id: "welcome", lesson: "目标", face: "happy",
    say: "我是咕噜嘎，带你在表上盖几回合房子。",
    note: "三条街一共 33 块空地，写上门牌号就盖起一座房子。最后总分最高的人赢。",
  },
  {
    kind: "info", id: "sheet", anchor: "sheet",
    say: "这是你的表：三条街，分别有 10、11、12 块地。",
    note: "为了快点上手，我先帮你写了几个号码。",
  },
  {
    kind: "info", id: "combos", lesson: "选一组填号码", anchor: "combos",
    say: "每回合翻出 3 组「号码 + 行动」，大家同时各选一组。",
    note: "号码和行动是一对，不能拆开；可以和别人选同一组。",
  },
  {
    kind: "do", id: "r1", expect: me({ combo: 0, street: 2, house: 2, park: true }),
    say: "选「5 · 公园」，把 5 写在第 3 条街 4 的右边。",
    stages: {
      combo: "先点上面的「5 · 公园」这一组。",
      house: "同一条街从左到右要越来越大：亮着的地方能填，暗着的填不了。点 4 右边那块。",
      submit: "公园会勾在写号码的那条街（右边的小树苗）。点「确认提交」。",
    },
  },
  {
    kind: "watch", id: "w1", anchor: "players", moves: [one({ combo: 1, street: 1, house: 6 }), two({ combo: 2, street: 0, house: 8, improve: 4 })],
    say: "咕噜一号和咕噜二号也在选……",
    note: "大家都交了，才一起写到表上。",
  },
  {
    kind: "info", id: "estate", lesson: "小区", anchor: "street-3", face: "happy",
    say: "你的第 3 条街围出了一个 3 房小区！",
    note: "两道栅栏之间全部填满的 1–6 座房子就是一个小区（街两头本来就有栅栏）。7 座以上不算小区。",
  },

  // ---------- 泳池 ----------
  {
    kind: "do", id: "r2", lesson: "泳池", expect: me({ combo: 1, street: 0, house: 2, pool: true }),
    say: "选「6 · 泳池」，把 6 写进第 1 条街带泳池的空地。",
    stages: {
      combo: "点「6 · 泳池」这一组。",
      house: "第 1 条街 2 和 7 之间那块地画着泳池，点它。",
      submit: "泳池要两样都满足：泳池行动 + 写进画着泳池的地。点「确认提交」。",
    },
  },
  {
    kind: "watch", id: "w2", anchor: "players", moves: [one({ combo: 0, street: 2, house: 1, park: true }), two({ combo: 2, street: 1, house: 9 })],
    say: "等两个咕噜选完……",
  },

  // ---------- 栅栏和目标卡 ----------
  {
    kind: "info", id: "plans", lesson: "栅栏和目标卡", anchor: "plans",
    say: "上面 3 张是目标卡，要求特定尺寸的小区。",
    note: "n°3 要 1 个 3 房小区 + 1 个 4 房小区。3 房的你已经有了。",
  },
  {
    kind: "do", id: "r3", expect: me({ combo: 1, street: 1, house: 5, fence: { street: 0, pos: 3 } }, { plans: [2] }),
    say: "选「9 · 栅栏」，9 随便写，再在第 1 条街 7 的右边画栅栏。",
    stages: {
      combo: "点「9 · 栅栏」这一组。",
      house: "9 写在第 2 条街中间这块就好。",
      action: "栅栏能画在任意一条街。点第 1 条街 7 右边的虚线，1 2 6 7 就围成一个 4 房小区。",
      submit: "n°3 完成了，下面已经替你勾上「验证」。点「确认提交」。",
    },
  },
  {
    kind: "watch", id: "w3", anchor: "players", moves: [one({ combo: 0, street: 0, house: 6, park: true }, { plans: [2] }), two({ combo: 2, street: 2, house: 1 })],
    say: "咕噜一号好像也快完成了……",
  },
  {
    kind: "info", id: "first", anchor: "plan-3", face: "surprised",
    say: "你和咕噜一号同一回合完成 n°3，都拿 7 分！",
    note: "同一回合最先完成的人都拿高分，之后完成的只拿 3 分。用过的小区会画上颜色，不能再拆、不能再用。",
  },
  {
    kind: "info", id: "reshuffle", anchor: "plan-3",
    say: "首个完成目标卡时，还可以选择把牌全部重洗。",
    note: "提交时会出一个勾选框「如果我首个完成目标卡就重洗」。牌不顺手时可以勾，这次教程先不勾。",
  },

  // ---------- 临时工 ----------
  {
    kind: "do", id: "r4", lesson: "临时工", expect: me({ combo: 0, street: 0, house: 4, temp: 2 }),
    say: "选「6 · 临时工」，改成 8，写在第 1 条街栅栏右边。",
    stages: {
      combo: "点「6 · 临时工」这一组。",
      temp: "6 放不进栅栏右边（左边已经有 7 了）。临时工能把号码加减 1 或 2：点「8」。",
      house: "现在把 8 写在栅栏右边第一块空地。",
      submit: "雇一个临时工勾一格（不改号码也算）。点「确认提交」。",
    },
  },
  {
    kind: "watch", id: "w4", anchor: "players", moves: [one({ combo: 1, street: 1, house: 8, park: true }), two({ combo: 2, street: 2, house: 10 })],
    say: "等两个咕噜选完……",
  },
  {
    kind: "info", id: "temps", anchor: "track-temps",
    say: "临时工还能比谁雇得多：终局最多的 7 分，第二 4 分，第三 1 分。",
  },

  // ---------- 改造 ----------
  {
    kind: "do", id: "r5", lesson: "改造", expect: me({ combo: 0, street: 0, house: 5, improve: 3 }),
    say: "选「10 · 改造」，10 写在 8 的右边，再改造 3 房小区。",
    stages: {
      combo: "点「10 · 改造」这一组。",
      house: "把 10 写在 8 右边那块地。",
      action: "点计分区「3房」那一列：以后每个 3 房小区从 3 分涨到 4 分。",
      submit: "点「确认提交」。",
    },
  },
  {
    kind: "watch", id: "w5", anchor: "players", moves: [one({ combo: 1, street: 1, house: 2 }), two({ combo: 2, street: 2, house: 8, park: true })],
    say: "等两个咕噜选完……",
  },

  // ---------- bis ----------
  {
    kind: "do", id: "r6", lesson: "bis", expect: me({ combo: 1, street: 0, house: 6, bis: { street: 0, house: 7, from: -1 } }),
    say: "选「11 · bis」，把 11 写在 10 的右边，再复制到隔壁。",
    stages: {
      combo: "点「11 · bis」这一组。",
      house: "把 11 写在 10 右边那块地。",
      action: "点亮着的那块空地，把旁边的 11 复制过去（写成 11B）。",
      submit: "bis 会扣分，越用越贵，只在救急时用。点「确认提交」。",
    },
  },
  {
    kind: "watch", id: "w6", anchor: "players", moves: [one({ combo: 2, street: 1, house: 0, park: true }), two({ combo: 0, street: 0, house: 3 })],
    say: "等两个咕噜选完……",
  },

  // ---------- 拒批、结束和计分 ----------
  {
    kind: "info", id: "refuse", lesson: "拒批和结束", anchor: "track-refusals", face: "think",
    say: "3 组号码都写不进去时只能拒批，第 2、3 次要扣分。",
    note: "所以小号码放左边、大号码放右边，给后面留位置。",
  },
  {
    kind: "info", id: "end", anchor: ["prompt"],
    say: "有人拒批满 3 次、完成 3 张目标卡或 33 块地填满，这回合打完就结束。",
  },
  {
    kind: "info", id: "score", anchor: "score-strip",
    say: "终局把计分区加起来，总分最高的人赢。",
    note: "目标卡 + 公园 + 泳池 + 临时工 + 小区（个数 × 单价）− bis − 拒批。平分比完成的小区多。",
  },
  {
    kind: "info", id: "auto", lesson: "托管",
    say: "每回合 90 秒，超时了人机会替你交。",
    note: "连续 2 次超时进托管：人机替你填，点「取消托管」就拿回来。掉线 3 秒也由人机接手，用原昵称回来就能回座。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了！接下来和两个咕噜把这局打完。",
    note: "拿不准就点「提示」，我告诉你我会怎么填。",
  },
];

/** 剧本牌序：每堆前 7 张按剧本，其余牌按 id 顺序分到 3 堆后面（每堆 27 张）。 */
export function tutorialStacks(): Card[][] {
  const deck = buildDeck();
  const used = new Set(TUTORIAL_STACK_HEADS.flat());
  const rest = deck.filter((card) => !used.has(card.id));
  // 打散一点（固定顺序，不用随机数）：按 (id * 37) % 81 排
  rest.sort((a, b) => ((a.id * 37) % 81) - ((b.id * 37) % 81));
  return TUTORIAL_STACK_HEADS.map((head, index) => {
    const tail = rest.slice(index * 20, (index + 1) * 20);
    return [...head.map((id) => deck[id]!), ...tail];
  });
}

/** 教程开局：3 人（你、咕噜一号、咕噜二号），剧本牌序，你的表先写好几个号码。 */
export function createTutorialGame(selfName: string, seed = 20261011): GameState {
  const base = createGame(
    [{ id: TUTORIAL_SELF, name: selfName }, ...TUTORIAL_BOTS.map((bot) => ({ id: bot.id, name: bot.name }))],
    seed,
    { plans: [...TUTORIAL_PLANS], stacks: tutorialStacks() },
  );
  const sheets = buildGame({
    players: [
      { sheet: TUTORIAL_SHEETS[TUTORIAL_SELF] },
      { sheet: TUTORIAL_SHEETS[ONE] },
      { sheet: TUTORIAL_SHEETS[TWO] },
    ],
  });
  base.players = base.players.map((player, index) => ({ ...player, sheet: sheets.players[index]!.sheet }));
  return base;
}

/** 练习局「再练一局」：同样 3 人，随机开局。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame([{ id: TUTORIAL_SELF, name: selfName }, ...TUTORIAL_BOTS.map((bot) => ({ id: bot.id, name: bot.name }))], seed);
}

/** 现在该谁动：先让还没交的人机交，人机都交了才轮到你（你也可以先交）。结束了返回 null。 */
export function tutorialActor(state: GameState, self: string = TUTORIAL_SELF): string | null {
  if (state.phase !== "play") return null;
  const bot = state.players.find((player) => player.id !== self && !player.submitted);
  if (bot) return bot.id;
  const mine = state.players.find((player) => player.id === self);
  return mine && !mine.submitted ? self : null;
}

/** 你现在能不能动（同时提交：没交就能交；交了还能撤回）。 */
export function selfCanAct(state: GameState, self: string = TUTORIAL_SELF): boolean {
  return state.phase === "play" && state.players.some((player) => player.id === self);
}

function sameMoveBody(a: Move | null, b: Move | null): boolean {
  if (!a || !b) return a === b;
  return a.combo === b.combo && a.street === b.street && a.house === b.house
    && (a.temp ?? null) === (b.temp ?? null)
    && (a.improve ?? null) === (b.improve ?? null)
    && (a.park ?? false) === (b.park ?? false)
    && (a.pool ?? false) === (b.pool ?? false)
    && JSON.stringify(a.fence ?? null) === JSON.stringify(b.fence ?? null)
    && JSON.stringify(a.bis ?? null) === JSON.stringify(b.bis ?? null);
}

/** 两步是不是同一步（同一个人、同一手；不看 step 字段）。 */
export function sameMove(a: TutorialMove, b: TutorialMove): boolean {
  if (a.player !== b.player || a.command.type !== b.command.type) return false;
  if (a.command.type === "submit" && b.command.type === "submit") {
    const x = a.command.submission;
    const y = b.command.submission;
    return sameMoveBody(x.move, y.move)
      && JSON.stringify([...(x.plans ?? [])].sort()) === JSON.stringify([...(y.plans ?? [])].sort())
      && (x.reshuffle ?? false) === (y.reshuffle ?? false);
  }
  return true;
}

/** 草稿走到哪一步了（界面用它挪高亮）。 */
export type TutorialStage = "combo" | "temp" | "house" | "action" | "submit";

/** 草稿（界面里的选组、改号码、填位、行动参数）→ 这一手还差哪一步。 */
export function stageOf(expect: Move, draft: {
  combo: number | null;
  temp: number | null;
  spot: { street: number; house: number } | null;
  fence: { street: number; pos: number } | null;
  improve: number | null;
  bis: { street: number; house: number; from: -1 | 1 } | null;
}): TutorialStage {
  if (draft.combo !== expect.combo) return "combo";
  if ((expect.temp ?? null) !== draft.temp) return "temp";
  if (!draft.spot || draft.spot.street !== expect.street || draft.spot.house !== expect.house) return "house";
  if (expect.fence && JSON.stringify(draft.fence) !== JSON.stringify(expect.fence)) return "action";
  if (expect.improve !== undefined && draft.improve !== expect.improve) return "action";
  if (expect.bis && (!draft.bis || draft.bis.street !== expect.bis.street || draft.bis.house !== expect.bis.house || draft.bis.from !== expect.bis.from)) return "action";
  return "submit";
}

/** 这一阶段高亮哪个元素（对应网页 data-tutorial）。 */
export function stageAnchor(expect: Move, stage: TutorialStage): string {
  switch (stage) {
    case "combo": return `combo-${expect.combo + 1}`;
    case "temp": return `temp:${expect.temp ?? 0}`;
    case "house": return `house:${expect.street}:${expect.house}`;
    case "action":
      if (expect.fence) return `fence:${expect.fence.street}:${expect.fence.pos}`;
      if (expect.improve !== undefined) return `improve:${expect.improve}`;
      if (expect.bis) return `house:${expect.bis.street}:${expect.bis.house}`;
      return "submit";
    case "submit": return "submit";
  }
}

/** 这一阶段允许点什么（GameBoard 的 allow(what) 用；别的点击不理）。 */
export function stageAllows(expect: Move, stage: TutorialStage, what: string): boolean {
  switch (stage) {
    case "combo": return what === `combo:${expect.combo}`;
    case "temp": return what === `temp:${expect.temp}`;
    case "house": return what === `house:${expect.street}:${expect.house}`;
    case "action":
      if (expect.fence) return what === `fence:${expect.fence.street}:${expect.fence.pos}`;
      if (expect.improve !== undefined) return what === `improve:${expect.improve}`;
      if (expect.bis) return what === `bis:${expect.bis.street}:${expect.bis.house}`;
      return false;
    case "submit": return what === "submit";
  }
}

export function anchorCandidates(step: TutorialStep): readonly string[] {
  if (!step.anchor) return [];
  return typeof step.anchor === "string" ? [step.anchor] : step.anchor;
}

/**
 * 这个锚点在这个局面里界面上应该看得见吗（剧本单测用）。表、计分区、目标卡、玩家条、提示一直在；
 * 3 组和「确认提交」只在对局进行中有；门牌位、栅栏缝、改造列、临时工按钮按位置和组判断。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string = TUTORIAL_SELF): boolean {
  const mine = state.players.find((player) => player.id === viewer);
  if (!mine) return false;
  const fixed = ["sheet", "plans", "players", "prompt", "score-strip", "total", "track-plans", "track-pools", "track-temps", "track-bis", "track-refusals", "track-estates", "street-1", "street-2", "street-3", "plan-1", "plan-2", "plan-3"];
  if (fixed.includes(anchor)) return true;
  const playing = state.phase === "play";
  if (anchor === "combos" || anchor === "submit") return playing;
  if (anchor.startsWith("combo-")) return playing && Number(anchor.slice(6)) <= state.combos.length;
  if (anchor.startsWith("house:")) {
    const [s, h] = anchor.slice(6).split(":").map(Number);
    return s! >= 0 && s! < 3 && h! >= 0 && h! < mine.sheet.houses[s!]!.length;
  }
  if (anchor.startsWith("fence:")) return playing;
  if (anchor.startsWith("improve:")) return true;
  if (anchor.startsWith("temp:")) return playing && state.combos.some((combo) => combo.action === "temp");
  return false;
}
