/**
 * 正式美术的路径和颜色（规格见仓库 art/spec.md）。路径都以 BASE_URL 开头，子路径部署也对。
 */
import type { Action } from "@welcometo/game";

const BASE = import.meta.env.BASE_URL;
const art = (path: string) => `${BASE}art/${path}`;

export const ART = {
  bgNight: art("bg/street-night.png"),
  bgDay: art("bg/street-day.png"),
  lot: art("houses/lot-empty.png"),
  strip: art("sheet/street-strip.png"),
  fence: art("sheet/fence.png"),
  parkEmpty: art("sheet/park-empty.png"),
  parkTree: art("sheet/park-tree.png"),
  poolEmpty: art("sheet/pool-empty.png"),
  poolFull: art("sheet/pool-full.png"),
  poolAnim: art("sheet/pool-full-anim.png"),
  stampOk: art("icons/stamp-ok.png"),
  stampNo: art("icons/stamp-no.png"),
  cardNum: art("cards/num.png"),
  cardBack: art("cards/back.png"),
  confetti: art("fx/confetti.png"),
  puff: art("fx/build-puff.png"),
  sparkle: art("fx/sparkle.png"),
} as const;

const TYPES = ["a", "b", "c"] as const;

/** 已填的门牌位：房型按 (街*7 + 位) % 3 固定（街、位都从 1 数），别人看同一张表也一样。 */
export function houseArt(street: number, house: number): string {
  return art(`houses/house-${street + 1}-${TYPES[((street + 1) * 7 + (house + 1)) % 3]}.png`);
}

export function miniHouseArt(street: number): string {
  return art(`houses/house-mini-${street + 1}.png`);
}

export function actionIcon(action: Action): string {
  return art(`icons/act-${action}.png`);
}

export function actionCard(action: Action): string {
  return art(`cards/act-${action}.png`);
}

export function planArt(tier: number, approved: boolean): string {
  return art(`plans/plan-${tier + 1}${approved ? "-ok" : ""}.png`);
}

/** 行动颜色（卡面底色，按钮、高亮也用）。 */
export const ACTION_COLORS: Record<Action, string> = {
  fence: "#d79a62",
  improve: "#f2c85a",
  park: "#7fcf8f",
  pool: "#5aa6e0",
  temp: "#b391dd",
  bis: "#ee8fb2",
};

/** 目标卡颜色：项目面 / 获批面。 */
export const PLAN_COLORS = [
  ["#3fa7a0", "#9fd3cf"],
  ["#e0755e", "#f0b8aa"],
  ["#7177c8", "#b5b8e2"],
] as const;

/** 座位色（最多 6 人）。 */
export const SEAT_COLORS = ["#e8735c", "#4f9be0", "#3fb98a", "#e9b93a", "#a17fd6", "#e77fae"];

export function seatColor(seat: number): string {
  return SEAT_COLORS[seat % SEAT_COLORS.length]!;
}

/** 座位色上的字色（黄色、浅色底上用深字）。 */
export function seatInk(seat: number): string {
  return seat % SEAT_COLORS.length === 3 ? "#2a1c06" : "#ffffff";
}

export function sceneFor(theme: "day" | "night"): string {
  return theme === "day" ? ART.bgDay : ART.bgNight;
}

/** 样式表里要用的图（CSS 里写死路径在子路径下会坏）：挂到 :root 的 CSS 变量上，首页/等候房铺全屏背景用。 */
export function installArtVars(): void {
  const style = document.documentElement.style;
  style.setProperty("--bg-night", `url(${ART.bgNight})`);
  style.setProperty("--bg-day", `url(${ART.bgDay})`);
}
