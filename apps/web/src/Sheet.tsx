/**
 * 玩家表：三条街（房子、门牌号牌、栅栏、泳池、完成小区的括号）+ 每条街右边的公园轨。
 * 画的是 sheet（可能是「我这一手填完以后」的草稿），和 base 不同的地方标成草稿（金色虚线）。
 */
import type { CSSProperties, ReactNode } from "react";
import { PARK_TRACKS, POOL_SLOTS, segments, type Plan, type Sheet } from "@welcometo/game";
import { ART, houseArt, miniHouseArt, PLAN_COLORS } from "./art.js";

export interface SheetLayout {
  /** 房子倍数（0 = 手机紧凑表，用 16px 的小房子）。 */
  readonly hs: number;
  /** 每个门牌位的宽度（px）。 */
  readonly cellW: number;
  /** 两房之间的缝（栅栏位）宽度（px）。 */
  readonly gapW: number;
  readonly parkScale?: number;
}

export interface SheetTargets {
  /** 能填的门牌位 "s:h"。有值时其余空位变暗。 */
  readonly houses?: ReadonlySet<string>;
  readonly onHouse?: (street: number, house: number) => void;
  /** 已经选好位置了：其余能填的位置只淡淡标出（还能点，换位置），把注意力留给行动。 */
  readonly housesQuiet?: boolean;
  /** 能画栅栏的缝 "s:p"。 */
  readonly fences?: ReadonlySet<string>;
  readonly onFence?: (street: number, pos: number) => void;
  /** 能 bis 的空位 "s:h"。 */
  readonly bis?: ReadonlySet<string>;
  readonly onBis?: (street: number, house: number) => void;
  /** 点了变暗的空地（这个号码写不进去）：响一声「不行」。 */
  readonly onDeny?: () => void;
}

const STREET_NAMES = ["第 1 条街", "第 2 条街", "第 3 条街"];

export function SheetView({ sheet, base, plans, layout, targets = {}, recentRound, label, footer }: {
  sheet: Sheet;
  /** 草稿之前的表（不给 = 没有草稿）。 */
  base?: Sheet;
  plans: readonly Plan[];
  layout: SheetLayout;
  targets?: SheetTargets;
  /** 这一回合填的房子轻轻标出来（上一回合结算的）。 */
  recentRound?: number;
  label?: ReactNode;
  footer?: ReactNode;
}) {
  const segs = segments(sheet);
  const compact = layout.hs === 0;
  const houseW = compact ? 16 : 32 * layout.hs;
  const vars = {
    "--hs": compact ? 1 : layout.hs,
    "--cell": `${layout.cellW}px`,
    "--gap": `${layout.gapW}px`,
    "--house": `${houseW}px`,
    "--strip": `url(${ART.strip})`,
    "--puff": `url(${ART.puff})`,
  } as CSSProperties;
  return (
    <div className={`wt-sheet${compact ? " compact" : ""}`} style={vars} data-tutorial="sheet">
      {label}
      {sheet.houses.map((row, street) => (
        <div className="wt-street-row" key={street} data-tutorial={`street-${street + 1}`}>
          {compact && (
            <div className="wt-street-head">
              <span>{STREET_NAMES[street]}</span>
              <ParkTrack sheet={sheet} base={base} street={street} compact />
            </div>
          )}
          <div className="wt-street" aria-label={STREET_NAMES[street]}>
            <div className="wt-houses">
              {row.map((house, index) => {
                const key = `${street}:${index}`;
                const baseHouse = base ? base.houses[street]![index] : house;
                const draft = !!house && !baseHouse;
                const legal = targets.houses?.has(key) ?? false;
                const bisTarget = targets.bis?.has(key) ?? false;
                const dim = !house && targets.houses !== undefined && !legal && !bisTarget && !targets.housesQuiet;
                const poolSlot = POOL_SLOTS[street]!.includes(index);
                const pool = sheet.pools[street]![index];
                const poolDraft = pool && base && !base.pools[street]![index];
                const recent = !!house && !draft && recentRound !== undefined && house.round === recentRound;
                const clickable = legal || bisTarget;
                // 已经选好位置、正在挑 bis 的空地时，bis 优先（这块地也可能还能换位置）
const onClick = bisTarget ? () => targets.onBis?.(street, index) : legal ? () => targets.onHouse?.(street, index) : undefined;
                const cls = `wt-lot${house ? " built" : ""}${draft ? " draft" : ""}${legal && !bisTarget ? (targets.housesQuiet ? " movable" : " legal") : ""}${bisTarget ? " bis-target" : ""}${dim ? " dim" : ""}${recent ? " recent" : ""}`;
                const content = (
                  <>
                    <span className="wt-house-pic">
                      <img src={house ? (compact ? miniHouseArt(street) : houseArt(street, index)) : ART.lot} alt="" width={houseW} height={houseW} draggable={false} />
                      {poolSlot && !compact && (
                        <img className={`wt-pool-mark${poolDraft ? " draft" : ""}`} src={pool ? ART.poolFull : ART.poolEmpty} alt={pool ? "泳池已建成" : "泳池位"} width={16 * layout.hs} height={16 * layout.hs} draggable={false} />
                      )}
                      {poolSlot && compact && <i className={`wt-pool-dot${pool ? " full" : ""}${poolDraft ? " draft" : ""}`} aria-label={pool ? "泳池已建成" : "泳池位"} />}
                    </span>
                    <span className="wt-plate">{house ? <>{house.num}{house.bis && <small>B</small>}</> : ""}</span>
                  </>
                );
                return clickable ? (
                  <button key={index} type="button" className={cls} onClick={onClick} data-sfx="none" data-house={key} data-tutorial={`house:${key}`} aria-label={`${STREET_NAMES[street]}第 ${index + 1} 格${house ? `：${house.num}` : ""}`}>
                    {content}
                  </button>
                ) : (
                  <div key={index} className={cls} data-house={key} data-tutorial={`house:${key}`} onClick={dim ? targets.onDeny : undefined}>
                    {content}
                  </div>
                );
              })}
            </div>
            <div className="wt-fences" aria-hidden={targets.fences ? undefined : true}>
              {row.slice(0, -1).map((_, pos) => {
                const key = `${street}:${pos}`;
                const on = sheet.fences[street]![pos];
                const draft = on && base && !base.fences[street]![pos];
                const can = targets.fences?.has(key) ?? false;
                const left = (pos + 1) * layout.cellW + pos * layout.gapW;
                const style = { left: `${left}px` } as CSSProperties;
                if (can) {
                  return (
                    <button key={pos} type="button" className="wt-fence-slot can" style={style} data-sfx="none" onClick={() => targets.onFence?.(street, pos)} aria-label={`在${STREET_NAMES[street]}第 ${pos + 1}、${pos + 2} 格之间画栅栏`} data-fence={key} data-tutorial={`fence:${key}`}>
                      <i />
                    </button>
                  );
                }
                if (!on) return null;
                return (
                  <span key={pos} className={`wt-fence-slot on${draft ? " draft" : ""}`} style={style} data-fence={key} data-tutorial={`fence:${key}`} onClick={draft ? () => targets.onFence?.(street, pos) : undefined}>
                    {!compact && <img src={ART.fence} alt="" width={8 * layout.hs} height={32 * layout.hs} draggable={false} />}
                  </span>
                );
              })}
            </div>
            <div className="wt-brackets" aria-hidden="true">
              {segs.filter((segment) => segment.street === street && segment.complete).map((segment) => {
                const left = segment.start * (layout.cellW + layout.gapW);
                const width = segment.size * layout.cellW + (segment.size - 1) * layout.gapW;
                const color = segment.plan !== null ? PLAN_COLORS[plans[segment.plan]?.tier ?? segment.plan]![0] : undefined;
                return (
                  <span
                    key={segment.start}
                    className={`wt-bracket${segment.plan !== null ? " used" : ""}`}
                    style={{ left: `${left}px`, width: `${width}px`, ...(color ? { "--plan": color } : {}) } as CSSProperties}
                  >
                    {compact ? segment.size : `${segment.size}房`}
                  </span>
                );
              })}
            </div>
          </div>
          {!compact && <ParkTrack sheet={sheet} base={base} street={street} hs={layout.parkScale ?? layout.hs} houseH={houseW} />}
        </div>
      ))}
      {footer}
    </div>
  );
}

/** 一条街的公园轨：每格下面写勾到这格时的分（0,2,4,10…）。 */
export function ParkTrack({ sheet, base, street, hs = 1, compact = false, houseH }: { sheet: Sheet; base?: Sheet | undefined; street: number; hs?: number; compact?: boolean; houseH?: number }) {
  const track = PARK_TRACKS[street]!;
  const count = sheet.parks[street]!;
  const before = base ? base.parks[street]! : count;
  const size = compact ? 16 : 16 * hs;
  return (
    <div className={`wt-parks${compact ? " compact" : ""}`} data-tutorial={`parks-${street + 1}`} aria-label={`公园 ${track[count]} 分`} style={houseH ? { marginTop: `${houseH - size}px` } : undefined}>
      {track.slice(1).map((value, index) => {
        const on = index < count;
        const draft = on && index >= before;
        return (
          <span key={index} className={`wt-park${on ? " on" : ""}${draft ? " draft" : ""}${index === track.length - 2 ? " bonus" : ""}`}>
            <img src={on ? ART.parkTree : ART.parkEmpty} alt="" width={size} height={size} draggable={false} />
            {!compact && <small>{value}</small>}
          </span>
        );
      })}
      {compact && <b>{track[count]}</b>}
    </div>
  );
}
