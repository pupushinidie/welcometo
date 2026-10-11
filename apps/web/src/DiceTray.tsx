import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  COLUMN_HEIGHTS,
  PAIRINGS,
  advanceRunners,
  bustProbability,
  type GameCommand,
  type GameState,
  type MoveOption,
  type Runner,
} from "@welcometo/game";
import { dieArt, iconArt, seatOf } from "./art.js";

/** 掷骰时骰子翻滚的时长（毫秒）；翻滚结束前不显示可选的推进方式。 */
export const ROLL_MS = 650;

const SHOW_ODDS_KEY = "cantstop-show-odds";

function readShowOdds(): boolean {
  try {
    return localStorage.getItem(SHOW_ODDS_KEY) !== "0";
  } catch {
    return true;
  }
}

function storeShowOdds(show: boolean): void {
  try {
    localStorage.setItem(SHOW_ODDS_KEY, show ? "1" : "0");
  } catch {
    // 存储不可用时只在本页有效
  }
}

/** 骰子翻滚：rollKey 变化时乱跳 ROLL_MS 毫秒，再停在真正的点数上。 */
function useTumble(dice: readonly number[] | undefined, rollKey: string | null): { faces: number[]; rolling: boolean } {
  const [rolling, setRolling] = useState(false);
  const [faces, setFaces] = useState<number[]>(() => [...(dice ?? [])]);
  useEffect(() => {
    if (!rollKey || !dice) {
      setFaces([...(dice ?? [])]);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setFaces([...dice]);
      return;
    }
    setRolling(true);
    const spin = window.setInterval(() => setFaces(dice.map(() => 1 + Math.floor(Math.random() * 6))), 70);
    const stop = window.setTimeout(() => {
      window.clearInterval(spin);
      setFaces([...dice]);
      setRolling(false);
    }, ROLL_MS);
    return () => {
      window.clearInterval(spin);
      window.clearTimeout(stop);
    };
  }, [rollKey]);
  useEffect(() => {
    if (!rolling && dice) setFaces([...dice]);
  }, [dice?.join(",")]);
  return { faces, rolling };
}

function optionLabel(option: MoveOption): string {
  const [first, second] = option.sums;
  if (second === undefined) return `只走 ${first}`;
  if (first === second) return `${first} 走两步`;
  return `走 ${first} 和 ${second}`;
}

interface DiceTrayProps {
  readonly game: GameState;
  readonly myTurn: boolean;
  readonly busy: boolean;
  /** 新的一次掷骰（version），用来触发翻滚动画。 */
  readonly rollKey: string | null;
  readonly onCommand: (command: GameCommand) => void;
  readonly onPreview: (runners: Runner[] | null) => void;
}

function DiceTray({ game, myTurn, busy, rollKey, onCommand, onPreview }: DiceTrayProps) {
  const roller = game.players.find((player) => player.id === game.lastRoll?.player);
  const current = game.players[game.currentPlayer]!;
  const { faces, rolling } = useTumble(game.lastRoll?.dice, rollKey);
  const [hovered, setHovered] = useState<number | null>(null);
  const [showOdds, setShowOdds] = useState(readShowOdds);
  useEffect(() => {
    setHovered(null);
    onPreview(null);
  }, [game.version]);

  const choosing = game.stage === "choose" && !rolling;
  const options = choosing ? game.options : [];
  const hoveredOption = hovered !== null ? options[hovered] : undefined;
  const pairing = hoveredOption ? PAIRINGS[hoveredOption.pairings[0]!] : undefined;
  // 没在看某个选项时，已经选过的那种分组也标出来
  const chosenPairing = !hoveredOption && game.lastRoll?.chosen && game.stage !== "choose"
    ? findPairing(game.lastRoll.dice, game.lastRoll.chosen)
    : undefined;
  const groups = pairing ?? chosenPairing;
  const odds = useMemo(() => (game.stage === "decide" ? bustProbability(game) : null), [game.version]);
  const atTop = game.runners.filter((runner) => runner.height >= COLUMN_HEIGHTS[runner.column]).map((runner) => runner.column);
  const winsIfStop = atTop.length > 0 && current.score + atTop.length >= game.config.columnsToWin;

  // 键盘：空格 / R 掷骰，S 收手，数字键选第几种走法（输入框里打字时不算）
  useEffect(() => {
    if (!myTurn) return;
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, [contenteditable]")) return;
      if (busy || rolling) return;
      const key = event.key.toLowerCase();
      // 焦点在按钮上时空格交给按钮自己，免得一次按键发两次
      if (key === " " && target?.closest("button")) return;
      if (game.stage !== "choose" && (key === " " || key === "r")) {
        event.preventDefault();
        onCommand({ type: "ROLL" });
      } else if (game.stage === "decide" && key === "s") {
        onCommand({ type: "STOP" });
      } else if (game.stage === "choose" && /^[1-9]$/.test(key)) {
        const option = game.options[Number(key) - 1];
        if (option) onCommand({ type: "CHOOSE", sums: [...option.sums] });
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [myTurn, busy, rolling, game.version]);

  function preview(index: number | null) {
    setHovered(index);
    const option = index !== null ? options[index] : undefined;
    onPreview(option ? advanceRunners(game, current, game.runners, option.sums) : null);
  }

  function toggleOdds() {
    setShowOdds((value) => {
      storeShowOdds(!value);
      return !value;
    });
  }

  const busted = game.lastRoll?.bust && !rolling;
  const seat = seatOf(roller?.color ?? current.color);

  return (
    <section className={["cs-panel", "cs-dice-tray", myTurn ? "mine" : ""].join(" ")} style={{ "--seat": seat.hex } as CSSProperties}>
      <div className="cs-dice-head">
        <h3>
          {game.lastRoll
            ? <>{roller ? (roller.id === current.id ? "" : "上一手 · ") : ""}<i className="cs-dot" style={{ background: seat.hex }} />{roller?.name ?? ""} 掷出</>
            : "骰子"}
        </h3>
        {game.rollsThisTurn > 0 && game.phase === "playing" && <small>本回合第 {game.rollsThisTurn} 掷</small>}
      </div>
      <div className={["cs-dice", rolling ? "rolling" : "", busted ? "busted" : ""].join(" ")} aria-live="polite">
        {(game.lastRoll ? faces : [1, 2, 3, 4]).map((face, index) => {
          const group = groups ? (groups[0].includes(index as never) ? "a" : "b") : "";
          return (
            <span key={index} className={["cs-die", game.lastRoll ? "" : "idle", group ? `pair-${group}` : ""].join(" ")}>
              <img src={dieArt(face)} alt={`${face} 点`} />
            </span>
          );
        })}
      </div>
      {busted && <p className="cs-bust-note"><img src={iconArt.rockfall} alt="" />怎么配都走不了，爆掉了！</p>}

      {myTurn && choosing && (
        <div className="cs-options" role="group" aria-label="选择推进方式" onMouseLeave={() => preview(null)}>
          {options.map((option, index) => (
            <button
              key={option.sums.join("+")}
              type="button"
              className={hovered === index ? "cs-option hovered" : "cs-option"}
              disabled={busy}
              onMouseEnter={() => preview(index)}
              onFocus={() => preview(index)}
              onBlur={() => preview(null)}
              onClick={() => onCommand({ type: "CHOOSE", sums: [...option.sums] })}
            >
              <OptionDice dice={game.lastRoll!.dice} option={option} />
              <strong>{optionLabel(option)}<kbd>{index + 1}</kbd></strong>
            </button>
          ))}
        </div>
      )}
      {myTurn && game.stage === "choose" && rolling && <p className="cs-muted">骰子还在滚…</p>}
      {!myTurn && game.phase === "playing" && (
        <p className="cs-muted cs-waiting">
          {rolling ? `${roller?.name ?? current.name} 掷骰中…`
            : game.stage === "choose" ? `${current.name} 正在挑走法…`
            : game.stage === "decide" ? `${current.name} 在想要不要再掷…`
            : `等 ${current.name} 掷骰…`}
        </p>
      )}

      {myTurn && game.stage !== "choose" && (
        <div className="cs-actions">
          <button className="primary-button cs-roll" type="button" disabled={busy || rolling} onClick={() => onCommand({ type: "ROLL" })}>
            <img src={iconArt.dice} alt="" />{game.stage === "roll" ? "掷骰" : "再掷"}<kbd>R</kbd>
          </button>
          {game.stage === "decide" && (
            <button className={winsIfStop ? "quiet-button cs-stop win" : "quiet-button cs-stop"} type="button" disabled={busy || rolling} onClick={() => onCommand({ type: "STOP" })}>
              <img src={iconArt.camp} alt="" />{winsIfStop ? "收手 · 获胜！" : "收手扎营"}<kbd>S</kbd>
            </button>
          )}
        </div>
      )}
      {myTurn && game.stage === "decide" && (
        <p className="cs-odds">
          {showOdds && odds !== null && (
            <span className={odds >= 0.4 ? "danger" : odds >= 0.2 ? "warn" : ""}>再掷爆掉的概率 {Math.round(odds * 100)}%</span>
          )}
          {atTop.length > 0 && <span className="cs-top-note">已到顶：{atTop.join("、")} 号，收手就能占领</span>}
          <button type="button" className="cs-link" onClick={toggleOdds}>{showOdds ? "隐藏概率" : "显示概率"}</button>
        </p>
      )}
      {myTurn && game.stage === "roll" && <p className="cs-muted">轮到你了：掷 4 颗骰子，两两分组决定往哪两条路爬。</p>}
    </section>
  );
}

/** 选项按钮里的小骰子：按配对分成两组，用不上的那组划掉。 */
function OptionDice({ dice, option }: { dice: readonly number[]; option: MoveOption }) {
  const [left, right] = PAIRINGS[option.pairings[0]!]!;
  const sumOf = (pair: readonly number[]) => dice[pair[0]!]! + dice[pair[1]!]!;
  const leftSum = sumOf(left);
  const rightSum = sumOf(right);
  // 只走一个时，标出没用上的那组
  const unused = option.sums.length === 1 ? (option.sums[0] === leftSum ? "right" : "left") : null;
  return (
    <span className="cs-option-dice" aria-hidden="true">
      <span className={unused === "left" ? "cs-pair a unused" : "cs-pair a"}>
        {left.map((index) => <img key={index} src={dieArt(dice[index]!)} alt="" />)}
        <em>{leftSum}</em>
      </span>
      <span className={unused === "right" ? "cs-pair b unused" : "cs-pair b"}>
        {right.map((index) => <img key={index} src={dieArt(dice[index]!)} alt="" />)}
        <em>{rightSum}</em>
      </span>
    </span>
  );
}

/** 已选的推进对应哪种配对（只用来在骰子上标颜色）。 */
function findPairing(dice: readonly number[], sums: readonly number[]) {
  return PAIRINGS.find(([a, b]) => {
    const first = dice[a[0]]! + dice[a[1]]!;
    const second = dice[b[0]]! + dice[b[1]]!;
    if (sums.length === 2) return (first === sums[0] && second === sums[1]) || (first === sums[1] && second === sums[0]);
    return first === sums[0] || second === sums[0];
  });
}

export default DiceTray;
