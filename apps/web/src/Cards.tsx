/**
 * 建造牌（一组 = 数字面 + 行动面）和目标卡。数字、分值、小区要求都用代码叠在图上。
 */
import type { CSSProperties } from "react";
import { ACTION_NAMES, type Combo, type Plan } from "@welcometo/game";
import { ART, actionCard, miniHouseArt, planArt } from "./art.js";

export function ComboCard({ combo, index, scale, selected, unusable, shownNum, places, onClick, disabled }: {
  combo: Combo;
  index: number;
  /** 牌的倍数（1 = 48×64，2 = 96×128）。 */
  scale: number;
  selected?: boolean;
  /** 这组没地方填。 */
  unusable?: boolean;
  /** 临时工调整后显示的数字（不给 = 原数字）。 */
  shownNum?: number;
  /** 能放几处（显示在旁边）。 */
  places?: number;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const style = { "--cs": scale } as CSSProperties;
  const changed = shownNum !== undefined && shownNum !== combo.num;
  const body = (
    <>
      <span className="wt-card num" style={{ backgroundImage: `url(${ART.cardNum})` }}>
        <b className={changed ? "changed" : ""}>{changed ? shownNum : combo.num}</b>
        {changed && <small>原 {combo.num}</small>}
      </span>
      <span className="wt-card act" style={{ backgroundImage: `url(${actionCard(combo.action)})` }}>
        <i>{ACTION_NAMES[combo.action]}</i>
      </span>
      {places !== undefined && (
        <span className="wt-combo-info">
          <b>{ACTION_NAMES[combo.action]}</b>
          <small>{unusable ? "放不下" : `能放 ${places} 处`}</small>
        </span>
      )}
    </>
  );
  const cls = `wt-combo cs${scale}${selected ? " selected" : ""}${unusable ? " unusable" : ""}`;
  if (!onClick) return <div className={cls} style={style} data-combo={index} data-tutorial={`combo-${index + 1}`}>{body}</div>;
  return (
    <button type="button" className={cls} style={style} onClick={onClick} disabled={disabled} aria-pressed={selected} data-combo={index} data-tutorial={`combo-${index + 1}`}
      aria-label={`第 ${index + 1} 组：${combo.num} · ${ACTION_NAMES[combo.action]}${unusable ? "（放不下）" : ""}`}>
      {body}
    </button>
  );
}

/** 小区要求分组：[1,1,4] → [[1,1]... ] 不需要，直接按尺寸画一串小房子，组之间留空。 */
function NeedHouses({ need, tier }: { need: readonly number[]; tier: number }) {
  return (
    <span className={`wt-need${need.length > 3 || need.reduce((a, b) => a + b, 0) > 6 ? " wrap" : ""}`}>
      {need.map((size, k) => (
        <span className="wt-need-group" key={k}>
          {Array.from({ length: size }, (_, i) => <img key={i} src={miniHouseArt(tier)} alt="" width={16} height={16} />)}
        </span>
      ))}
    </span>
  );
}

/** 短写法：[1,1,1,4] → 1×3+4。 */
export function needShort(need: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const size of need) counts.set(size, (counts.get(size) ?? 0) + 1);
  return [...counts.entries()].map(([size, count]) => (count > 1 ? `${size}×${count}` : `${size}`)).join("+");
}

export function needText(need: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const size of need) counts.set(size, (counts.get(size) ?? 0) + 1);
  return [...counts.entries()].map(([size, count]) => `${count} 个 ${size} 房`).join(" + ");
}

export function PlanCard({ plan, index, scale, myScore, claimable, celebrate, compact = false }: {
  plan: Plan;
  index: number;
  scale: number;
  /** 我验证这张卡记的分（没验证 = null）。 */
  myScore: number | null;
  /** 这一手填完能验证。 */
  claimable?: boolean;
  /** 刚被首批验证：放一次彩带。 */
  celebrate?: boolean;
  compact?: boolean;
}) {
  const approved = plan.approvedRound !== null;
  const value = approved ? plan.low : plan.high;
  const style = { "--ps": scale, "--confetti": `url(${ART.confetti})` } as CSSProperties;
  const title = `目标卡 n°${index + 1}：${needText(plan.need)}。${approved ? `已经有人首批完成，现在完成拿 ${plan.low} 分` : `首批完成拿 ${plan.high} 分，之后完成拿 ${plan.low} 分`}`;
  return (
    <div className={`wt-plan${approved ? " approved" : ""}${claimable ? " claimable" : ""}${myScore !== null ? " mine" : ""}${compact ? " compact" : ""}`} style={style} title={title} data-tutorial={`plan-${index + 1}`} aria-label={title}>
      <span className="wt-plan-card" style={{ backgroundImage: `url(${planArt(plan.tier, approved)})` }}>
        <span className="wt-plan-no">{plan.tier + 1}</span>
        {compact ? <span className="wt-plan-need-text">{needShort(plan.need)}</span> : <NeedHouses need={plan.need} tier={plan.tier} />}
        {!compact && <b className="wt-plan-score">{value}</b>}
        {myScore !== null && <img className="wt-plan-stamp" src={ART.stampOk} alt="已验证" width={24 * Math.max(1, scale - 1)} height={24 * Math.max(1, scale - 1)} />}
        {celebrate && <i className="wt-confetti" aria-hidden="true" />}
      </span>
      {compact && <b className="wt-plan-score-out">{value}</b>}
      {!compact && <small className="wt-plan-sub">{approved ? `首批 ${plan.high} 已被拿走` : `之后 ${plan.low}`}</small>}
    </div>
  );
}
