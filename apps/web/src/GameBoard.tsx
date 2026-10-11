/**
 * 牌桌。桌面：左边 目标卡 / 我的表（或正在看的别人的表）/ 计分区 / 玩家条，右边 倒计时 / 3 组建造牌 / 一步步的操作。
 * 手机：一列，第一屏是提示 + 3 组 + 操作 + 我的表。布局见 layout.ts。
 * 教程锚点 data-tutorial 的清单写在交接报告里，改名前先告诉教程。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  PARK_TRACKS,
  POOL_TRACK,
  applyMove,
  canImprove,
  canPark,
  canUseBis,
  claimablePlans,
  comboNumbers,
  isPoolSlot,
  legalBis,
  legalFences,
  legalHouses,
  mustRefuse,
  resolveSubmission,
  scoreAll,
  stepKey,
  waitingFor,
  type Combo,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Move,
  type Player,
  type Sheet,
  type Submission,
} from "@welcometo/game";
import { sceneFor, seatColor, seatInk } from "./art.js";
import { ComboCard, PlanCard } from "./Cards.js";
import GameRules from "./GameRules.js";
import { pickLayout, type BoardLayout } from "./layout.js";
import { GameRoomMenu } from "./RoomExtras.js";
import { ScoreStrip } from "./ScoreStrip.js";
import { SheetView, type SheetTargets } from "./Sheet.js";
import { socket } from "./socket.js";

export interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly themeToggle: ReactNode;
  readonly theme: "day" | "night";
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时看谁的表。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  readonly onLeave: () => void;
  /** 自己在 room.members 里的 id；默认 socket.id（教程、预览页传固定值）。 */
  readonly selfMemberId?: string;
  /** online 真实对局；tutorial 教程剧本；practice 练习局（有「提示」）。 */
  readonly mode?: "online" | "tutorial" | "practice";
  /** 「提示」：给出人机的建议（练习局、只有自己和人机的房间）。 */
  readonly onHint?: () => { submission: Submission; reason: string } | null;
  /** 终局弹窗里替代「再来一局」的按钮（练习局）。 */
  readonly finalActions?: ReactNode;
  /** 预览页、教程：一开始的草稿（选了哪组、填在哪）。 */
  readonly initialDraft?: Partial<Draft>;
  /** 教程：限制能点的东西（返回 false 的点击被忽略）。 */
  readonly allow?: (what: string) => boolean;
  /** 教程：草稿变了告诉外面。 */
  readonly onDraft?: (draft: Draft) => void;
  /** 教程层（叠在牌桌上）。 */
  readonly overlay?: ReactNode;
}

/** 这一手的草稿。 */
export interface Draft {
  combo: number | null;
  /** 临时工调整：null = 不雇。 */
  temp: number | null;
  spot: { street: number; house: number } | null;
  fence: { street: number; pos: number } | null;
  improve: number | null;
  park: boolean;
  pool: boolean;
  bis: { street: number; house: number; from: -1 | 1 } | null;
  /** 不验证的目标卡（默认能验证的都验证）。 */
  skipPlans: number[];
  reshuffle: boolean;
}

export const EMPTY_DRAFT: Draft = { combo: null, temp: null, spot: null, fence: null, improve: null, park: true, pool: true, bis: null, skipPlans: [], reshuffle: false };
const STREET_NAMES = ["第 1 条街", "第 2 条街", "第 3 条街"];

function useViewport(): { w: number; h: number } {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = () => setSize(read());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

/** 草稿 → 这一手（不完整返回 null）。 */
function draftMove(draft: Draft, combos: readonly Combo[], placed: Sheet | null): Move | null {
  if (draft.combo === null || !draft.spot) return null;
  const combo = combos[draft.combo]!;
  const base: Move = { combo: draft.combo, street: draft.spot.street, house: draft.spot.house, ...(draft.temp !== null && combo.action === "temp" ? { temp: draft.temp } : {}) };
  if (!placed) return base;
  switch (combo.action) {
    case "fence":
      return draft.fence ? { ...base, fence: draft.fence } : base;
    case "improve":
      return draft.improve !== null ? { ...base, improve: draft.improve } : base;
    case "park":
      return draft.park && canPark(placed, base.street) ? { ...base, park: true } : base;
    case "pool":
      return draft.pool && isPoolSlot(base.street, base.house) ? { ...base, pool: true } : base;
    case "bis":
      return draft.bis ? { ...base, bis: draft.bis } : base;
    default:
      return base;
  }
}

export function describeMove(combos: readonly Combo[], submission: Submission): string {
  if (!submission.move) return `拒批${submission.plans?.length ? `，验证目标卡 ${submission.plans.map((p) => `n°${p + 1}`).join("、")}` : ""}`;
  const move = submission.move;
  const combo = combos[move.combo];
  if (!combo) return "交了一手";
  const num = combo.num + (move.temp ?? 0);
  const parts = [`把 ${num} 写在${STREET_NAMES[move.street]}第 ${move.house + 1} 格`];
  if (move.temp !== undefined) parts.push(`雇临时工（${move.temp > 0 ? "+" : ""}${move.temp}）`);
  if (move.fence) parts.push(`在${STREET_NAMES[move.fence.street]}画栅栏`);
  if (move.improve) parts.push(`改造 ${move.improve} 房小区`);
  if (move.park) parts.push("建公园");
  if (move.pool) parts.push("建泳池");
  if (move.bis) parts.push("bis 复制");
  if (submission.plans?.length) parts.push(`验证 ${submission.plans.map((p) => `n°${p + 1}`).join("、")}`);
  return parts.join("，");
}

function GameBoard(props: GameBoardProps) {
  const { room, busy, error, notice, brand, connection, themeToggle, theme, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave } = props;
  const mode = props.mode ?? "online";
  const allow = props.allow ?? (() => true);
  const game = room.game!;
  const viewport = useViewport();
  const layout: BoardLayout = pickLayout(viewport.w, viewport.h);
  const selfMember = props.selfMemberId ?? socket.id;
  const member = room.members.find((candidate) => candidate.id === selfMember);
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const me = game.players.find((player) => player.id === myId) ?? game.players[0]!;
  const autoPlaying = member?.auto === true;
  const secondsLeft = useCountdown(room);
  const scores = useMemo(() => scoreAll(game), [game]);
  const [viewId, setViewId] = useState<string | null>(null);
  const viewed = game.players.find((player) => player.id === viewId) ?? me;
  const viewingOther = viewed.id !== me.id;
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT, ...props.initialDraft });
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const onDraft = props.onDraft;
  useEffect(() => onDraft?.(draft), [draft, onDraft]);

  // 换回合：草稿清空；撤回时把交的那一手恢复成草稿
  const roundRef = useRef(game.round);
  useEffect(() => {
    if (roundRef.current !== game.round) {
      roundRef.current = game.round;
      setDraft({ ...EMPTY_DRAFT });
      setHint(null);
    }
  }, [game.round]);
  const pendingRef = useRef<Submission | null>(me.pending);
  useEffect(() => {
    const before = pendingRef.current;
    pendingRef.current = me.pending;
    if (before && !me.pending && !me.submitted && game.phase === "play") setDraft(draftFromSubmission(before, game));
  }, [me.pending, me.submitted]);

  // 结算提示：首批验证、拒批、重洗（按 version 记，5 秒后消失；计时器表只在卸载时清空）
  const [flash, setFlash] = useState<{ version: number; text: string } | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const versionRef = useRef(game.version);
  useEffect(() => {
    if (versionRef.current === game.version) return;
    versionRef.current = game.version;
    const texts: string[] = [];
    const nameOf = (id: string) => (id === me.id && !spectating ? "你" : game.players.find((player) => player.id === id)?.name ?? id);
    for (const event of game.events) {
      if (event.type === "PlanApproved") texts.push(`${event.players.map(nameOf).join("、")} 首批完成目标卡 n°${event.plan + 1}！`);
      if (event.type === "Refused") texts.push(`${nameOf(event.player)} 拒批（第 ${event.count} 次）`);
      if (event.type === "Reshuffled" && event.reason === "plan") texts.push(`${event.by.map(nameOf).join("、")} 选了重洗：81 张牌重新洗成 3 堆`);
      if (event.type === "Reshuffled" && event.reason === "exhausted") texts.push("有一堆翻完了，洗成新堆");
    }
    if (texts.length === 0) return;
    const version = game.version;
    setFlash({ version, text: texts.join("　") });
    timers.current.push(window.setTimeout(() => setFlash((current) => (current?.version === version ? null : current)), 5000));
  }, [game.version]);

  const playing = game.phase === "play";
  const canAct = playing && !spectating && !autoPlaying && !me.submitted && !viewingOther;
  const sheet = me.sheet;
  const refuse = playing && mustRefuse(sheet, game.combos);

  // 每组能放几处（含临时工调整）
  const places = useMemo(() => game.combos.map((combo) => {
    const spots = new Set<string>();
    for (const option of comboNumbers(sheet, combo)) for (const spot of legalHouses(sheet, option.num)) spots.add(`${spot.street}:${spot.house}`);
    return spots.size;
  }), [game.combos, sheet]);

  const combo = draft.combo !== null ? game.combos[draft.combo] ?? null : null;
  const tempOk = combo?.action === "temp" && comboNumbers(sheet, combo).length > 1;
  const num = combo ? combo.num + (tempOk && draft.temp !== null ? draft.temp : 0) : null;
  const legalSpots = useMemo(() => (num !== null ? new Set(legalHouses(sheet, num).map((spot) => `${spot.street}:${spot.house}`)) : null), [sheet, num]);
  const placed = useMemo(() => {
    if (!combo || !draft.spot || draft.combo === null) return null;
    try {
      return applyMove(sheet, { combo: draft.combo, street: draft.spot.street, house: draft.spot.house, ...(tempOk && draft.temp !== null ? { temp: draft.temp } : {}) }, combo, game.round).sheet;
    } catch {
      return null;
    }
  }, [sheet, combo, draft.combo, draft.spot, draft.temp, tempOk, game.round]);
  const move = draftMove({ ...draft, temp: tempOk ? draft.temp : null }, game.combos, placed);
  const preview = useMemo(() => {
    if (!canAct) return null;
    if (!refuse && (!move || !placed)) return null;
    const base: Submission = { move: refuse ? null : move };
    try {
      const after = resolveSubmission(sheet, base, game.combos, game.plans, game.round).sheet;
      const claimable = claimablePlans(after, game.plans);
      const plans = claimable.filter((index) => !draft.skipPlans.includes(index));
      const submission: Submission = { ...base, ...(plans.length ? { plans } : {}), ...(plans.length && draft.reshuffle ? { reshuffle: true } : {}) };
      const full = resolveSubmission(sheet, submission, game.combos, game.plans, game.round).sheet;
      return { submission, sheet: full, claimable };
    } catch {
      return null;
    }
  }, [canAct, refuse, move, placed, sheet, game.combos, game.plans, game.round, draft.skipPlans, draft.reshuffle]);

  // 行动能点的地方
  const fenceTargets = useMemo(() => (canAct && combo?.action === "fence" && placed ? new Set(legalFences(placed).map((f) => `${f.street}:${f.pos}`)) : null), [canAct, combo, placed]);
  const bisList = useMemo(() => (canAct && combo?.action === "bis" && placed && canUseBis(placed) ? legalBis(placed) : []), [canAct, combo, placed]);
  const bisTargets = useMemo(() => (bisList.length ? new Set(bisList.map((b) => `${b.street}:${b.house}`)) : null), [bisList]);
  const improvable = useMemo(() => (canAct && combo?.action === "improve" && placed ? new Set([1, 2, 3, 4, 5, 6].filter((size) => canImprove(placed, size))) : null), [canAct, combo, placed]);

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setHint(null);
  }
  function pickCombo(index: number) {
    if (!canAct || !allow(`combo:${index}`)) return;
    if (draft.combo === index) return;
    update({ ...EMPTY_DRAFT, combo: index });
  }
  function pickSpot(street: number, house: number) {
    if (!canAct || !allow(`house:${street}:${house}`)) return;
    update({ spot: { street, house }, fence: null, improve: null, bis: null, skipPlans: [] });
  }
  function pickFence(street: number, pos: number) {
    if (!canAct || !allow(`fence:${street}:${pos}`)) return;
    const same = draft.fence?.street === street && draft.fence.pos === pos;
    update({ fence: same ? null : { street, pos } });
  }
  function pickBis(street: number, house: number) {
    if (!canAct || !allow(`bis:${street}:${house}`)) return;
    const options = bisList.filter((b) => b.street === street && b.house === house);
    if (draft.bis && draft.bis.street === street && draft.bis.house === house) {
      const other = options.find((b) => b.from !== draft.bis!.from);
      update({ bis: other ?? null });
      return;
    }
    update({ bis: options[0] ?? null });
  }
  function pickImprove(size: number) {
    if (!canAct || !allow(`improve:${size}`)) return;
    update({ improve: draft.improve === size ? null : size });
  }
  function reset() {
    if (!allow("reset")) return;
    update({ ...EMPTY_DRAFT });
  }
  function submit() {
    if (!preview || busy || !allow("submit")) return;
    onCommand({ type: "submit", submission: preview.submission, step: stepKey(game) });
  }
  function retract() {
    if (!allow("retract")) return;
    onCommand({ type: "retract", step: stepKey(game) });
  }
  function askHint() {
    const result = props.onHint?.();
    if (!result) return;
    setDraft(draftFromSubmission(result.submission, game));
    setHint(result.reason);
  }
  const keyRef = useRef({ reset, submit, canAct, preview });
  keyRef.current = { reset, submit, canAct, preview };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") keyRef.current.reset();
      if (event.key === "Enter" && keyRef.current.preview && keyRef.current.canAct) keyRef.current.submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 页面在后台时标题提示
  useEffect(() => {
    const base = "欢迎来到 · 在线对战";
    const update = () => { document.title = canAct && document.hidden ? `【该你选了】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [canAct]);

  const waiting = waitingFor(game);
  const memberOf = (player: Player): LobbyMember | undefined => room.members.find((candidate) => candidate.playerId === player.id);
  const botsOnly = !spectating && room.members.length > 1 && room.members.every((candidate) => candidate.id === member?.id || candidate.bot === true);
  const showHint = !!props.onHint && (mode === "practice" || (mode === "online" && botsOnly));
  const urgent = secondsLeft !== null && secondsLeft <= 10 && canAct;

  let prompt: string;
  if (game.phase === "gameOver") prompt = "游戏结束";
  else if (spectating) prompt = `观战：看 ${viewed.name} 的表`;
  else if (autoPlaying) prompt = "托管中";
  else if (me.submitted) prompt = waiting.length ? `已提交，等 ${waiting.length} 人` : "结算中";
  else if (refuse) prompt = "只能拒批";
  else if (draft.combo === null) prompt = "选一组";
  else if (!draft.spot) prompt = "点亮着的空地";
  else prompt = "可以提交了";

  const timer = playing && secondsLeft !== null && (
    <span className={`wt-timer${urgent ? " urgent" : ""}`} role="timer" aria-label={`本回合还剩 ${secondsLeft} 秒`} data-tutorial="timer">{secondsLeft}<small>秒</small></span>
  );

  const combos = playing && (
    <div className="wt-combos" data-tutorial="combos">
      {game.combos.map((item, index) => (
        <ComboCard
          key={index}
          combo={item}
          index={index}
          scale={layout.cs}
          selected={draft.combo === index && canAct}
          unusable={places[index] === 0 && !spectating}
          {...(layout.mode === "desk" ? { places: places[index]! } : {})}
          {...(draft.combo === index && num !== null && canAct ? { shownNum: num } : {})}
          {...(canAct && places[index]! > 0 ? { onClick: () => pickCombo(index) } : {})}
        />
      ))}
    </div>
  );

  function actionGuide(): string {
    if (!combo || !draft.spot) return "";
    switch (combo.action) {
      case "fence": return fenceTargets?.size ? "可以再点两房之间的虚线画一道栅栏（任意一条街都行，再点取消）。" : "现在没有能画栅栏的地方。";
      case "improve": return improvable?.size ? "可以再点计分区里的一列小区，让那个尺寸的小区更值钱。" : "改造的列都勾满了。";
      case "park": return placed && canPark(placed, draft.spot.street) ? "" : "这条街的公园已经建满了。";
      case "pool": return isPoolSlot(draft.spot.street, draft.spot.house) ? "" : "这格没有泳池，泳池行动用不上（写进带泳池的房子才能建）。";
      case "bis": return bisTargets?.size ? "可以再点一块亮着的空地，把旁边的号码复制过去（bis 会扣分；再点换一边或取消）。" : "现在没有能 bis 的空地。";
      case "temp": return "";
    }
  }
  function actionControls(): ReactNode {
    if (!combo || !draft.spot || !placed) return null;
    if (combo.action === "park" && canPark(placed, draft.spot.street)) {
      const street = draft.spot.street;
      const next = PARK_TRACKS[street]![placed.parks[street]! + 1]!;
      return (
        <label className="wt-check" data-tutorial="action-toggle">
          <input type="checkbox" checked={draft.park} onChange={(event) => update({ park: event.target.checked })} />
          在{STREET_NAMES[street]}建一个公园（公园到 {next} 分）
        </label>
      );
    }
    if (combo.action === "pool" && isPoolSlot(draft.spot.street, draft.spot.house)) {
      return (
        <label className="wt-check" data-tutorial="action-toggle">
          <input type="checkbox" checked={draft.pool} onChange={(event) => update({ pool: event.target.checked })} />
          建泳池（泳池到 {POOL_TRACK[placed.poolTrack + 1]} 分）
        </label>
      );
    }
    return null;
  }
  function planChoices(): ReactNode {
    if (!preview || preview.claimable.length === 0) return null;
    const firstAvailable = preview.claimable.some((index) => game.plans[index]!.approvedRound === null && !draft.skipPlans.includes(index));
    return (
      <div className="wt-plan-choices" data-tutorial="plan-claim">
        {preview.claimable.map((index) => {
          const plan = game.plans[index]!;
          const value = plan.approvedRound === null ? plan.high : plan.low;
          return (
            <label className="wt-check" key={index}>
              <input type="checkbox" checked={!draft.skipPlans.includes(index)} onChange={(event) => update({ skipPlans: event.target.checked ? draft.skipPlans.filter((p) => p !== index) : [...draft.skipPlans, index] })} />
              验证目标卡 n°{index + 1}（+{value} 分{plan.approvedRound === null ? "，首批" : ""}）
            </label>
          );
        })}
        {firstAvailable && (
          <label className="wt-check small" data-tutorial="reshuffle">
            <input type="checkbox" checked={draft.reshuffle} onChange={(event) => update({ reshuffle: event.target.checked })} />
            如果我首个完成目标卡，就把牌全部重洗
          </label>
        )}
      </div>
    );
  }

  let panelBody: ReactNode;
  if (game.phase === "gameOver") {
    panelBody = <p className="wt-step">游戏结束，看结算。</p>;
  } else if (spectating) {
    panelBody = (
      <div className="wt-spectate">
        <p className="wt-step">你在观战。别人这回合交了什么，结算后才看得到。</p>
        <label className="wt-select">看谁的表
          <select value={viewed.id} onChange={(event) => { setViewId(event.target.value); onWatch(event.target.value); }}>
            {game.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
          </select>
        </label>
      </div>
    );
  } else if (autoPlaying) {
    panelBody = (
      <div className="wt-autobox" role="status">
        <p className="wt-step">托管中：人机正在替你填表。</p>
        <button className="primary-button wt-big" type="button" onClick={() => onAuto(false)} data-tutorial="cancel-auto">取消托管</button>
      </div>
    );
  } else if (me.submitted) {
    panelBody = (
      <div className="wt-submitted" data-tutorial="submitted">
        <p className="wt-step"><b>已提交</b>{me.pending ? `：${describeMove(game.combos, me.pending)}` : ""}</p>
        <p className="wt-sub">{waiting.length ? `还在想：${waiting.map((id) => game.players.find((player) => player.id === id)?.name).join("、")}` : "大家都交了，正在结算"}</p>
        <button className="quiet-button wt-mid-button" type="button" onClick={retract} disabled={busy} data-tutorial="retract">撤回重选</button>
      </div>
    );
  } else if (viewingOther) {
    panelBody = (
      <div className="wt-steps">
        <p className="wt-step">正在看 {viewed.name} 的表。</p>
        <button className="primary-button wt-big" type="button" onClick={() => setViewId(null)}>回到我的表</button>
      </div>
    );
  } else if (refuse) {
    panelBody = (
      <div className="wt-steps wt-refuse" data-tutorial="refuse">
        <p className="wt-step"><b>3 组号码都写不进去</b>，这回合只能拒批（第 {sheet.refusals + 1} 次，罚 {[0, 0, 3, 5][sheet.refusals + 1]} 分{sheet.refusals + 1 >= 3 ? "，游戏结束" : ""}）。</p>
        {planChoices()}
        <div className="wt-buttons">
          <button className="primary-button wt-big danger" type="button" onClick={submit} disabled={busy || !preview} data-tutorial="submit">拒批</button>
        </div>
      </div>
    );
  } else {
    panelBody = (
      <div className="wt-steps">
        {draft.combo === null ? (
          <p className="wt-step" data-tutorial="step"><b>第 1 步</b>：在上面选一组「号码 + 行动」。大家同时选，可以和别人选同一组。</p>
        ) : (
          <>
            {tempOk && (
              <div className="wt-temp" data-tutorial="temp">
                <span>临时工：把 {combo!.num} 改成</span>
                <div className="wt-temp-buttons">
                  {[-2, -1, 0, 1, 2].map((delta) => {
                    const value = combo!.num + delta;
                    if (value < 0 || value > 17) return null;
                    return (
                      <button key={delta} type="button" className={`quiet-button${draft.temp === delta ? " on" : ""}`} data-temp={delta}
                        onClick={() => allow(`temp:${delta}`) && update({ temp: draft.temp === delta ? null : delta, spot: null, skipPlans: [] })} aria-pressed={draft.temp === delta}>
                        {value}
                      </button>
                    );
                  })}
                </div>
                <small>{draft.temp === null ? "不点就不雇临时工" : `雇 1 个临时工（${draft.temp === 0 ? "号码不变也算一个" : `${draft.temp > 0 ? "+" : ""}${draft.temp}`}）`}</small>
              </div>
            )}
            {!draft.spot ? (
              <p className="wt-step" data-tutorial="step"><b>第 2 步</b>：点表上亮着的空地，写下 <b className="wt-num">{num}</b>。同一条街从左到右要越来越大。</p>
            ) : (
              <>
                <p className="wt-step" data-tutorial="step"><b className="wt-num">{num}</b> 写在{STREET_NAMES[draft.spot.street]}第 {draft.spot.house + 1} 格。{actionGuide()}</p>
                {actionControls()}
                {planChoices()}
              </>
            )}
          </>
        )}
        <div className="wt-buttons">
          {draft.combo !== null && <button className="quiet-button wt-mid-button" type="button" onClick={reset}>重选</button>}
          {showHint && <button className="quiet-button wt-mid-button" type="button" onClick={askHint} data-tutorial="hint">提示</button>}
          <button className="primary-button wt-big" type="button" onClick={submit} disabled={busy || !preview} data-tutorial="submit">确认提交</button>
        </div>
      </div>
    );
  }

  const panel = (
    <div className="wt-panel" data-tutorial="panel">
      {panelBody}
      {hint && <p className="wt-hint" role="status">咕噜嘎：{hint}</p>}
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {notice && !error && <p className="feedback feedback-success" role="status">{notice}</p>}
    </div>
  );

  // ---------- 表 ----------
  let shownSheet = viewed.sheet;
  let drafting = false;
  if (!viewingOther && preview) {
    shownSheet = preview.sheet;
    drafting = true;
  } else if (!viewingOther && playing && me.submitted && me.pending) {
    try {
      shownSheet = resolveSubmission(sheet, me.pending, game.combos, game.plans, game.round).sheet;
      drafting = true;
    } catch {
      shownSheet = sheet;
    }
  } else if (!viewingOther && placed) {
    shownSheet = placed;
    drafting = true;
  }
  const targets: SheetTargets = canAct
    ? {
        ...(legalSpots ? { houses: legalSpots, onHouse: pickSpot, housesQuiet: !!draft.spot } : {}),
        ...(fenceTargets ? { fences: fenceTargets, onFence: pickFence } : {}),
        ...(bisTargets ? { bis: bisTargets, onBis: pickBis } : {}),
      }
    : {};
  const shownScore = useMemo(() => {
    const all = scoreAll({ players: game.players.map((player) => (player.id === viewed.id ? { ...player, sheet: shownSheet } : player)) });
    return all[viewed.id]!;
  }, [game.players, viewed.id, shownSheet]);

  const sheetLabel = viewingOther && (
    <div className="wt-viewing" style={{ "--seat": seatColor(viewed.seat), "--seat-ink": seatInk(viewed.seat) } as CSSProperties}>
      <span>正在看 <b>{viewed.name}</b> 的表</span>
      {!spectating && <button className="quiet-button" type="button" onClick={() => setViewId(null)}>回到我的表</button>}
    </div>
  );

  const sheetView = (
    <SheetView
      sheet={shownSheet}
      {...(drafting ? { base: viewed.sheet } : {})}
      plans={game.plans}
      layout={layout}
      targets={viewingOther ? {} : targets}
      recentRound={game.round - (playing ? 1 : 0)}
      label={sheetLabel}
    />
  );
  const strip = (
    <ScoreStrip
      sheet={shownSheet}
      {...(drafting ? { base: viewed.sheet } : {})}
      plans={game.plans}
      score={shownScore}
      {...(improvable && !viewingOther ? { improvable, onImprove: pickImprove } : {})}
      compact={layout.mode === "phone"}
    />
  );

  const planRow = (
    <div className="wt-plans" data-tutorial="plans">
      {game.plans.map((plan, index) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          index={index}
          scale={layout.ps}
          myScore={shownSheet.plans[index] ?? null}
          claimable={!viewingOther && (preview?.claimable.includes(index) ?? false)}
          celebrate={game.lastRound?.approved.includes(index) === true && game.lastRound.round === game.round - (playing ? 1 : 0)}
          compact={layout.mode === "phone"}
        />
      ))}
      {layout.mode === "desk" && (
        <div className="wt-deck" data-tutorial="deck">
          <span>第 <b>{game.round}</b> 回合</span>
          <small>三堆还剩 {game.stacks.map((stack) => stack.drawCount).join(" / ")} 张</small>
        </div>
      )}
    </div>
  );

  const playerTabs = (
    <div className={`wt-players n${game.players.length}`} data-tutorial="players">
      {game.players.map((player) => {
        const m = memberOf(player);
        const last = game.lastRound?.plays[player.id];
        return (
          <button
            key={player.id}
            type="button"
            className={`wt-player${player.id === viewed.id ? " viewing" : ""}${player.submitted ? " done" : ""}${m && !m.connected && !m.bot ? " offline" : ""}`}
            style={{ "--seat": seatColor(player.seat), "--seat-ink": seatInk(player.seat) } as CSSProperties}
            onClick={() => { if (allow(`view:${player.id}`)) { setViewId(player.id === me.id ? null : player.id); if (spectating) onWatch(player.id); } }}
            title={last ? `上回合：${describeMove(game.lastRound!.combos, last.submission)}` : player.name}
            data-player={player.id}
          >
            <span className="wt-player-name">{player.id === me.id && !spectating ? `${player.name}（你）` : player.name}</span>
            <b className="wt-player-score">{scores[player.id]!.total}</b>
            <span className="wt-player-tags">
              {m?.bot && <em className="wt-tag bot">人机</em>}
              {m?.auto && <em className="wt-tag auto">托管</em>}
              {m && !m.connected && !m.bot && <em className="wt-tag warn">离线</em>}
              {playing && <em className={`wt-tag ${player.submitted ? "ok" : "wait"}`}>{player.submitted ? "已交" : "思考中"}</em>}
            </span>
          </button>
        );
      })}
    </div>
  );

  const menuItems = (
    <>
      <GameRules />
      <GameRoomMenu room={room} />
      {mode === "online" && !spectating && !autoPlaying && playing && (
        <button className="quiet-button" type="button" onClick={() => onAuto(true)} title="让人机替你填表，随时可以取消">托管</button>
      )}
      {themeToggle}
      {mode === "online" && member?.isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
      {spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开</button>}
      {layout.mode === "desk" && <button className="quiet-button" type="button" aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)} data-chat="toggle">聊天</button>}
    </>
  );

  const flashLine = flash && <div className="wt-flash" role="status" key={flash.version}>{flash.text}</div>;
  const chatDrawer = chatOpen && (
    <aside className="wt-chat" aria-label="聊天">
      <button className="quiet-button" type="button" onClick={() => setChatOpen(false)}>收起聊天</button>
      {chat}
    </aside>
  );
  const final = game.phase === "gameOver" && (
    <FinalDialog game={game} room={room} myId={spectating ? "" : me.id} memberId={member?.id ?? ""} spectating={spectating} onRematch={onRematch} onLeave={onLeave} actions={props.finalActions} />
  );
  const vars = { "--scene": `url(${sceneFor(theme)})` } as CSSProperties;

  if (layout.mode === "phone") {
    return (
      <div className="wt-screen phone" style={vars}>
        <header className="wt-top">
          <div className={`wt-ptop${urgent ? " urgent" : ""}`} data-tutorial="prompt">
            <strong className="wt-prompt" role="status">{prompt}</strong>
            {timer}
          </div>
          <button className="quiet-button wt-menu-button" type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>菜单</button>
          {menuOpen && (
            <div className="wt-menu" role="dialog" aria-label="菜单">
              {brand}
              <div className="wt-menu-items">{menuItems}</div>
              {connection}
              <button className="quiet-button" type="button" onClick={() => setMenuOpen(false)}>关闭</button>
            </div>
          )}
        </header>
        {flashLine}
        {combos}
        {panel}
        <div className="wt-sheet-panel">{sheetView}</div>
        {planRow}
        <div className="wt-strip-panel">{strip}</div>
        {playerTabs}
        <section className="wt-below">
          <p className="wt-muted">第 {game.round} 回合 · 三堆还剩 {game.stacks.map((stack) => stack.drawCount).join(" / ")} 张</p>
          {chat}
        </section>
        {final}
        {props.overlay}
      </div>
    );
  }

  return (
    <div className="wt-screen desk" style={vars}>
      <header className="wt-top">
        {brand}
        <div className="wt-top-right">{menuItems}{connection}</div>
      </header>
      <div className="wt-main lk-fit" style={{ "--right": `${layout.rightW}px` } as CSSProperties}>
        <section className="wt-left">
          {planRow}
          <div className="wt-sheet-panel">
            {sheetView}
            {strip}
          </div>
          {playerTabs}
        </section>
        <aside className="wt-right">
          <div className={`wt-status${urgent ? " urgent" : ""}`} data-tutorial="prompt">
            <strong className="wt-prompt" role="status">{prompt}</strong>
            {timer}
          </div>
          {combos}
          {panel}
        </aside>
      </div>
      {flashLine}
      {chatDrawer}
      {final}
      {props.overlay}
    </div>
  );
}

/** 一手 → 草稿（撤回、提示时恢复到界面上）。 */
export function draftFromSubmission(submission: Submission, game: GameState): Draft {
  const move = submission.move;
  if (!move) return { ...EMPTY_DRAFT };
  return {
    ...EMPTY_DRAFT,
    combo: move.combo,
    temp: move.temp ?? null,
    spot: { street: move.street, house: move.house },
    fence: move.fence ?? null,
    improve: move.improve ?? null,
    park: move.park ?? (game.combos[move.combo]?.action !== "park"),
    pool: move.pool ?? (game.combos[move.combo]?.action !== "pool"),
    bis: move.bis ?? null,
    skipPlans: [],
    reshuffle: submission.reshuffle === true,
  };
}

/** 「再来一局」倒计时：按收到的时刻换算成截止时间、每秒刷新。 */
function useRematchSeconds(remainingMs: number | undefined): number | null {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (remainingMs === undefined) {
      setDeadline(null);
      return;
    }
    setDeadline(Date.now() + remainingMs);
    setNow(Date.now());
  }, [remainingMs]);
  useEffect(() => {
    if (deadline === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

const REASON_TEXT = { refusals: "有人拒批满 3 次", plans: "有人完成了 3 张目标卡", full: "有人把 33 座房子填满了" } as const;

function FinalDialog({ game, room, myId, memberId, spectating, onRematch, onLeave, actions }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  memberId: string;
  spectating: boolean;
  actions?: ReactNode;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
}) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(memberId) ?? false;
  const rematchSeconds = useRematchSeconds(room.rematch?.remainingMs);
  const rows = [...game.players].sort((a, b) => result.ranks[a.id]! - result.ranks[b.id]!);
  const winners = result.winners.map((id) => game.players.find((player) => player.id === id)!);
  const iWon = result.winners.includes(myId);
  const names = winners.map((player) => player.name).join("、");
  const title = !spectating && iWon
    ? winners.length > 1 ? `你和${winners.filter((p) => p.id !== myId).map((p) => p.name).join("、")}并列第一！` : "你赢了！"
    : `${names} ${winners.length > 1 ? "并列获胜" : "获胜"}`;
  return (
    <div className="gm-modal-backdrop wt-backdrop-light" role="presentation">
      <section className="gm-panel wt-final" role="dialog" aria-modal="true" aria-labelledby="wt-final-title" data-tutorial="final">
        <div className="wt-final-head">
          <h2 id="wt-final-title">{title}</h2>
          <p className="wt-muted">{result.reasons.map((reason) => REASON_TEXT[reason]).join("、")}，共 {result.rounds} 回合。总分最高的赢，平分比完成的小区多。</p>
        </div>
        <div className="wt-final-scroll">
          <table className="wt-score-table">
            <thead>
              <tr><th>名次</th><th>玩家</th><th className="d">目标卡</th><th className="d">公园</th><th className="d">泳池</th><th className="d">临时工</th><th className="d">小区</th><th className="d">bis</th><th className="d">拒批</th><th>总分</th></tr>
            </thead>
            <tbody>
              {rows.map((player) => {
                const s = result.scores[player.id]!;
                return (
                  <tr key={player.id} className={`${player.id === myId ? "me" : ""}${result.winners.includes(player.id) ? " winner" : ""}`}>
                    <td className="wt-num big">{result.ranks[player.id]}</td>
                    <td>
                      <span className="wt-who" style={{ "--seat": seatColor(player.seat) } as CSSProperties}>{player.id === myId ? `${player.name}（你）` : player.name}</span>
                      <small className="wt-row-detail">目标卡 {s.plans} · 公园 {s.parks} · 泳池 {s.pools} · 临时工 {s.temps} · 小区 {s.estates}{s.bis ? ` · bis −${s.bis}` : ""}{s.refusals ? ` · 拒批 −${s.refusals}` : ""}</small>
                    </td>
                    <td className="wt-num d">{s.plans}</td>
                    <td className="wt-num d">{s.parks}</td>
                    <td className="wt-num d">{s.pools}</td>
                    <td className="wt-num d">{s.temps}</td>
                    <td className="wt-num d" title={s.estateCounts.map((count, i) => (count ? `${i + 1}房×${count}（单价 ${s.estateValues[i]}）` : "")).filter(Boolean).join("，") || "没有完成的小区"}>{s.estates}</td>
                    <td className="wt-num neg d">{s.bis ? `−${s.bis}` : 0}</td>
                    <td className="wt-num neg d">{s.refusals ? `−${s.refusals}` : 0}</td>
                    <td className="wt-num big">{s.total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {actions ? (
          <div className="wt-rematch" data-tutorial="final-actions">
            <span>练习局打完了</span>
            <div className="gm-panel-actions">{actions}</div>
          </div>
        ) : spectating ? (
          <div className="wt-rematch">
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
            <div className="gm-panel-actions"><button className="quiet-button" type="button" onClick={onLeave}>离开观战</button></div>
          </div>
        ) : room.rematch && (
          <div className="wt-rematch" data-tutorial="rematch">
            <span>再来一局？还剩 {rematchSeconds ?? Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button wt-big" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
