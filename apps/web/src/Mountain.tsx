import { useEffect, useRef, useState, type CSSProperties } from "react";
import { COLUMNS, COLUMN_HEIGHTS, MAX_HEIGHT, type Column, type GameState, type Runner } from "@welcometo/game";
import { campArt, climberArt, climberCheerArt, climberClimbArt, climberFallArt, iconArt, seatOf, summitWaveArt, tileArt } from "./art.js";

// ---- 棋盘坐标（单位是美术像素，乘以缩放 u 得到屏幕像素）----
// 每格是一块 24×24 的岩块，上下贴合，赛道之间空 8 像素；最高的 7 号赛道上方留出山顶大旗，底下是路牌。
// 登山者、路牌是 32×32，比岩块宽，居中摆放。
const BLOCK = 24;
const SPRITE = 32;
const PITCH = 32;
const ROW = 24;
const TOP = 56;
const BASE = 40;
const SIDE = 12;
export const BOARD_W = SIDE * 2 + PITCH * (COLUMNS.length - 1) + BLOCK;
export const BOARD_H = TOP + ROW * MAX_HEIGHT + BASE;

const GROUND = TOP + ROW * MAX_HEIGHT;

/** 山脚两侧的装饰（棋盘坐标，可以超出棋盘）。sink：往地面里埋几像素，看起来是长在地上。 */
const DECOR = [
  { key: "pine-a", src: iconArt.pine, x: -78, w: 32, h: 48, sink: 3 },
  { key: "pine-b", src: iconArt.pine2, x: -46, w: 32, h: 48, sink: 4 },
  { key: "pine-c", src: iconArt.pine2, x: -116, w: 32, h: 48, sink: 2 },
  { key: "campfire", src: iconArt.campfireAnim, x: BOARD_W + 10, w: 32, h: 32, sink: 6 },
  { key: "pine-d", src: iconArt.pine, x: BOARD_W + 48, w: 32, h: 48, sink: 3 },
  { key: "pine-e", src: iconArt.pine2, x: BOARD_W + 82, w: 32, h: 48, sink: 4 },
] as const;

const colX = (index: number) => SIDE + index * PITCH;
/** 第 height 格（1 = 最底下）岩块的上沿。 */
const cellY = (height: number) => TOP + ROW * (MAX_HEIGHT - height);
/** 32×32 的小人和路牌在 24 宽的岩块上居中；小人脚底对齐岩块底边。 */
const spriteX = (index: number) => colX(index) - (SPRITE - BLOCK) / 2;
const climberY = (height: number) => cellY(height) + ROW - SPRITE;

/** 营地帐篷（16×16）按座位错开在岩块的四个角，同一格最多 4 顶也能看见。 */
const CAMP_SLOTS = [
  { x: -3, y: -1 },
  { x: 11, y: -1 },
  { x: -3, y: 9 },
  { x: 11, y: 9 },
];

/** 岩块的样子按格子位置固定挑，免得每次渲染都换。 */
const rockOf = (column: number, height: number) => tileArt.rock[(column * 7 + height * 3) % tileArt.rock.length]!;
const snowOf = (column: number) => tileArt.snow[column % tileArt.snow.length]!;

/** 按容器宽度（宽屏再加上视口高度）算缩放，取 1/8 的整数倍，像素图放大后边缘更整齐。 */
function useBoardScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth;
      const wide = window.innerWidth >= 960;
      const byWidth = width / BOARD_W;
      const byHeight = wide ? (window.innerHeight - 104) / BOARD_H : Infinity;
      const next = Math.max(0.5, Math.floor(Math.min(byWidth, byHeight, 2.5) * 8) / 8);
      setScale(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return [ref, scale] as const;
}

export interface BustGhosts {
  readonly key: string;
  readonly color: number;
  readonly runners: readonly Runner[];
}

export interface Fresh {
  readonly key: string;
  readonly player: string;
  /** 刚扎营的赛道。 */
  readonly camps: readonly Column[];
  /** 刚登顶的赛道。 */
  readonly summits: readonly Column[];
}

interface MountainProps {
  readonly game: GameState;
  /** 鼠标停在某个推进选项上时，推进后的登山者位置。 */
  readonly preview: readonly Runner[] | null;
  readonly bust: BustGhosts | null;
  readonly fresh: Fresh | null;
  readonly nameOf: (playerId: string) => string;
}

function Mountain({ game, preview, bust, fresh, nameOf }: MountainProps) {
  const [ref, u] = useBoardScale();
  const px = (value: number) => value * u;
  const current = game.players[game.currentPlayer];
  const runnerColor = current?.color ?? 0;
  const ownerColor = (column: Column) => game.players.find((player) => player.id === game.owners[column])?.color;
  const previewColumns = new Set(preview?.map((runner) => runner.column) ?? []);
  const runnerColumns = new Set(game.runners.map((runner) => runner.column));

  const block = (left: number, top: number, extra: CSSProperties = {}): CSSProperties => ({
    left: px(left), top: px(top), width: px(BLOCK), height: px(BLOCK), ...extra,
  });

  return (
    <div className="cs-mountain" ref={ref}>
      <div className="cs-board" style={{ width: px(BOARD_W), height: px(BOARD_H), "--u": u } as CSSProperties}>
        {/* 山脚的地面（往两边延伸到舞台边缘），路牌立在上面；两侧是松树和营火，窄屏放不下就被裁掉 */}
        <span className="cs-ground" style={{ left: px(-400), top: px(GROUND), width: px(BOARD_W + 800), height: px(BASE) }} />
        {DECOR.map((item) => (
          <span
            key={item.key}
            className={`cs-decor ${item.key}`}
            style={{ left: px(item.x), top: px(GROUND - item.h + item.sink), width: px(item.w), height: px(item.h), backgroundImage: `url(${item.src})` }}
          />
        ))}
        {COLUMNS.map((column, index) => {
          const height = COLUMN_HEIGHTS[column];
          const owner = ownerColor(column);
          const left = colX(index);
          const lit = previewColumns.has(column) || runnerColumns.has(column);
          const standings = game.players
            .filter((player) => (player.progress[column] ?? 0) > 0)
            .map((player) => `${nameOf(player.id)} ${player.progress[column]}`)
            .join("，");
          const title = `${column} 号赛道 · ${height} 格`
            + (owner !== undefined ? ` · 已被${nameOf(game.owners[column]!)}占领` : standings ? ` · 营地：${standings}` : "");
          return (
            <div
              key={column}
              className={["cs-column", owner !== undefined ? "claimed" : "", lit ? "lit" : ""].join(" ")}
              style={{ "--seat": owner !== undefined ? seatOf(owner).hex : undefined } as CSSProperties}
              title={title}
            >
              {lit && <span className="cs-column-glow" style={block(left - 3, cellY(height) - 3, { width: px(BLOCK + 6), height: px(ROW * height + 6) })} />}
              {Array.from({ length: height }, (_, row) => {
                const level = row + 1;
                const summit = level === height;
                return (
                  <img
                    key={level}
                    className={summit ? "cs-block summit" : "cs-block"}
                    src={summit ? snowOf(column) : rockOf(column, level)}
                    alt=""
                    style={summit ? block(left - 1, cellY(level), { width: px(BLOCK + 2) }) : block(left, cellY(level))}
                  />
                );
              })}
              {owner !== undefined && (
                <>
                  <span className="cs-claim-tint" style={block(left, cellY(height), { height: px(ROW * height) })} />
                  <span
                    className={fresh?.summits.includes(column) ? "cs-summit-flag fresh" : "cs-summit-flag"}
                    key={fresh?.summits.includes(column) ? fresh.key : "flag"}
                    style={{
                      left: px(left - (SPRITE - BLOCK) / 2), top: px(cellY(height) - 48 + 6), width: px(32), height: px(48),
                      backgroundImage: `url(${summitWaveArt(owner)})`,
                    }}
                  />
                </>
              )}
              {owner === undefined && game.players.map((player) => {
                const level = player.progress[column] ?? 0;
                if (level === 0) return null;
                const slot = CAMP_SLOTS[player.color % CAMP_SLOTS.length]!;
                const planted = fresh?.player === player.id && fresh.camps.includes(column);
                return (
                  <img
                    key={`${player.id}-${planted ? fresh!.key : "camp"}`}
                    className={planted ? "cs-camp planted" : "cs-camp"}
                    src={campArt(player.color)}
                    alt=""
                    style={{ left: px(left + slot.x), top: px(cellY(level) + slot.y), width: px(16), height: px(16) }}
                  />
                );
              })}
              <span className="cs-sign" style={{ left: px(left - (SPRITE - BLOCK) / 2), top: px(GROUND + 2), width: px(SPRITE), height: px(SPRITE) }}>
                <img src={iconArt.sign} alt="" />
                <b>{column}</b>
              </span>
            </div>
          );
        })}

        {/* 本回合的登山者：按赛道作 key，往上爬时位置平滑过渡 */}
        {game.runners.map((runner) => {
          const index = COLUMNS.indexOf(runner.column);
          return (
            <Climber
              key={`runner-${runner.column}`}
              color={runnerColor}
              left={px(spriteX(index))}
              top={px(climberY(runner.height))}
              size={px(SPRITE)}
            />
          );
        })}

        {/* 预览：选这种推进后登山者会到哪里 */}
        {preview?.map((runner) => {
          const before = game.runners.find((entry) => entry.column === runner.column);
          if (before && before.height === runner.height) return null;
          const index = COLUMNS.indexOf(runner.column);
          return (
            <img
              key={`ghost-${runner.column}`}
              className="cs-climber ghost"
              src={climberArt(runnerColor)}
              alt=""
              style={{ left: px(spriteX(index)), top: px(climberY(runner.height)), width: px(SPRITE), height: px(SPRITE) }}
            />
          );
        })}

        {/* 爆掉：本回合的登山者手舞足蹈地摔下去 */}
        {bust?.runners.map((runner) => {
          const index = COLUMNS.indexOf(runner.column);
          return (
            <span
              key={`${bust.key}-${runner.column}`}
              className="cs-climber falling"
              style={{ left: px(spriteX(index)), top: px(climberY(runner.height)), width: px(SPRITE), height: px(SPRITE), backgroundImage: `url(${climberFallArt(bust.color)})` }}
            />
          );
        })}

        {/* 刚登顶：登山者在山顶跳起来欢呼，然后大旗升起 */}
        {fresh?.summits.map((column) => {
          const index = COLUMNS.indexOf(column);
          const owner = ownerColor(column);
          if (owner === undefined) return null;
          return (
            <span
              key={`${fresh.key}-cheer-${column}`}
              className="cs-climber cheering"
              style={{ left: px(spriteX(index)), top: px(climberY(COLUMN_HEIGHTS[column])), width: px(SPRITE), height: px(SPRITE), backgroundImage: `url(${climberCheerArt(owner)})` }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** 一个登山者：位置变化时播放攀爬动画，爬完停在最后一帧。 */
function Climber({ color, left, top, size }: { color: number; left: number; top: number; size: number }) {
  const [climbing, setClimbing] = useState(true);
  const [arriving, setArriving] = useState(true);
  const previous = useRef(top);
  useEffect(() => {
    if (previous.current === top) return;
    previous.current = top;
    setClimbing(true);
    const timer = window.setTimeout(() => setClimbing(false), 700);
    return () => window.clearTimeout(timer);
  }, [top]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setClimbing(false);
      setArriving(false);
    }, 700);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <span
      className={["cs-climber", "runner", climbing ? "climbing" : "", arriving ? "arriving" : ""].join(" ")}
      style={{
        left, top, width: size, height: size,
        backgroundImage: `url(${climbing ? climberClimbArt(color) : climberArt(color)})`,
      }}
    />
  );
}

export default Mountain;
