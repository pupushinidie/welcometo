import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  ACTION_NAMES,
  ACTIONS,
  CAPACITY_OPTIONS,
  type Capacity,
  type GameCommand,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
} from "@welcometo/game";
import { actionIcon, ART, miniHouseArt, seatColor, seatInk } from "./art.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import GameRules from "./GameRules.js";
import OnlineRooms from "./OnlineRooms.js";
import RoomChat from "./RoomChat.js";
import { roomRole, RoomSettingsPanel, SeatSwitch } from "./RoomExtras.js";
import { forgetSeat, readName, readSeat, rememberName, rememberSeat, retryable } from "./seat.js";
import { socket } from "./socket.js";
import { ThemeToggle, useTheme, type Theme } from "./theme.js";
import { TutorialInvite } from "./tutorial/Invite.js";
import { readTutorial } from "./tutorial/storage.js";
import { GAME_ID } from "./tutorial/tutorialGame.js";
import TutorialMode from "./tutorial/TutorialMode.js";
import { useVoice } from "./voice.js";

type EntryMode = "create" | "join";

const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

// 线上游戏中心在站点根路径；本地开发时跑在 5175 端口。
const CENTER_URL = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5175/` : "/";

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

/** 同一局里版本更低的快照是旧的（再来一局后 game 换了一局，版本从头算，不算旧）。 */
function isStale(next: LobbyRoomSnapshot, current: LobbyRoomSnapshot | null): boolean {
  const a = next.game;
  const b = current?.game;
  if (!a || !b || next.code !== current?.code) return false;
  if (a.version >= b.version) return false;
  return a.version + 10 > b.version;
}

type Confirm = (request: { title: string; detail: string; confirmLabel: string }) => Promise<boolean>;

function App() {
  const [mode, setMode] = useState<EntryMode>("create");
  const [name, setName] = useState(readName);
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [confirmAction, confirmDialog] = useConfirm();
  const [theme, toggleTheme] = useTheme();
  const themeToggle = <ThemeToggle theme={theme} onToggle={toggleTheme} />;
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<LobbyRoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState<PublicRoomSummary[]>([]);
  const [watchId, setWatchId] = useState("");
  const voice = useVoice(room);
  // 新手教程：首页或等候房间点进来（地址带 ?tutorial 时直接打开）
  const [tutorialOpen, setTutorialOpen] = useState(() => new URLSearchParams(window.location.search).has("tutorial"));
  function closeTutorial() {
    setTutorialOpen(false);
    const params = new URLSearchParams(window.location.search);
    if (params.has("tutorial")) {
      params.delete("tutorial");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }
  // 在等候房间里看教程时，房主一开局就回到牌桌（不然这一回合会超时、转成托管）
  useEffect(() => {
    if (tutorialOpen && room?.status === "playing") {
      closeTutorial();
      setNotice("对局开始了，教程先停在这里。");
    }
  }, [tutorialOpen, room?.status]);

  useEffect(() => {
    if (room || !socket.connected) return;
    socket.emit("lobby:get", (response) => {
      if (response.ok) setLobbyRooms(response.data);
    });
  }, [room === null]);

  // 断线重连、刷新页面：坐着的玩家把「昵称 + 房间码」记在 sessionStorage，连上后自动用原昵称回到座位（见 seat.ts）
  const roomRef = useRef<LobbyRoomSnapshot | null>(null);
  roomRef.current = room;
  const rejoinTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const me = room?.members.find((member) => member.id === socket.id);
    if (room && me && room.code) rememberSeat({ name: me.name, code: room.code });
  }, [room]);
  function rejoinSeat(tries = 0) {
    window.clearTimeout(rejoinTimer.current);
    const seat = readSeat();
    if (!seat || !socket.connected) return;
    socket.emit("room:join", { name: seat.name, code: seat.code }, (response) => {
      if (response.ok) {
        setRoom(response.data);
        setError("");
        setNotice(response.data.status === "playing" ? "已回到对局。" : "已回到房间。");
        return;
      }
      if (retryable(response.error) && tries < 45) {
        setNotice("正在回到座位…");
        rejoinTimer.current = window.setTimeout(() => rejoinSeat(tries + 1), 2000);
        return;
      }
      forgetSeat();
      setRoom(null);
      setNotice("");
      setError(`没能回到刚才的房间：${response.error}`);
    });
  }
  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      socket.emit("lobby:get", (response) => {
        if (response.ok) setLobbyRooms(response.data);
      });
      const current = roomRef.current;
      if (readSeat() && (!current || !current.members.some((member) => member.id === socket.id))) rejoinSeat();
    };
    const handleDisconnect = () => setConnected(false);
    const handleRoomUpdate = (snapshot: LobbyRoomSnapshot) => setRoom((current) => (isStale(snapshot, current) ? current : snapshot));
    const handleRoomError = (message: string) => setError(message);
    const handleLobbyUpdate = (rooms: PublicRoomSummary[]) => setLobbyRooms(rooms);
    const handleRoomClosed = ({ reason }: { reason: string }) => {
      forgetSeat();
      setRoom(null);
      setBusy(false);
      setError("");
      setNotice(reason);
    };
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:updated", handleRoomUpdate);
    socket.on("room:error", handleRoomError);
    socket.on("lobby:updated", handleLobbyUpdate);
    socket.on("room:closed", handleRoomClosed);
    socket.connect();
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:updated", handleRoomUpdate);
      socket.off("room:error", handleRoomError);
      socket.off("lobby:updated", handleLobbyUpdate);
      socket.off("room:closed", handleRoomClosed);
      socket.disconnect();
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!connected || busy || name.trim().length < 2 || name.trim().length > 18) return false;
    return mode === "create" || validRoomCode.test(roomCode);
  }, [busy, connected, mode, name, roomCode]);

  function joinListed(roomId: string, spectate: boolean) {
    const nickname = name.trim();
    if (nickname.length < 2 || nickname.length > 18) {
      setNotice("");
      setError("先在上面填好你的昵称（2–18 个字符）。");
      document.getElementById("player-name")?.focus();
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    socket.emit("room:join", { name: nickname, roomId, spectate }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      rememberName(nickname);
      setNotice(spectate ? "正在观战。" : "已加入房间。");
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const nickname = name.trim();
    const complete = (response: { ok: true; data: LobbyRoomSnapshot } | { ok: false; error: string }) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      rememberName(nickname);
      setNotice(mode === "create"
        ? "房间已创建，可以邀请朋友加入，也可以点空座位加人机。"
        : response.data.status === "playing" ? "已回到对局，继续游戏吧。" : "已加入房间。");
    };
    if (mode === "create") socket.emit("room:create", { name: nickname, capacity }, complete);
    else socket.emit("room:join", { name: nickname, code: roomCode }, complete);
  }

  function startGame() {
    setError("");
    setBusy(true);
    socket.emit("room:start", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice("");
    });
  }

  function leaveRoom() {
    setBusy(true);
    socket.emit("room:leave", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      forgetSeat();
      setRoom(null);
      setError("");
      setNotice("已离开房间。");
    });
  }

  function submitGameCommand(command: GameCommand) {
    setBusy(true);
    setError("");
    setNotice("");
    socket.emit("game:command", command, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom((current) => (isStale(response.data, current) ? current : response.data));
    });
  }

  function roomCommand(send: (ack: (response: { ok: true; data: void } | { ok: false; error: string }) => void) => void) {
    setError("");
    send((response) => {
      if (!response.ok) setError(response.error);
    });
  }

  const kickMember = (memberId: string) => roomCommand((ack) => socket.emit("room:kick", memberId, ack));
  const addBot = () => roomCommand((ack) => socket.emit("room:add-bot", ack));
  const setAuto = (enabled: boolean) => roomCommand((ack) => socket.emit("room:auto", enabled, ack));
  const voteRematch = (accept: boolean) => roomCommand((ack) => socket.emit("room:rematch", accept, ack));
  async function dissolveRoom() {
    const ok = await confirmAction({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" });
    if (ok) roomCommand((ack) => socket.emit("room:dissolve", ack));
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("房间码已复制。");
    } catch {
      setNotice("请手动复制房间码。");
    }
  }

  if (tutorialOpen && room?.status !== "playing") {
    return (
      <main className="app-shell wt-game tut-on">
        <TutorialMode name={name} brand={<Brand />} themeToggle={themeToggle} theme={theme} waitingRoom={room?.code} onExit={closeTutorial} />
        {confirmDialog}
      </main>
    );
  }

  if (room?.status === "playing" && room.game) {
    const players = room.game.players;
    const watched = players.some((player) => player.id === watchId) ? watchId : players[0]!.id;
    return (
      <main className="app-shell wt-game">
        <GameBoard
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          brand={<Brand />}
          connection={<ConnectionStatus connected={connected} />}
          themeToggle={themeToggle}
          theme={theme}
          chat={<RoomChat room={room} voice={voice} />}
          onCommand={submitGameCommand}
          onRematch={voteRematch}
          onAuto={setAuto}
          onDissolve={dissolveRoom}
          watchId={watched}
          onWatch={setWatchId}
          onLeave={leaveRoom}
        />
        {confirmDialog}
      </main>
    );
  }

  if (room) {
    return (
      <>
        <RoomScreen
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          connected={connected}
          theme={theme}
          themeToggle={themeToggle}
          chat={<RoomChat room={room} voice={voice} />}
          onCopyCode={copyRoomCode}
          onLeave={leaveRoom}
          onStart={startGame}
          onKick={kickMember}
          onAddBot={addBot}
          onDissolve={dissolveRoom}
          tutorialEntry={
            <TutorialInvite
              record={readTutorial(GAME_ID)}
              title="等人的时候，先学一下？"
              text="咕噜嘎带你在真表上填几回合，不会离开房间，房主一开局就自动回来。"
              again="再看一遍新手教程"
              onOpen={() => setTutorialOpen(true)}
            />
          }
        />
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <HomeScreen
        theme={theme}
        themeToggle={themeToggle}
        connected={connected}
        mode={mode}
        onMode={(next) => { setMode(next); setError(""); }}
        name={name}
        onName={setName}
        capacity={capacity}
        onCapacity={setCapacity}
        roomCode={roomCode}
        onRoomCode={(value) => setRoomCode(normalizeRoomCode(value))}
        canSubmit={canSubmit}
        busy={busy}
        error={error}
        notice={notice}
        onSubmit={handleSubmit}
        lobbyRooms={lobbyRooms}
        onJoinListed={joinListed}
        confirm={confirmAction}
        tutorialEntry={
          <TutorialInvite
            record={readTutorial(GAME_ID)}
            title="第一次玩？5 分钟学会"
            text="咕噜嘎在真表上带你填几回合，学完和人机练一局。"
            again="再看一遍新手教程"
            onOpen={() => setTutorialOpen(true)}
          />
        }
      />
      {confirmDialog}
    </>
  );
}

export function Brand() {
  return (
    <a className="brand" href={import.meta.env.BASE_URL} aria-label="欢迎来到首页">
      <img className="wt-brand-icon" src={miniHouseArt(0)} alt="" width={32} height={32} />
      <span className="brand-name">欢迎来到</span>
    </a>
  );
}

export function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className={connected ? "connection-status online" : "connection-status"}>
      <span className="connection-dot" />
      {connected ? "已连接" : "连接中…"}
    </div>
  );
}

/** 6 种行动一览（首页、等候房间）。 */
export function ActionKinds() {
  return (
    <div className="wt-kinds" aria-label="6 种行动">
      {ACTIONS.map((action) => (
        <figure key={action}>
          <img src={actionIcon(action)} alt="" width={32} height={32} />
          <figcaption>{ACTION_NAMES[action]}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/* ---------- 首页 ---------- */

export function HomeScreen(props: {
  theme: Theme;
  themeToggle: ReactNode;
  connected: boolean;
  mode: EntryMode;
  onMode: (mode: EntryMode) => void;
  name: string;
  onName: (name: string) => void;
  capacity: Capacity;
  onCapacity: (capacity: Capacity) => void;
  roomCode: string;
  onRoomCode: (code: string) => void;
  canSubmit: boolean;
  busy: boolean;
  error: string;
  notice: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  lobbyRooms: PublicRoomSummary[];
  onJoinListed: (roomId: string, spectate: boolean) => void;
  confirm: Confirm;
  tutorialEntry?: ReactNode;
}) {
  const { mode, busy } = props;
  return (
    <main className="app-shell wt-page wt-home-page">
      <header className="topbar wt-pagebar">
        <Brand />
        <div className="topbar-right">
          <a className="center-link" href={CENTER_URL}>← 游戏中心</a>
          <GameRules />
          {props.themeToggle}
          <ConnectionStatus connected={props.connected} />
        </div>
      </header>

      <div className="wt-home">
        <section className="wt-home-hero">
          <div className="wt-hero-art" role="img" aria-label="黄昏的郊区小街" style={{ "--hero-img": `url(${props.theme === "day" ? ART.bgDay : ART.bgNight})` } as CSSProperties}>
            <h1>欢迎来到</h1>
          </div>
          <p className="wt-lead">
            每回合翻出 3 组「门牌号 + 行动」，大家<b>同时</b>选一组，把号码写进自己的三条街（<b>从左到右越来越大</b>），
            再画栅栏围小区、建公园泳池、抢目标卡。<b>总分最高</b>的人赢。
          </p>
          <div className="wt-home-facts">
            <span>1–6 人</span><span>一局约 25 分钟</span><span>人不够可以加人机</span>
          </div>
          <ActionKinds />
          {props.tutorialEntry}
        </section>

        <section className="entry-card wt-entry" aria-labelledby="entry-title">
          <div className="entry-card-heading">
            <h2 id="entry-title">进入牌桌</h2>
          </div>
          <div className="mode-switch" role="tablist" aria-label="选择房间操作">
            <button className={mode === "create" ? "mode-tab active" : "mode-tab"} type="button" role="tab" aria-selected={mode === "create"} onClick={() => props.onMode("create")}>创建房间</button>
            <button className={mode === "join" ? "mode-tab active" : "mode-tab"} type="button" role="tab" aria-selected={mode === "join"} onClick={() => props.onMode("join")}>加入房间</button>
          </div>
          <form className="entry-form" onSubmit={props.onSubmit}>
            <label className="field-label" htmlFor="player-name">你的昵称</label>
            <input id="player-name" className="text-input" value={props.name} onChange={(event) => props.onName(event.target.value)} placeholder="输入 2–18 个字符" minLength={2} maxLength={18} autoComplete="nickname" required />
            {mode === "create" ? (
              <>
                <label className="field-label field-label-spaced" htmlFor="room-capacity">房间人数 <small className="wt-muted">一个人也能开，空座位加人机</small></label>
                <div className="wt-capacity" id="room-capacity" role="group" aria-label="选择房间人数">
                  {CAPACITY_OPTIONS.map((seats) => (
                    <button key={seats} type="button" className={props.capacity === seats ? "capacity-option selected" : "capacity-option"} aria-pressed={props.capacity === seats} onClick={() => props.onCapacity(seats)}>
                      <strong>{seats}</strong>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <label className="field-label field-label-spaced" htmlFor="room-code">房间码</label>
                <input id="room-code" className="text-input room-code-input" value={props.roomCode} onChange={(event) => props.onRoomCode(event.target.value)} placeholder="例如：7KQ2TX" autoComplete="off" maxLength={6} required />
                <p className="field-hint">6 位字母或数字。掉线了用原昵称和房间码进来，会回到自己的座位。</p>
              </>
            )}
            {props.error && <p className="feedback feedback-error" role="alert">{props.error}</p>}
            {props.notice && <p className="feedback feedback-success" role="status">{props.notice}</p>}
            <button className="primary-button wt-entry-submit" type="submit" disabled={!props.canSubmit}>
              {busy ? <><span className="spinner" /> 正在连接</> : mode === "create" ? "创建房间" : "加入牌桌"}
            </button>
          </form>
        </section>

        <div className="wt-home-rooms">
          <OnlineRooms rooms={props.lobbyRooms} connected={props.connected} busy={busy} onJoin={props.onJoinListed} confirm={props.confirm} />
        </div>
      </div>
    </main>
  );
}

/* ---------- 等候房间 ---------- */

export function RoomScreen({ room, busy, error, notice, connected, theme, themeToggle, chat, onCopyCode, onLeave, onStart, onKick, onAddBot, onDissolve, tutorialEntry }: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  connected: boolean;
  theme: Theme;
  themeToggle: ReactNode;
  chat: ReactNode;
  onCopyCode: () => void;
  onLeave: () => void;
  onStart: () => void;
  onKick: (memberId: string) => void;
  onAddBot: () => void;
  onDissolve: () => void;
  tutorialEntry?: ReactNode;
}) {
  const { isHost, spectating } = roomRole(room);
  const openSeats = Math.max(0, room.capacity - room.members.length);
  const two = room.capacity > 4;
  return (
    <main className="app-shell wt-page wt-room-page" style={{ "--hero-img": `url(${theme === "day" ? ART.bgDay : ART.bgNight})` } as CSSProperties}>
      <header className="topbar wt-pagebar">
        <Brand />
        <div className="topbar-right">
          <GameRules />
          {themeToggle}
          <ConnectionStatus connected={connected} />
        </div>
      </header>
      <div className="wt-room">
        <section className="wt-room-info">
          <div className="room-panel wt-code-panel">
            <div className="panel-label">{spectating ? "你在观战" : "牌桌准备中"}</div>
            {room.code ? (
              <button className="room-code-display" type="button" onClick={onCopyCode} title="复制房间码" data-tutorial="room-code">
                {room.code}<span aria-hidden="true">⧉</span>
              </button>
            ) : (
              <div className="room-code-caption">从首页列表进来观战，看不到房间码</div>
            )}
            <div className="room-code-caption">{room.code ? "点一下复制，发给朋友" : ""}</div>
            <div className="wt-room-buttons">
              {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve} disabled={busy}>解散房间</button>}
              <button className="quiet-button" type="button" onClick={onLeave} disabled={busy || (room.status === "playing" && !spectating)}>{spectating ? "离开观战" : "离开房间"}</button>
            </div>
          </div>
          <div className="room-panel wt-options-panel">
            <RoomSettingsPanel room={room} />
          </div>
        </section>

        <section className="room-panel wt-room-players" data-tutorial="room-players">
          <div className="panel-topline">
            <div className="panel-label">玩家 <span>{room.members.length} / {room.capacity}</span></div>
            <span className="waiting-pill"><i /> 等待中</span>
          </div>
          <div className={two ? "wt-seat-grid two" : "wt-seat-grid"}>
            {room.members.map((member, index) => (
              <div className="wt-room-seat" key={member.id} style={{ "--seat": seatColor(index), "--seat-ink": seatInk(index) } as CSSProperties}>
                <span className="wt-mini-avatar"><img src={miniHouseArt(index % 3)} alt="" width={32} height={32} /></span>
                <div className="wt-room-seat-name">
                  <strong>{member.name}</strong>
                  <span>
                    {member.id === socket.id && <em className="wt-tag you">你</em>}
                    {member.isHost && <em className="wt-tag">房主</em>}
                    {member.bot && <em className="wt-tag bot">人机</em>}
                    {!member.connected && !member.bot && <em className="wt-tag warn">离线</em>}
                  </span>
                </div>
                {isHost && !member.isHost && (
                  <button className="kick-button" type="button" onClick={() => onKick(member.id)} title={`把 ${member.name} 移出房间`}>移出</button>
                )}
              </div>
            ))}
            {Array.from({ length: openSeats }, (_, index) => (
              <div className="wt-room-seat open" key={`open-${index}`}>
                <span className="empty-avatar"><span>＋</span></span>
                <div className="wt-room-seat-name"><strong>空座位</strong><span>{room.access.open ? "公开房间" : "等朋友加入"}</span></div>
                {isHost && <button className="quiet-button add-bot-button" type="button" onClick={onAddBot} disabled={busy} data-tutorial="add-bot">加人机</button>}
              </div>
            ))}
          </div>
          <SeatSwitch room={room} />
          <div className="wt-start">
            {isHost ? (
              <button className="primary-button wt-start-button" type="button" onClick={onStart} disabled={busy || room.members.length < 2} data-tutorial="start">
                {busy ? <><span className="spinner" /> 正在开始</> : "开始对局"}
              </button>
            ) : (
              <div className="host-wait-note"><span className="pulse-dot" /> {spectating ? "等房主开始，开始后在这里观战" : "等房主开始对局"}</div>
            )}
            <p className="field-hint">
              {isHost && room.members.length < 2 ? `还差 ${2 - room.members.length} 位玩家，可以点空座位上的「加人机」。` : "每回合 90 秒；超时人机替你交，连续 2 次转托管。"}
            </p>
          </div>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {notice && !error && <p className="feedback feedback-success" role="status">{notice}</p>}
        </section>

        <section className="wt-room-side">
          {!spectating && tutorialEntry}
          <div className="room-panel wt-room-kinds">
            <div className="panel-label">6 种行动 <span>号码和行动一组一起选</span></div>
            <ActionKinds />
          </div>
          <div className="wt-room-chat">{chat}</div>
        </section>
      </div>
    </main>
  );
}

export default App;
