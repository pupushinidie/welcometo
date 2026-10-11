// 本地测试用的陪玩机器人（先 npm run dev）。
//   node scripts/test-bot.mjs host [人数] [机器人数]  → 机器人建房、拉够机器人，等真人加入凑满后自动开局
//   node scripts/test-bot.mjs join <房间码> [昵称]   → 以一个机器人身份加入别人的房间
// 机器人轮到自己时：随机挑一种走法；推进后按「再掷爆掉的概率」和本回合掷了几次决定收手还是再掷。
// 环境变量 BOT_DELAY_MS 控制每步的思考时间（默认 1500），BOT_IDLE=1 时只挂着不动（等超时自动处理），
// BOT_GREEDY=1 时更贪（更晚收手，方便看爆掉的动画）。
import { io } from "socket.io-client";
import { bustProbability, legalActions } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? "http://localhost:3027";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1500);
const IDLE = process.env.BOT_IDLE === "1";
const GREEDY = process.env.BOT_GREEDY === "1";
const NAMES = ["岩羊", "雪豹", "山鹰", "牦牛"];

/** 推进后：爆掉概率越高、本回合已经掷得越多，越倾向收手；能登顶就收手。 */
function decide(game) {
  const atTop = game.runners.some((runner) => runner.height >= ({ 2: 3, 3: 5, 4: 7, 5: 9, 6: 11, 7: 13, 8: 11, 9: 9, 10: 7, 11: 5, 12: 3 })[runner.column]);
  if (atTop && !GREEDY) return { type: "STOP" };
  const risk = bustProbability(game);
  const appetite = GREEDY ? 0.6 : 0.35;
  return risk + game.rollsThisTurn * 0.05 > appetite + Math.random() * 0.15 ? { type: "STOP" } : { type: "ROLL" };
}

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  let latest = null;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  // 回执和新状态的广播可能在同一批消息里到达：每做完一步都回头看最新状态，免得漏掉轮到自己。
  async function tick() {
    const room = latest;
    const game = room?.game;
    if (!game || game.phase === "finished" || IDLE || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    if (!seat || legalActions(game, seat).length === 0) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, DELAY));
    try {
      const actions = legalActions(game, seat);
      const command = game.stage === "decide" ? decide(game) : actions[Math.floor(Math.random() * actions.length)];
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
    if (game?.phase === "finished") {
      const scores = game.players.map((player) => `${player.name}:${player.score}`).join(" ");
      console.log(name, "游戏结束，登顶数", scores, "胜者", game.finalResult?.winner);
      setTimeout(() => process.exit(0), 200);
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
