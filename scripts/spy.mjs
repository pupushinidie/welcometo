// 抓包：连上真实服务器，两个 socket 坐进同一桌（甲、乙），乙记下服务器发给它的每一条 room:updated，
// 检查里面没有：甲这回合交的那一手（结算前）、牌堆顺序（draw）、种子、随机数状态、动作序列。
// 用法（先起服务器）：node scripts/spy.mjs [回合数，默认 6]；SERVER_URL 默认 http://localhost:3027。
import { io } from "socket.io-client";
import { fallbackSubmission } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? "http://localhost:3027";
const ROUNDS = Number(process.argv[2] ?? 6);
const connect = () => new Promise((resolve) => { const s = io(URL, { transports: ["websocket"] }); s.on("connect", () => resolve(s)); });
const emit = (s, event, ...args) => new Promise((resolve) => s.emit(event, ...args, resolve));
const a = await connect();
const b = await connect();
const received = [];
let latestA = null;
let latestB = null;
a.on("room:updated", (room) => { latestA = room; });
b.on("room:updated", (room) => { latestB = room; received.push(room); });
const created = await emit(a, "room:create", { name: "间谍甲", capacity: 2 });
await emit(b, "room:join", { name: "间谍乙", code: created.data.code });
await emit(a, "room:start");
const wait = (test) => new Promise((resolve) => { const t = setInterval(() => { if (test()) { clearInterval(t); resolve(); } }, 20); });
await wait(() => latestA?.game && latestB?.game);
let aPendingSeen = 0;
for (let round = 1; round <= ROUNDS && latestA.game.phase === "play"; round += 1) {
  const sa = fallbackSubmission(latestA.game, "p1");
  await emit(a, "game:command", { type: "submit", submission: sa });
  await wait(() => latestB.game.players[0].submitted || latestB.game.round > round);
  if (latestA.game.players[0].pending) aPendingSeen += 1;
  await new Promise((r) => setTimeout(r, 50));
  const sb = fallbackSubmission(latestB.game, "p2");
  await emit(b, "game:command", { type: "submit", submission: sb });
  await wait(() => latestB.game.round > round || latestB.game.phase !== "play");
}
const problems = [];
for (const room of received) {
  const game = room.game;
  if (!game) continue;
  for (const key of ["seed", "rngState", "log"]) if (key in game) problems.push(`有 ${key}`);
  if (game.stacks.some((stack) => stack.draw.length > 0)) problems.push("有牌堆顺序");
  if (game.players[0].pending !== null) problems.push(`第 ${game.round} 回合看到了甲交的一手`);
}
console.log(`乙收到 ${received.length} 条 room:updated，甲交了 ${aPendingSeen} 次（甲自己看得到），检查出的问题：${problems.length ? [...new Set(problems)].join("；") : "无"}`);
await emit(a, "room:dissolve");
a.close(); b.close();
process.exit(problems.length ? 1 : 0);
