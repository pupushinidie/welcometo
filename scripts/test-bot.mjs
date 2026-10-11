// 本地测试用的陪玩机器人（先 npm run dev）。
//   node scripts/test-bot.mjs host [人数] [机器人数]  → 机器人建房、拉够机器人，等真人加入凑满后自动开局
//   node scripts/test-bot.mjs join <房间码> [昵称]   → 以一个机器人身份加入别人的房间
// 每回合没交时：用规则包里的人机（botCommand，只看自己能看到的状态）交一手；人机不给就交兜底的一手。
// 环境变量：BOT_DELAY_MS 每步思考时间（默认 1500）；BOT_IDLE=1 只挂着不动（等超时由服务器的人机代做）；
// BOT_RANDOM=1 随机交（方便看拒批、终局）；BOT_EXIT=1 打完一局就退出（默认自动同意再来一局）；SERVER_URL（默认 http://localhost:3027）、SOCKET_PATH（默认 /socket.io）。
import { io } from "socket.io-client";
import { botCommand, createRng, fallbackSubmission, randomSubmission } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? "http://localhost:3027";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1500);
const IDLE = process.env.BOT_IDLE === "1";
const RANDOM = process.env.BOT_RANDOM === "1";
const EXIT = process.env.BOT_EXIT === "1";
const NAMES = ["阿花", "老王", "小美", "大刘", "二丫", "三毛"];
const rng = createRng(Date.now() % 100000);

function choose(game, seat) {
  if (RANDOM) return randomSubmission(game, seat, rng);
  return botCommand(game, seat) ?? fallbackSubmission(game, seat);
}

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  let endedAt = -1;
  let latest = null;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  // 回执和新状态的广播可能在同一批消息里到达：每做完一步都回头看最新状态，免得漏掉轮到自己。
  async function tick() {
    const room = latest;
    const game = room?.game;
    if (!game || game.phase !== "play" || IDLE || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    const me = game.players.find((player) => player.id === seat);
    if (!seat || !me || me.submitted) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, DELAY));
    try {
      const current = latest?.game;
      if (!current || current.phase !== "play" || current.players.find((player) => player.id === seat)?.submitted) return;
      const command = { type: "submit", submission: choose(current, seat), step: `r${current.round}` };
      const result = await emit("game:command", command);
      if (!result.ok) console.log(name, "行动失败", result.error);
    } finally {
      acting = false;
    }
    if (latest !== room) void tick();
  }
  socket.on("room:updated", (room) => {
    latest = room;
    onRoom?.(room, socket);
    const game = room.game;
    if (game?.phase === "gameOver") {
      const scores = game.players.map((player) => `${player.name}:${game.finalResult.scores[player.id].total}`).join(" ");
      if (endedAt !== game.version) {
        endedAt = game.version;
        console.log(name, "游戏结束", scores, "胜者", game.finalResult.winners.join(","), "原因", game.finalResult.reasons.join(","));
        if (EXIT) setTimeout(() => process.exit(0), 200);
        // 自动同意再来一局（真人点了「再来一局」就接着打）
        else void emit("room:rematch", true);
      }
      return;
    }
    void tick();
  });
  socket.on("room:closed", ({ reason }) => { console.log(name, "房间关闭：", reason); process.exit(0); });
  return { socket, emit };
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === "join") {
  const { socket, emit } = bot(arg2 ?? NAMES[0]);
  socket.on("connect", async () => console.log("join", (await emit("room:join", { name: arg2 ?? NAMES[0], code: arg1 })).ok));
} else {
  const capacity = Number(arg1 ?? 2);
  const bots = Number(arg2 ?? capacity - 1);
  let started = false;
  const host = bot(NAMES[0], async (room, socket) => {
    if (!started && room.status === "waiting" && room.members.length === capacity) {
      started = true;
      const result = await host.emit("room:start");
      console.log("开局", result.ok || result.error);
    }
    void socket;
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity });
    if (!created.ok) { console.log(created.error); process.exit(1); }
    console.log("房间码", created.data.code);
    for (let index = 1; index < bots; index += 1) {
      const name = NAMES[index];
      const other = bot(name);
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
