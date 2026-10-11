import { useEffect, useRef } from "react";
import type { GameState, Move } from "@welcometo/game";
import { sfx, synth } from "./gm-sound.js";

/**
 * 欢迎来到的动作音效（纸笔类）：对比前后两次对局状态，按 game.events 出声。
 * 自己的动作响亮，别人的减半；观战时都算别人的。第一次拿到状态（进房间、重连、观战刚进来）不出声，
 * 新开一局只响一声开局。大家同时选：别人交了只响一下轻的，结算时才响别人这一手的结果。
 *
 *   挑一组 / 选栅栏位 / 选改造列 / 勾选项   select（GameBoard 里点的时候响）
 *   在空地上写门牌号（草稿）              write
 *   确认提交                            盖章（招牌）          别人交了：draw（轻）
 *   撤回重选                            橡皮擦
 *   结算——自己这一手用的行动：
 *     栅栏 铅笔画一道直线（招牌）    公园 树叶沙沙 + place    泳池 水花（招牌）
 *     临时工 盖章                改造（地产）coin           bis 写两遍 write
 *     没用行动：write（门牌号落笔）；别人这回合的落笔合成一声 write
 *   完成规划目标   score（首批完成 sparkle）   拒绝建房（罚分）bust
 *   重洗牌堆 shuffle    新一回合翻 3 组 deal + yourTurn    超时代填（自己）timeout
 *   终局 reveal → 赢 / 输
 */

/** 开发时记下响了哪些声音（自测脚本读 window.__sfxLog）。 */
function cue(name: string, play: () => void, delayMs = 0) {
  const run = () => {
    if (import.meta.env.DEV) (window as unknown as { __sfxLog?: string[] }).__sfxLog?.push(name);
    play();
  };
  if (delayMs > 0) window.setTimeout(run, delayMs);
  else run();
}

/** 盖章：纸面上「啪」一下。 */
function stamp(v: number) {
  synth.noise({ duration: 0.06, volume: 0.32 * v, filter: "lowpass", freq: 1400 });
  synth.tone(150, { duration: 0.12, volume: 0.22 * v, glideTo: 90 });
  synth.noise({ at: 0.03, duration: 0.05, volume: 0.1 * v, freq: 3200, q: 1.5 });
}

/** 橡皮擦：来回蹭三下。 */
function eraser(v: number) {
  for (let i = 0; i < 3; i += 1) synth.noise({ at: i * 0.08, duration: 0.07, volume: 0.13 * v, freq: 1600 + i * 300, q: 1.2 });
}

/** 铅笔沿尺子画一道直线（栅栏）。 */
function pencilLine(v: number) {
  synth.noise({ duration: 0.04, volume: 0.14 * v, freq: 4200, q: 3 });
  synth.noise({ at: 0.03, duration: 0.3, volume: 0.13 * v, freq: 3400, freqTo: 3900, q: 4 });
  synth.tone(90, { at: 0.03, duration: 0.3, volume: 0.04 * v, type: "triangle" });
}

/** 公园：树叶沙沙。 */
function leaves(v: number) {
  for (let i = 0; i < 4; i += 1) synth.noise({ at: i * 0.05, duration: 0.12, volume: 0.09 * v, freq: 5200 - i * 400, q: 0.7 });
  synth.tone(784, { at: 0.12, duration: 0.15, volume: 0.06 * v, type: "triangle" });
}

/** 泳池：扑通一声 + 几个水泡往上冒。 */
function splash(v: number) {
  synth.noise({ duration: 0.3, volume: 0.24 * v, filter: "lowpass", freq: 2400, freqTo: 400 });
  synth.tone(320, { duration: 0.12, volume: 0.12 * v, glideTo: 120 });
  [0.12, 0.2, 0.27].forEach((at, i) => synth.tone(500 + i * 180, { at, duration: 0.07, volume: 0.08 * v, glideTo: 1100 + i * 250 }));
}

/** 一手用了哪个行动，响对应的声音。 */
function actionSound(move: Move, mine: boolean, at: number): number {
  const v = synth.level(mine);
  if (move.fence) cue("fence", () => pencilLine(v), at);
  else if (move.pool) cue("pool", () => splash(v), at);
  else if (move.park) cue("park", () => { leaves(v); sfx.place(mine); }, at);
  else if (move.improve !== undefined) cue("improve", () => sfx.coin(mine), at);
  else if (move.bis) cue("bis", () => { sfx.write(mine); window.setTimeout(() => sfx.write(mine), 160); }, at);
  else if (move.temp !== undefined) cue("temp", () => stamp(v * 0.8), at);
  else {
    cue("write", () => sfx.write(mine), at);
    return 200;
  }
  return 380;
}

/** GameBoard 里点选的确认音。 */
export const pick = {
  select: (on = true) => cue(on ? "select" : "unselect", () => sfx.select(on)),
  write: () => cue("write", () => sfx.write(true)),
  deny: () => cue("deny", () => sfx.deny()),
};

/**
 * myId：自己的玩家 id（观战传空字符串，所有动作都按别人的放）；auto：托管中（新回合不叫「轮到你」）。
 */
export function useGameSfx(game: GameState, myId: string, auto: boolean) {
  const previous = useRef<GameState | null>(null);
  useEffect(() => {
    const prev = previous.current;
    previous.current = game;
    if (!prev || prev === game || game.version === prev.version) return;
    if (game.version < prev.version || (prev.phase === "gameOver" && game.phase !== "gameOver")) {
      cue("gameStart", () => sfx.gameStart());
      return;
    }
    const isMe = (id: string) => myId !== "" && id === myId;
    // 一下跳了好几步（比如网络卡了一下）：只响结算 / 新回合，不补放中间每个人的提交。
    const jumped = game.version - prev.version > 2;
    let at = 0;
    let timedOutMe = false;
    let othersSubmitted = 0;

    for (const event of game.events) {
      switch (event.type) {
        case "TimedOut":
          if (event.players.some(isMe)) {
            timedOutMe = true;
            cue("timeout", () => sfx.timeout(), at);
            at += 400;
          }
          break;
        case "Submitted":
          if (jumped) break;
          if (isMe(event.player)) {
            if (!timedOutMe) cue("submit", () => stamp(1), at);
            at += 200;
          } else othersSubmitted += 1;
          break;
        case "Retracted":
          if (jumped) break;
          cue("erase", () => eraser(synth.level(isMe(event.player))), at);
          at += 250;
          break;
        case "RoundResolved": {
          const plays = game.lastRound?.plays ?? {};
          const myPlay = myId ? plays[myId] : undefined;
          at += 200;
          if (myPlay?.submission.move) at += actionSound(myPlay.submission.move, true, at);
          const others = Object.entries(plays).filter(([id, play]) => !isMe(id) && play.submission.move);
          if (others.length > 0) {
            cue("write", () => sfx.write(false), at);
            at += 200;
          }
          break;
        }
        case "PlanApproved":
          if (event.players.some(isMe)) {
            cue("sparkle", () => sfx.sparkle(true), at);
            at += 450;
          }
          break;
        case "PlanClaimed": {
          const mine = isMe(event.player);
          cue("score", () => sfx.score(mine, mine), at);
          at += mine ? 350 : 150;
          break;
        }
        case "Refused": {
          const mine = isMe(event.player);
          cue("bust", () => sfx.bust(mine), at);
          at += mine ? 450 : 200;
          break;
        }
        case "Reshuffled":
          cue("shuffle", () => sfx.shuffle(), at + 100);
          at += 450;
          break;
        case "RoundStarted":
          at += 150;
          cue("deal", () => sfx.deal(3), at);
          if (myId && !auto) cue("yourTurn", () => sfx.yourTurn(), at + 350);
          at += 600;
          break;
        case "GameEnded": {
          const won = myId !== "" && event.winners.includes(myId);
          cue("reveal", () => sfx.reveal(true), at + 200);
          cue(won ? "win" : "lose", () => sfx.gameOver(won), at + 750);
          at += 750;
          break;
        }
      }
    }
    // 别人交了（同一时刻几个人只响一下，内容要结算后才知道）
    if (othersSubmitted > 0) cue("othersSubmit", () => sfx.draw(false, 1));
  }, [game, myId]);
}
