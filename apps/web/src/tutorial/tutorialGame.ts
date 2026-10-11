/** 欢迎来到的教程设置：游戏 id、「第一次遇到」小贴士。剧本在规则包 packages/game/src/tutorial.ts。 */
import { estates, type GameState } from "@welcometo/game";

export const GAME_ID = "welcometo";

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "refuse-self": {
    title: "你拒批了",
    text: "3 组号码都写不进你的表，这回合只能拒批。拒批第 2、3 次要扣分，满 3 次游戏结束：小号码放左、大号码放右，给后面留位置。",
  },
  "auto-self": {
    title: "你进入了托管",
    text: "连续 2 次超时，现在由人机替你填表。点「取消托管」就能拿回来。",
  },
  timeout: {
    title: "你超时了",
    text: "人机替你交了这一手。再连续超时一次就会进入托管。",
  },
  "estate-self": {
    title: "你围出了小区",
    text: "两道栅栏之间全部填满的 1–6 座房子就是一个小区，终局按个数 × 单价计分。改造能提高某个尺寸的单价。",
  },
  "plan-other": {
    title: "有人首批完成了目标卡",
    text: "这张卡翻到了获批面，之后再完成只能拿低分。别的卡还没人完成，抓紧。",
  },
  reshuffle: {
    title: "牌重洗了",
    text: "首批完成目标卡的人选了重洗：81 张牌重新洗成 3 堆，下一回合从新堆翻。",
  },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。auto：自己正被托管。 */
export function detectTips(game: GameState, selfId: string, auto: boolean): string[] {
  const ids: string[] = [];
  if (!selfId) return ids;
  for (const event of game.events) {
    if (event.type === "Refused" && event.player === selfId) ids.push("refuse-self");
  }
  if (auto) ids.push("auto-self");
  for (const event of game.events) {
    if (event.type === "TimedOut" && event.players.includes(selfId)) ids.push("timeout");
  }
  const me = game.players.find((player) => player.id === selfId);
  if (me && game.events.some((event) => event.type === "RoundResolved") && estates(me.sheet).length > 0) ids.push("estate-self");
  for (const event of game.events) {
    if (event.type === "PlanApproved" && !event.players.includes(selfId)) ids.push("plan-other");
    if (event.type === "Reshuffled" && event.reason === "plan") ids.push("reshuffle");
  }
  return ids;
}
