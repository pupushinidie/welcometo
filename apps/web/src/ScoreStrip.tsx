/**
 * 计分区：目标卡、泳池、临时工、bis、拒批、6 个小区尺寸列（改造）、总分。印面值都由代码画。
 * sheet 可能是草稿（这一手填完以后），和 base 不同的格子标成草稿。
 */
import type { CSSProperties } from "react";
import {
  BIS_TRACK,
  ESTATE_TRACKS,
  POOL_TRACK,
  REFUSAL_TRACK,
  TEMP_MAX,
  estateCounts,
  type Plan,
  type ScoreBreakdown,
  type Sheet,
} from "@welcometo/game";
import { ART, actionIcon, miniHouseArt, PLAN_COLORS } from "./art.js";

export function ScoreStrip({ sheet, base, plans, score, improvable, onImprove, compact = false }: {
  sheet: Sheet;
  base?: Sheet | undefined;
  plans: readonly Plan[];
  score: ScoreBreakdown;
  /** 能改造的尺寸（1–6）；有值时这些列能点。 */
  improvable?: ReadonlySet<number>;
  onImprove?: (size: number) => void;
  compact?: boolean;
}) {
  const b = base ?? sheet;
  const counts = estateCounts(sheet);
  return (
    <div className={`wt-strip${compact ? " compact" : ""}`} data-tutorial="score-strip">
      <div className="wt-track wt-track-plans" data-tutorial="track-plans">
        <span className="wt-track-name">目标卡</span>
        <div className="wt-cells">
          {plans.map((plan, index) => {
            const value = sheet.plans[index];
            const draft = value !== null && b.plans[index] === null;
            return (
              <span key={index} className={`wt-cell plan${value !== null ? " on" : ""}${draft ? " draft" : ""}`} style={{ "--plan": PLAN_COLORS[plan.tier]![0] } as CSSProperties}>
                {value ?? "—"}
              </span>
            );
          })}
        </div>
        <b className="wt-track-value">{score.plans}</b>
      </div>

      <Track name="泳池" icon={actionIcon("pool")} values={POOL_TRACK.slice(1)} count={sheet.poolTrack} before={b.poolTrack} kind="pool" value={score.pools} tutorial="track-pools" />

      <div className="wt-track wt-track-temps" data-tutorial="track-temps">
        <img className="wt-track-icon" src={actionIcon("temp")} alt="" width={32} height={32} />
        <span className="wt-track-name">临时工</span>
        <div className="wt-cells temps">
          {Array.from({ length: TEMP_MAX }, (_, index) => (
            <span key={index} className={`wt-tick${index < sheet.temps ? " on" : ""}${index < sheet.temps && index >= b.temps ? " draft" : ""}`} />
          ))}
        </div>
        <b className="wt-track-value" title="临时工多数：现在按格数排第几（终局才定）">{sheet.temps}<small>格</small>{score.temps > 0 ? <em>≈{score.temps}</em> : null}</b>
      </div>

      <Track name="bis" icon={actionIcon("bis")} values={BIS_TRACK.slice(1)} count={sheet.bis} before={b.bis} kind="bis" value={-score.bis} tutorial="track-bis" />
      <Track name="拒批" icon={ART.stampNo} values={REFUSAL_TRACK.slice(1)} count={sheet.refusals} before={b.refusals} kind="refuse" value={-score.refusals} tutorial="track-refusals" />

      <div className={`wt-track wt-track-estates${improvable && improvable.size > 0 ? " picking" : ""}`} data-tutorial="track-estates">
        <span className="wt-track-name">小区</span>
        <div className="wt-estate-cols">
          {ESTATE_TRACKS.map((track, index) => {
            const size = index + 1;
            const ticked = sheet.improve[index]!;
            const before = b.improve[index]!;
            const can = improvable?.has(size) ?? false;
            const body = (
              <>
                <span className="wt-estate-head">
                  {!compact && <img src={miniHouseArt(index % 3)} alt="" width={16} height={16} />}
                  <span>{size}房</span>
                  {counts[index]! > 0 && <em>×{counts[index]}</em>}
                </span>
                <span className="wt-estate-values">
                  {track.map((value, k) => (
                    <i key={k} className={`${k < ticked ? "off" : k === ticked ? "now" : ""}${k < ticked && k >= before ? " draft" : ""}`}>{value}</i>
                  ))}
                </span>
              </>
            );
            return can ? (
              <button key={size} type="button" className="wt-estate-col can" data-sfx="none" onClick={() => onImprove?.(size)} data-improve={size} data-tutorial={`improve:${size}`} aria-label={`改造 ${size} 房小区`}>
                {body}
              </button>
            ) : (
              <span key={size} className={`wt-estate-col${ticked > before ? " draft" : ""}`} data-improve={size} data-tutorial={`improve:${size}`}>
                {body}
              </span>
            );
          })}
        </div>
        <b className="wt-track-value">{score.estates}</b>
      </div>

      <div className="wt-total" data-tutorial="total">
        <span>总分</span>
        <b>{score.total}</b>
      </div>
    </div>
  );
}

function Track({ name, icon, values, count, before, kind, value, tutorial }: {
  name: string;
  icon: string;
  values: readonly number[];
  count: number;
  before: number;
  kind: "pool" | "bis" | "refuse";
  value: number;
  tutorial: string;
}) {
  return (
    <div className={`wt-track wt-track-${kind}`} data-tutorial={tutorial}>
      <img className="wt-track-icon" src={icon} alt="" width={kind === "refuse" ? 24 : 32} height={kind === "refuse" ? 24 : 32} />
      <span className="wt-track-name">{name}</span>
      <div className="wt-cells">
        {values.map((cell, index) => (
          <span key={index} className={`wt-cell ${kind}${index < count ? " on" : ""}${index < count && index >= before ? " draft" : ""}`}>
            {cell}
          </span>
        ))}
      </div>
      <b className="wt-track-value">{value}</b>
    </div>
  );
}
