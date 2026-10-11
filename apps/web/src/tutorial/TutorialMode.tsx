/**
 * 欢迎来到的新手教程：在浏览器里按剧本（packages/game/src/tutorial.ts）走前 6 回合，
 * 牌桌就是真正对局的 GameBoard，咕噜嘎的对话框叠在上面；剧本走完接着把这局打完（练习局），两个咕噜交给人机。
 * do 步骤是交一整手：按草稿算出下一个要点的地方（选组 → 改号码 → 空地 → 行动 → 确认提交），高亮跟着挪，别的点击不理。
 * 不连服务器，不占房间；首页、等候房间都能进来（从等候房间进来时，房主开局会自动回到牌桌，见 App.tsx）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  anchorCandidates,
  apply,
  botCommand,
  botHint,
  createPracticeGame,
  createRng,
  createTutorialGame,
  DEFAULT_ROOM_ACCESS,
  redactGameForViewer,
  sameMove,
  selfCanAct,
  stageAllows,
  stageAnchor,
  stageOf,
  TUTORIAL_BOTS,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Move,
  type Rng,
  type TutorialMove,
  type TutorialStep,
} from "@welcometo/game";
import GameBoard, { EMPTY_DRAFT, type Draft } from "../GameBoard.js";
import { Coach, isTouchDevice, StepPips, type CoachView } from "./Coach.js";
import { writeTutorial } from "./storage.js";
import { GAME_ID } from "./tutorialGame.js";
import { useTutorial, WRONG_STEP } from "./useTutorial.js";
import "./tutorial-welcometo.css";

const SELF_MEMBER = "tutorial-self";
const TUTORIAL_CODE = "GULU01";
const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

/** 每一课（带 lesson 的步骤）从第几步开始。 */
const LESSONS = TUTORIAL_STEPS.map((step, at) => ({ step, at })).filter(({ step }) => step.lesson);

function visible(anchor: string): boolean {
  const element = document.querySelector(`[data-tutorial="${anchor}"]`);
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function expectedMove(step: TutorialStep | undefined): Move | null {
  if (!step || step.kind !== "do" || step.expect.command.type !== "submit") return null;
  return step.expect.command.submission.move;
}

/** info / watch 步骤的锚点：按顺序挑页面上看得见的第一个；换了一步、还没找到之前返回 undefined。 */
function useInfoAnchor(step: TutorialStep | undefined, version: number): string | null | undefined {
  const [found, setFound] = useState<{ id: string; anchor: string | null } | null>(null);
  useEffect(() => {
    if (!step || step.kind === "do") return;
    const candidates = anchorCandidates(step);
    if (candidates.length === 0) {
      setFound({ id: step.id, anchor: null });
      return;
    }
    const resolve = () => {
      const next = candidates.find(visible) ?? candidates[0]!;
      setFound((old) => (old && old.id === step.id && old.anchor === next ? old : { id: step.id, anchor: next }));
    };
    resolve();
    const timer = window.setInterval(resolve, 150);
    return () => window.clearInterval(timer);
  }, [step?.id, version]);
  if (!step) return null;
  return found && found.id === step.id ? found.anchor : undefined;
}

export default function TutorialMode({ name, brand, themeToggle, theme, waitingRoom, onExit }: {
  name: string;
  brand: ReactNode;
  themeToggle: ReactNode;
  theme: "day" | "night";
  waitingRoom?: string | undefined;
  onExit: () => void;
}) {
  const selfName = name.trim().length >= 2 ? name.trim() : "新玩家";
  // 剧本 6 回合翻的牌是摆好的；第 7 回合起（练习局）牌堆照常，重洗用它
  const rng = useRef<Rng | null>(null);
  if (!rng.current) rng.current = createRng(randomSeed());

  const tutorial = useTutorial<GameState, TutorialMove, TutorialStep>({
    steps: TUTORIAL_STEPS,
    self: TUTORIAL_SELF,
    start: () => createTutorialGame(selfName),
    restart: () => {
      const seed = randomSeed();
      rng.current = createRng(seed);
      return createPracticeGame(selfName, seed);
    },
    apply: (state, _playerId, move) => apply(state, move.player, move.command, rng.current!).state,
    same: sameMove,
    actor: (state) => tutorialActor(state),
    canAct: (state) => selfCanAct(state),
    bot: (state, playerId) => {
      const submission = botCommand(redactGameForViewer(state, playerId), playerId);
      return submission ? { player: playerId, command: { type: "submit", submission } } : null;
    },
    // 人机一个接一个交，留点时间让人看见「已交」；刚结算完多等一会儿，让房子落下的动画放完
    botDelay: (state) => (state.events.some((event) => event.type === "RoundResolved") ? 1800 : 900),
    watchDelay: () => 900,
  });
  const { game, step, index, practice, flash } = tutorial;

  // 走到最后一步就算学完（之后首页不再邀请）
  useEffect(() => {
    if (practice || (step?.kind === "info" && step.finale)) writeTutorial(GAME_ID, "done");
  }, [practice, step?.id]);

  function leave() {
    writeTutorial(GAME_ID, "skipped");
    onExit();
  }

  // do 步骤：按草稿算出走到哪一阶段
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const onDraft = useCallback((next: Draft) => setDraft(next), []);
  const expect = expectedMove(step);
  const me = game.players.find((player) => player.id === TUTORIAL_SELF)!;
  const stage = expect && !me.submitted ? stageOf(expect, draft) : null;
  const doAnchor = expect && stage ? stageAnchor(expect, stage) : null;
  const infoAnchor = useInfoAnchor(step, game.version);
  const anchor = step?.kind === "do" ? doAnchor : infoAnchor;

  const [wrong, setWrong] = useState("");
  useEffect(() => {
    if (!wrong) return;
    const timer = window.setTimeout(() => setWrong(""), 2600);
    return () => window.clearTimeout(timer);
  }, [wrong]);
  const allow = (what: string): boolean => {
    if (practice) return true;
    if (expect && stage && stageAllows(expect, stage, what)) return true;
    // 已经点对的那一组再点一次不算错
    if (expect && stage && what === `combo:${expect.combo}`) return true;
    setWrong(WRONG_STEP);
    return false;
  };

  const members = useMemo<LobbyMember[]>(() => [
    { id: SELF_MEMBER, playerId: TUTORIAL_SELF, name: selfName, isHost: false, connected: true },
    ...TUTORIAL_BOTS.map((bot) => ({ id: `tutorial-${bot.id}`, playerId: bot.id, name: bot.name, isHost: false, connected: true, bot: true })),
  ], [selfName]);
  const room = useMemo<LobbyRoomSnapshot>(() => ({
    code: TUTORIAL_CODE,
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    capacity: 3,
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: redactGameForViewer(game, TUTORIAL_SELF),
  }), [game, members]);

  let view: CoachView | null = null;
  if (step && anchor !== undefined) {
    const stageNote = step.kind === "do" && stage ? step.stages?.[stage] : undefined;
    const note = stageNote ?? (isTouchDevice() && step.noteTouch ? step.noteTouch : step.note);
    const finale = step.kind === "info" && step.finale === true;
    const lessonNow = Math.max(0, LESSONS.filter(({ at }) => at <= index).length - 1);
    const shownFlash = flash || wrong;
    view = {
      key: step.id,
      say: step.say,
      ...(note ? { note } : {}),
      ...(shownFlash ? { flash: shownFlash } : {}),
      anchor,
      focus: step.kind !== "watch",
      face: shownFlash ? "surprised" : step.face ?? "base",
      footer: (
        <>
          <StepPips index={lessonNow} total={LESSONS.length} />
          {!finale && <button className="tut-link" type="button" data-tutorial="skip" onClick={leave}>跳过教程</button>}
        </>
      ),
      actions: step.kind !== "info" ? null : finale ? (
        <>
          <button className="quiet-button" type="button" data-tutorial="end" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" data-tutorial="practice" onClick={tutorial.startPractice}>和人机打完这局</button>
        </>
      ) : (
        <button className="primary-button tut-main" type="button" data-tutorial="next" onClick={tutorial.next}>下一步 ▶</button>
      ),
    };
  }

  const onCommand = (command: GameCommand) => tutorial.onCommand({ player: TUTORIAL_SELF, command });

  return (
    <div className={practice ? "tut-practice" : "tut-script"} style={{ display: "contents" }}>
      <GameBoard
        room={room}
        busy={false}
        error=""
        notice=""
        brand={brand}
        connection={
          <>
            <span className="connection-status online wt-tut-tag"><span className="connection-dot" />{practice ? "练习局" : "新手教程"}</span>
            <button className="quiet-button" type="button" data-tutorial="exit" onClick={practice ? onExit : leave}>退出教程</button>
          </>
        }
        themeToggle={themeToggle}
        theme={theme}
        chat={<Checklist index={index} practice={practice} waitingRoom={waitingRoom} />}
        onCommand={onCommand}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={TUTORIAL_SELF}
        onWatch={() => undefined}
        onLeave={onExit}
        selfMemberId={SELF_MEMBER}
        mode={practice ? "practice" : "tutorial"}
        allow={allow}
        onDraft={onDraft}
        onHint={() => botHint(redactGameForViewer(game, TUTORIAL_SELF), TUTORIAL_SELF)}
        finalActions={
          <>
            <button className="quiet-button" type="button" data-tutorial="end" onClick={onExit}>结束教程</button>
            <button className="primary-button wt-big" type="button" data-tutorial="again" onClick={tutorial.newPractice}>再练一局</button>
          </>
        }
      />
      {view && <Coach view={view} />}
    </div>
  );
}

/** 聊天的位置（手机上在下面）：剧本进行中列出这次学哪几样；练习局只留一句话。 */
function Checklist({ index, practice, waitingRoom }: { index: number; practice: boolean; waitingRoom: string | undefined }) {
  const done = LESSONS.filter((_, order) => (LESSONS[order + 1]?.at ?? TUTORIAL_STEPS.length) <= index).length;
  return (
    <section className="room-panel tut-checklist" aria-label="新手教程进度">
      {practice ? (
        <>
          <h3>练习局</h3>
          <p>拿不准就点「提示」，咕噜嘎告诉你它会怎么填。</p>
        </>
      ) : (
        <>
          <h3>新手教程 <small>{done}/{LESSONS.length}</small></h3>
          <ul>
            {LESSONS.map(({ step, at }, order) => {
              const next = LESSONS[order + 1]?.at ?? TUTORIAL_STEPS.length;
              const state = next <= index ? "done" : at <= index ? "now" : "";
              return (
                <li key={step.id} className={state}>
                  <i aria-hidden="true">{state === "done" ? "✓" : state === "now" ? "▶" : "·"}</i>
                  {step.lesson}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {waitingRoom && <p>你还在房间 {waitingRoom} 里，房主一开局就自动回到牌桌。</p>}
    </section>
  );
}
