/**
 * 像素美术的地址。图片放在 public/art 下（PixelLab 生成，art/export.py 导出）。
 * 图片地址固定；换图后不会被浏览器缓存挡住，靠服务器给这些文件加 Cache-Control: no-cache。
 */
const ROOT = `${import.meta.env.BASE_URL}art/`;

/** 座位色：红、蓝、绿、黄（Player.color 是下标）。 */
export const SEATS = [
  { key: "red", name: "红", hex: "#e5533f", light: "#ff9c8a", dark: "#7a1f16" },
  { key: "blue", name: "蓝", hex: "#3b82f0", light: "#9cc4ff", dark: "#173d80" },
  { key: "green", name: "绿", hex: "#44b860", light: "#9fe8ac", dark: "#175e2a" },
  { key: "yellow", name: "黄", hex: "#f0c030", light: "#ffe79a", dark: "#7a5a08" },
] as const;

export function seatOf(color: number) {
  return SEATS[color % SEATS.length]!;
}

/** 场景大图：对局背景有几张（清晨、黄昏、月夜），每个房间按房间码固定分到一张。 */
export const sceneArt = {
  backdrops: [0, 1, 2, 3, 4, 5].map((index) => `${ROOT}scene/backdrop-${index}.png`),
  hero: `${ROOT}scene/hero.png`,
};

export function backdropFor(roomCode: string): string {
  let hash = 0;
  for (const char of roomCode) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return sceneArt.backdrops[hash % sceneArt.backdrops.length]!;
}

/** 赛道上的岩块：普通岩块几种轮换，最顶上一格是积雪岩块。 */
export const tileArt = {
  rock: [0, 1, 2, 3].map((index) => `${ROOT}tiles/rock-${index}.png`),
  snow: [0, 1].map((index) => `${ROOT}tiles/snow-${index}.png`),
};

/** 登山者（临时标记）、营地小旗（永久标记）、山顶大旗（占领）按座位色各一套。 */
export const climberArt = (color: number) => `${ROOT}sprites/climber-${seatOf(color).key}.png`;
/** 攀爬动画：横排精灵图，CLIMB_FRAMES 帧。 */
export const climberClimbArt = (color: number) => `${ROOT}sprites/climber-${seatOf(color).key}-climb.png`;
export const CLIMB_FRAMES = 8;
/** 登顶欢呼（8 帧）、爆掉摔落（6 帧）。 */
export const climberCheerArt = (color: number) => `${ROOT}sprites/climber-${seatOf(color).key}-cheer.png`;
export const climberFallArt = (color: number) => `${ROOT}sprites/climber-${seatOf(color).key}-fall.png`;
export const campArt = (color: number) => `${ROOT}sprites/camp-${seatOf(color).key}.png`;
export const summitArt = (color: number) => `${ROOT}sprites/summit-${seatOf(color).key}.png`;
/** 山顶大旗飘动：横排精灵图，WAVE_FRAMES 帧。 */
export const summitWaveArt = (color: number) => `${ROOT}sprites/summit-${seatOf(color).key}-wave.png`;
export const WAVE_FRAMES = 4;
export const avatarArt = (color: number) => `${ROOT}sprites/avatar-${seatOf(color).key}.png`;

/** 骰子六个面。 */
export const dieArt = (face: number) => `${ROOT}dice/die-${face}.png`;

/** 界面小图标和装饰。 */
export const iconArt = {
  dice: `${ROOT}ui/dice.png`,
  camp: `${ROOT}ui/camp.png`,
  rockfall: `${ROOT}ui/rockfall.png`,
  trophy: `${ROOT}ui/trophy.png`,
  sign: `${ROOT}ui/sign.png`,
  campfire: `${ROOT}ui/campfire.png`,
  /** 营火跳动：横排精灵图 4 帧。 */
  campfireAnim: `${ROOT}ui/campfire-anim.png`,
  pine: `${ROOT}ui/pine.png`,
  pine2: `${ROOT}ui/pine2.png`,
};
