/**
 * 预览页（提交进仓库，界面维护；教程可以往里加场景，不要删别人的场景，也不要整个删掉）。
 * 不连服务器：用规则包的预览局面工厂造局面，渲染真正的 GameBoard / 首页 / 等候房间。牌桌上的动作直接在浏览器里跑引擎。
 * 生产构建只打包 index.html，不会带上它。打开：http://localhost:5298/preview.html?s=<场景>
 *
 * 参数（都可以不写）：
 *   ?s=<场景>     牌桌场景用规则包 SCENE_NAMES（start、fence、improve、park、pool、temp、bis、plan、refuse、submitted、approved、mid、six、late、gameover、gameover-tie），
 *                 另外有：home、home-rooms（首页）、waiting-1 / waiting-full / waiting-bots / waiting-guest / waiting-spec（等候房间）、
 *                 six-over（6 人终局，表铺满）、
 *                 d-fence / d-temp / d-bis / d-improve / d-plan / d-pool（选好组、填好位、行动也选好的草稿，看草稿样子）、pick（只选了一组，看亮着的空地）
 *   &n=<人数>      1–6     &v=<座位> 从哪个座位看（默认 p1）     &view=<座位> 进来就切到看这个人的表
 *   &bots=p2,p3   人机座位    &auto=p1  托管中    &offline=p3  离线    &spec=1 观战
 *   &t=<毫秒>      倒计时剩余；t=none 不显示     &chat=1 带几条聊天     &live=1 别人由人机自动交，一直玩下去
 *   &seed=<数>     种子     &hint=1 显示「提示」按钮     &err=<文字> 模拟服务器拒绝了动作（看非法操作提示）
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactDOM from "react-dom/client";
import {
  apply,
  autoPlayToEnd,
  botCommand,
  botHint,
  createRng,
  createScene,
  createSceneRoom,
  DEFAULT_ROOM_ACCESS,
  redactGameForViewer,
  SCENE_NAMES,
  type Capacity,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type RoomChatMessage,
  type SceneName,
} from "@welcometo/game";
import { Brand, ConnectionStatus, HomeScreen, RoomScreen } from "./App.js";
import { useConfirm } from "./confirm.js";
import GameBoard, { type Draft } from "./GameBoard.js";
import RoomChat from "./RoomChat.js";
import { socket } from "./socket.js";
import { applyTheme, readTheme, ThemeToggle, useTheme } from "./theme.js";
import { useVoice } from "./voice.js";
import "./styles.css";
import "./app-pixel.css";
import "./wt-pages.css";
import "./welcometo.css";
import "./theme-day.css";

applyTheme(readTheme());

const params = new URLSearchParams(location.search);
const sceneName = params.get("s") ?? "start";
const players = Math.min(6, Math.max(1, Number(params.get("n") ?? 4)));
const viewer = params.get("v") ?? (sceneName === "waiting-guest" ? "p2" : "p1");
const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
const spectator = params.get("spec") === "1";
const seed = Number(params.get("seed") ?? 11);
const live = params.get("live") === "1";
const timeParam = params.get("t");
const turnRemainingMs = timeParam === "none" ? undefined : timeParam ? Number(timeParam) : undefined;

Object.defineProperty(socket, "id", { get: () => (spectator ? "sock-watcher" : `sock-${viewer}`), configurable: true });
socket.emit = ((event: string, ...args: unknown[]) => {
  const ack = args[args.length - 1];
  if (typeof ack === "function") (ack as (response: unknown) => void)({ ok: false, error: `预览页不连服务器（${event}）` });
  return socket;
}) as typeof socket.emit;
socket.connect = (() => socket) as typeof socket.connect;

const CHAT: RoomChatMessage[] = [
  { id: "c1", senderId: "sock-p2", name: "阿花", message: "这把 n°2 我先拿了", createdAt: "2026-10-10T20:01:00.000Z" },
  { id: "c2", senderId: "sock-p1", name: "我", message: "我的第 3 条街快卡死了", createdAt: "2026-10-10T20:01:30.000Z" },
  { id: "c3", senderId: "sock-watcher", name: "看客", message: "泳池好多", createdAt: "2026-10-10T20:02:00.000Z", spectator: true },
];

/** 草稿场景：哪个局面 + 草稿。 */
const DRAFTS: Record<string, { scene: SceneName; draft: Partial<Draft> }> = {
  "d-fence": { scene: "fence", draft: { combo: 0, spot: { street: 0, house: 3 }, fence: { street: 0, pos: 3 } } },
  "d-temp": { scene: "temp", draft: { combo: 0, temp: 2, spot: { street: 0, house: 4 } } },
  "d-bis": { scene: "bis", draft: { combo: 0, spot: { street: 0, house: 7 }, bis: { street: 0, house: 4, from: -1 } } },
  "d-improve": { scene: "improve", draft: { combo: 0, spot: { street: 1, house: 8 }, improve: 3 } },
  "d-plan": { scene: "plan", draft: { combo: 0, spot: { street: 0, house: 6 }, reshuffle: true } },
  "d-pool": { scene: "pool", draft: { combo: 0, spot: { street: 0, house: 6 } } },
  pick: { scene: "start", draft: { combo: 1 } },
};

function buildScene(): GameState {
  if (sceneName === "six-over") return autoPlayToEnd(createScene("start", { players: 6, seed }), seed);
  const draft = DRAFTS[sceneName];
  if (draft) return createScene(draft.scene, { players, seed });
  if ((SCENE_NAMES as readonly string[]).includes(sceneName)) return createScene(sceneName as SceneName, { players, seed });
  return createScene("start", { players, seed });
}

function BoardPreview() {
  const [theme, toggleTheme] = useTheme();
  const [full, setFull] = useState<GameState>(buildScene);
  const [error, setError] = useState(params.get("err") ?? "");
  const [autoIds, setAutoIds] = useState(list("auto"));
  const [confirm, confirmDialog] = useConfirm();
  const room = useMemo(() => {
    const base = createSceneRoom(full, {
      viewer,
      spectator,
      offline: list("offline"),
      bots: list("bots"),
      auto: autoIds,
      ...(turnRemainingMs !== undefined ? { turnRemainingMs } : {}),
    });
    const withChat = params.get("chat") === "1" ? { ...base, chat: CHAT } : base;
    return timeParam === "none" ? ((({ turnRemainingMs: _drop, ...rest }) => rest)(withChat) as LobbyRoomSnapshot) : withChat;
  }, [full, autoIds]);
  const voice = useVoice(room);
  const [watchId, setWatchId] = useState(full.players[0]!.id);
  const rng = useRef(createRng(seed + 5));

  function command(cmd: GameCommand, as = viewer) {
    try {
      const { step: _step, ...clean } = cmd as GameCommand & { step?: string };
      setFull((state) => apply(state, as, clean as GameCommand, rng.current).state);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  // live：别人（和托管的我）由人机交
  const fullRef = useRef(full);
  fullRef.current = full;
  useEffect(() => {
    if (!live || full.phase !== "play") return;
    const actor = full.players.find((player) => !player.submitted && (player.id !== viewer || autoIds.includes(viewer)))?.id;
    if (!actor) return;
    const timer = window.setTimeout(() => {
      const submission = botCommand(redactGameForViewer(fullRef.current, actor), actor);
      if (submission) command({ type: "submit", submission }, actor);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [full, autoIds]);

  // &view=p2：进来就切到看这个人的表
  useEffect(() => {
    const view = params.get("view");
    if (!view) return;
    const timer = window.setTimeout(() => (document.querySelector(`[data-player="${view}"]`) as HTMLButtonElement | null)?.click(), 150);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="app-shell wt-game">
      <GameBoard
        room={room}
        busy={false}
        error={error}
        notice=""
        brand={<Brand />}
        connection={<ConnectionStatus connected />}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        theme={theme}
        chat={<RoomChat room={room} voice={voice} />}
        onCommand={(cmd) => command(cmd)}
        onRematch={() => setFull(buildScene())}
        onAuto={(enabled) => setAutoIds((ids) => (enabled ? [...ids, viewer] : ids.filter((id) => id !== viewer)))}
        onDissolve={() => void confirm({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" })}
        watchId={watchId}
        onWatch={setWatchId}
        onLeave={() => setError("预览页：离开只在真房间里有效")}
        {...(params.get("hint") === "1" ? { mode: "practice" as const, onHint: () => botHint(redactGameForViewer(fullRef.current, viewer), viewer) } : {})}
        {...(DRAFTS[sceneName] ? { initialDraft: DRAFTS[sceneName]!.draft } : {})}
      />
      {confirmDialog}
    </main>
  );
}

/* ---------- 首页 ---------- */

const LOBBY: PublicRoomSummary[] = [
  {
    id: "r1", status: "playing", capacity: 5, open: false, allowSpectators: true, spectators: 1,
    players: [
      { name: "阿花", isHost: true, connected: true, score: 43, isActive: true },
      { name: "老王", isHost: false, connected: true, score: 51 },
      { name: "咕噜一号", isHost: false, connected: true, bot: true, score: 48 },
      { name: "小美", isHost: false, connected: false, score: 30 },
      { name: "大刘", isHost: false, connected: true, score: 18, isActive: true },
    ],
  },
  { id: "r2", status: "waiting", capacity: 6, open: true, allowSpectators: true, spectators: 0, players: [{ name: "二丫", isHost: true, connected: true }, { name: "三毛", isHost: false, connected: true }] },
  {
    id: "r3", status: "finished", capacity: 3, open: false, allowSpectators: true, spectators: 0,
    players: [{ name: "四喜", isHost: true, connected: true, score: 92, isWinner: true }, { name: "五福", isHost: false, connected: true, score: 70 }, { name: "咕噜二号", isHost: false, connected: true, bot: true, score: 85 }],
  },
];

function HomePreview() {
  const [theme, toggleTheme] = useTheme();
  const [name, setName] = useState("小明");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [code, setCode] = useState("");
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <HomeScreen
        theme={theme}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        connected
        mode={mode}
        onMode={setMode}
        name={name}
        onName={setName}
        capacity={capacity}
        onCapacity={setCapacity}
        roomCode={code}
        onRoomCode={(value) => setCode(value.toUpperCase().slice(0, 6))}
        canSubmit={name.trim().length >= 2}
        busy={false}
        error=""
        notice=""
        onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
        lobbyRooms={sceneName === "home-rooms" ? LOBBY : []}
        onJoinListed={() => undefined}
        confirm={confirm}
      />
      {confirmDialog}
    </>
  );
}

/* ---------- 等候房间 ---------- */

const NAMES = ["我", "阿花", "老王", "小美", "大刘", "二丫"];

function waitingRoom(): LobbyRoomSnapshot {
  const kind = sceneName.slice("waiting-".length);
  const capacity = (kind === "full" ? 6 : kind === "1" ? 4 : kind === "bots" ? 4 : Math.max(2, players)) as Capacity;
  const seats = kind === "1" ? 1 : kind === "full" ? 6 : kind === "bots" ? 4 : kind === "spec" ? 3 : 2;
  let botNo = 0;
  const members: LobbyMember[] = Array.from({ length: seats }, (_, index) => {
    const bot = (kind === "bots" && index > 0) || (kind === "full" && index >= 4);
    return {
      id: `sock-p${index + 1}`,
      playerId: `p${index + 1}`,
      name: bot ? `咕噜${["一", "二", "三", "四", "五"][botNo++]}号` : NAMES[index]!,
      isHost: index === 0,
      connected: !(kind === "full" && index === 3),
      ...(bot ? { bot: true } : {}),
    };
  });
  return {
    code: kind === "spec" ? "" : "WEL327",
    spectators: kind === "full" || kind === "spec" ? [{ id: "sock-watcher", name: "看客" }] : [],
    access: { ...DEFAULT_ROOM_ACCESS, ...(kind === "full" ? { open: true } : {}) },
    capacity,
    status: "waiting",
    members,
    chat: params.get("chat") === "1" ? CHAT : [],
    voice: [],
  };
}

function RoomPreview() {
  const [theme, toggleTheme] = useTheme();
  const [room] = useState(waitingRoom);
  const voice = useVoice(room);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <RoomScreen
        room={room}
        busy={false}
        error=""
        notice=""
        connected
        theme={theme}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        chat={<RoomChat room={room} voice={voice} />}
        onCopyCode={() => undefined}
        onLeave={() => undefined}
        onStart={() => undefined}
        onKick={() => undefined}
        onAddBot={() => undefined}
        onDissolve={() => void confirm({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" })}
      />
      {confirmDialog}
    </>
  );
}

function Preview() {
  if (sceneName.startsWith("home")) return <HomePreview />;
  if (sceneName.startsWith("waiting")) {
    if (sceneName === "waiting-spec") Object.defineProperty(socket, "id", { get: () => "sock-watcher", configurable: true });
    return <RoomPreview />;
  }
  return <BoardPreview />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Preview />);
