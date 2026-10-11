/**
 * 牌桌布局：按可视区域挑房子倍数（1×/2×/3×，整数倍才清楚）、门牌位宽度、建造牌倍数。
 * 桌面：左边是目标卡 + 表 + 计分区 + 玩家条，右边一列是 3 组建造牌和操作。手机：一列，房子用 16px 小图。
 */
export interface BoardLayout {
  readonly mode: "desk" | "phone";
  readonly hs: number;
  readonly cellW: number;
  readonly gapW: number;
  /** 建造牌倍数。 */
  readonly cs: number;
  /** 目标卡倍数。 */
  readonly ps: number;
  /** 右栏宽度（px）。 */
  readonly rightW: number;
  /** 公园格倍数（3× 房子时公园用 2×，省横向空间）。 */
  readonly parkScale: number;
}

export const TOP_H = 52;
const PAD = 12;

export function pickLayout(w: number, h: number): BoardLayout {
  if (w < 700) {
    const cellW = Math.max(24, Math.min(32, Math.floor((w - 20 - 11 * 2) / 12)));
    return { mode: "phone", hs: 0, cellW, gapW: 2, cs: 1, ps: 1, rightW: 0, parkScale: 1 };
  }
  const rightW = w >= 1800 ? 420 : w >= 1280 ? 360 : 300;
  const leftW = w - rightW - PAD * 3;
  const plansH = h < 760 ? 104 : 120;
  const stripH = leftW >= 1180 ? 96 : leftW >= 900 ? 132 : 172;
  const tabsH = h < 760 ? 44 : 56;
  let pick = { hs: 1, gapW: 6, parkW: 0, minCell: 40 };
  for (const hs of [3, 2, 1]) {
    const gapW = Math.max(6, 3 * hs);
    const parkW = (16 * Math.min(hs, 2) + 6) * 5 + 16;
    const minCell = Math.max(32 * hs, 40);
    const needW = 12 * minCell + 11 * gapW + parkW;
    const rowH = 32 * hs + 32 + 16 + 8;
    const needH = TOP_H + PAD + plansH + 3 * rowH + stripH + tabsH + 4 * 8 + PAD;
    if (needW <= leftW && needH <= h) {
      pick = { hs, gapW, parkW, minCell };
      break;
    }
    pick = { hs: 1, gapW: 6, parkW: (16 + 6) * 5 + 16, minCell: 40 };
  }
  const cellW = Math.max(pick.minCell, Math.min(Math.floor((leftW - pick.parkW - 11 * pick.gapW) / 12), 32 * pick.hs + 24));
  const rightH = h - TOP_H - PAD * 2;
  const cs = rightH - (3 * 128 + 20) >= 300 ? 2 : 1;
  return { mode: "desk", hs: pick.hs, cellW, gapW: pick.gapW, cs, ps: 2, rightW, parkScale: Math.min(pick.hs, 2) };
}
