# 欢迎来到

1–6 人同时「翻牌填表」的郊区建房桌游，网页联机版。每回合翻出 3 组「门牌号 + 行动」，所有人同时选一组，把号码写进自己表上的三条街（从左到右越来越大），再用行动画栅栏围小区、建公园泳池、改造升值、雇临时工改号码、bis 复制房号；抢先完成中间 3 张目标卡拿高分。总分最高的人赢。名字、美术和规则说明文字都是自己的（不用原版商标和美术）。

线上地址：<https://gulugagame.com/welcometo/>（端口 3027 / 5298，pm2 名 welcometo）

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3027，网页 :5298（WEB_PORT / SERVER_PORT 可改，另起一套用）
npm test             # 规则包 + 服务器
npm run typecheck
BASE_PATH=/welcometo/ npm run build
```

- 一个人测试：`node scripts/test-bot.mjs host 3 2` 让两个陪玩机器人建一个 3 人房并打印房间码，你在网页里用房间码加入凑满后自动开局；它们用规则包里的人机交每一手，打完自动同意再来一局。`node scripts/test-bot.mjs join <房间码>` 加入别人的房间。环境变量：`BOT_DELAY_MS`（思考时间，默认 1500）、`BOT_IDLE=1`（挂着不动，等超时）、`BOT_RANDOM=1`（随机交，方便看拒批和终局）、`BOT_EXIT=1`（打完一局就退出）。`BOT_EXIT=1 BOT_DELAY_MS=30 node scripts/test-bot.mjs host 3 3` 是三个机器人自己打完一整局。
- 抓包：`node scripts/spy.mjs [回合数]` 让两个 socket 坐进同一桌，检查发给乙的每一条数据里没有甲还没结算的那一手、牌堆顺序、种子和动作序列。

## 规则（自己的话）

**配件**：81 张建造牌（正面门牌号 1–15、背面 6 种行动之一，配对是固定的）分成 3 堆；18 张目标卡分 n°1 / n°2 / n°3 三档，每局每档抽 1 张；每人一张表：三条街 10 / 11 / 12 房，共 33 房、9 个泳池位，下面是计分区。

**每回合**（全员同时，没有轮流）：
1. 三堆各翻开一张。每一组 = 这堆露出的那张的**号码** + 刚翻开那张的**行动**。
2. 每人选一组（可以和别人选同一组），把号码写进自己任意一条街的空房：同一条街从左到右必须越来越大，可以跳号、可以先空着。
3. 可以用这组的行动（可选）：
   - **栅栏**：在任意一条街两房之间画一道栅栏。两道栅栏之间填满的 1–6 座房是一个「完成小区」，7 座以上不算。
   - **改造**：在某个小区尺寸列勾一格，这个尺寸的小区单价涨一档。
   - **公园**：在写号码的那条街勾一格公园。
   - **泳池**：号码写进带泳池的房子时，泳池建成、泳池轨勾一格。
   - **临时工**：写之前把号码 ±1 或 ±2（0–17），勾一格临时工；不改也可以勾（±0）。
   - **bis**：把任意一座已填房子的号码复制到它旁边的空房（标 B），勾一格 bis（扣分）。
4. 3 组号码（算上临时工的 ±2）都写不进去时**拒批**：不写号码、不用行动，拒批轨勾一格。能写就不能拒批。
5. 完成目标卡就可以**验证**（也可以晚点再验）：同一回合首批验证的人都拿项目面高分，之后的人只拿获批面低分；用过的小区锁定，不能再拆、不能再给别的卡用。
6. 全员都交了，服务器一次性结算所有人，再翻下一回合。

**结束**：本回合结算完后，有人拒批满 3 次、或验证完 3 张目标卡、或 33 房填满，游戏结束。

**计分**：目标卡 + 每条街公园 + 泳池 + 临时工多数（最多 7、第二 4、第三 1，并列同档，按不同的格数排）+ 每个尺寸的完成小区数 × 单价 − bis − 拒批。所有轨道都取「还没勾掉的最小值」。平分时比完成小区多的，再比 1 房小区多的、2 房……全平就并列获胜。

数值全部按 `~/Desktop/游戏规则/欢迎来到-补充.md` 第一节（原规则书第 2、5、10 节的玩家表数值有错，作废），在 `packages/game/src/data.ts`。

### 默认规则表（规则书没写死的地方、开工拍板、全站约定）

| 情况 | 现在的做法 |
|---|---|
| 牌库版本 | 81 张原版（开工拍板）；63 张新版不做 |
| 一组的号码和行动 | 照实体版：号码来自这堆露出的那张，行动来自刚翻开的那张（补充 1.3）。下一回合的行动不显示（实体版那张的背面朝下，本来也看不到） |
| 某堆翻完 | 这堆其余翻过的牌洗成新堆（规则书 4.1），刚翻开的那张留着当本回合的行动 |
| 首个完成目标卡可选重洗 | 开工拍板：提交时的勾选框「如果我首个完成目标卡就重洗」。**每张目标卡**的首批验证者里只要有一人勾了，就在这回合结算后把 81 张全部收回洗匀、重新分 3 堆（下回合从新堆翻）。规则书原文是「第一个完成任意目标卡的人」，这里按「每张卡的首批完成者」做，一局最多可能重洗 3 次 |
| 目标卡用哪几个小区 | 服务器自动挑：每个要求的尺寸挑最靠左、还没用过的完成小区。同尺寸的小区对目标卡没有区别 |
| 同一手验证几张卡 | 可以，按 n°1→n°3 依次挑小区，不够分就拒绝 |
| 拒批轨 | 0, 0, 3, 5：勾 1 格罚 0、2 格罚 3、3 格罚 5 并结束 |
| bis 隔着栅栏 | 不行（两个相同号码之间永远不能有栅栏）；bis 写进泳池位不建泳池 |
| 行动用不上时 | 公园那条街满了、改造那列满了、临时工 11 格满了、bis 9 格满了：这个行动不能用，号码照样能写 |
| 进阶变体（环岛、进阶目标卡）、专家规则、单人 AI 公司 | 首版不做（开工拍板 / 规则书建议） |
| 人数 | 一桌 2–6 座（开工拍板最多 6 人）；一个人开房加人机凑够 2 座以上就能开局。规则包本身支持 1–6 人 |
| 表公开 | 所有人的表随时公开，可以切换查看别人的表；结算前别人只看到「已提交」 |
| 提交和撤回 | 一回合每人一次性提交「选组 + 填位 + 行动参数 + 验证目标卡 + 是否重洗」，全员交齐前随时撤回改交 |
| 每回合时限 | 90 秒（开工拍板），从上一回合结算动画放完算起；别人交 / 撤回不重置倒计时 |
| 超时 | 没交的人由人机（普通难度）替他交这一手（全站约定：不用规则书 8.4 的「填最左空位」简化版）；人机出错时交兜底的一手（最小号码填最左能填的位置，不能填就拒批）。连续 2 次超时转托管 |
| 托管和离线 | 托管 = 人机代打，自己动一下或点「取消托管」就交还；离线的人先等 3 秒，再由人机替他交（不算超时），用原昵称回来就交还 |
| 人机 | 只有「普通」难度，叫咕噜一号 / 二号……，带「人机」标签，总是同意再来一局 |
| 观战 | 观战看得到所有人的表；「这回合交了什么」和牌堆顺序永远看不到（即使房主打开「观战看全部」，免得场外报信） |

## 对外接口（规则包 `packages/game`）

- 引擎：`createGame(players, seed?, { plans?, stacks?, config? })`、`apply(state, playerId, command, rng) → { state, events }`（纯函数，不改输入）、`applyCommand(state, playerId, command, { auto })`（服务端：从 `state.rngState` 恢复随机数、记动作序列）、`checkSubmission(state, playerId, submission) → 原因 | null`、`timeoutTurn(state, policy)`、`waitingFor`、`stepKey`（`r<回合>`）、`redactGameForViewer` / `redactGameForSpectator`、`scoreAll`、`rankPlayers`、`animationMs`。
- 命令：`{ type: "submit", submission: { move: { combo, street, house, temp?, fence?: {street,pos}, improve?, park?, pool?, bis?: {street,house,from:-1|1} } | null, plans?: number[], reshuffle?: boolean }, step? }`、`{ type: "retract", step? }`。`move: null` = 拒批。
- 表上的纯函数（`sheet.ts`）：`canPlaceNumber`、`legalHouses`、`comboNumbers`、`mustRefuse`、`canFence` / `legalFences`、`canBis` / `legalBis`、`canPark`、`canImprove`、`segments` / `estates` / `estateCounts`、`pickEstates`、`applyMove`、`sheetAfter`、`scoreSheet`、`tempMajority`、`compareScores`。
- 枚举：`placements`、`actionVariants`、`legalMoves`、`claimablePlans`（`moves.ts`）。基线：`randomSubmission`、`greedySubmission`（`baseline.ts`）。不变量：`stateProblems`、`sheetProblems`。
- **预览局面工厂**（`scenes.ts`，界面预览页和教程用）：
  - `parseSheet({ streets: ["1 2 | 3 4 5p | _ _ _ _ _", …], parks, poolTrack, improve, temps, bis, refusals, plans, usedEstates })`：一行字写一条街，`_` 空、`7b` bis、`7p` 泳池建成、`|` 栅栏；`sheetToText` 反过来。
  - `buildGame({ players: [{ sheet, submitted }] | 人数, combos, plans, approved: {下标: 回合}, round, seed, drawLeft })`：任意精确局面（81 张守恒，能接着 `apply`）。
  - `createScene(name, { players, seed })`：`start` 开局、`fence` / `improve` / `park` / `pool` / `temp` / `bis` 每种行动之前、`plan` 能验证目标卡、`refuse` 必须拒批、`submitted` 我已交等别人、`approved` 别人刚首批验证、`mid` 中盘、`six` 6 人桌、`late` 后期、`gameover` 终局、`gameover-tie` 并列终局（`SCENE_NAMES`、`SCENE_DESCRIPTIONS`）。
  - `createSceneRoom(game, { viewer, spectator, offline, bots, auto, turnRemainingMs })`：包成房间快照（对手离线、人机、托管、观战、快超时），直接喂给 GameBoard。
  - `autoPlay(state, 回合数, seed, "greedy" | "random")`、`autoPlayToEnd`、`playRound`、`withSubmitted`、`finishScene`。

## 测试

- `packages/game/test/rulebook.test.ts`：规则书第 9 节 TC1–TC12（数值按补充文件；规则书两处笔误在测试名里写明）。
- `supplement.test.ts`：补充文件第一节逐条（街长、泳池位、各轨道、牌库配对和翻牌、目标卡、各条澄清、重洗）。
- `sections.test.ts`：规则书逐节的精确场景（开局、同时提交、每种行动、验证目标卡、逐项计分、终局、人数、超时）。
- `redaction.test.ts`：每个玩家视角和观战视角都拿不到牌堆、种子、别人交的内容。
- `random-1-3.test.ts`、`random-4-6.test.ts`：每种人数 300 局随机对局，每步查不变量。
- `scenes.test.ts`：预览局面工厂。
- `apps/server/test`：全流程（每种行动、验证目标卡、重洗、拒批到终局、再来一局）、计时 key、超时代做和转托管、重连、管理员解散、迟到的点击、限速、抓包；观战、挤登录、人机、离线代打。

## 目录

| 路径 | 内容 |
|---|---|
| `packages/game/src/data.ts` | 数值表（街、泳池位、轨道、81 张牌、18 张目标卡） |
| `packages/game/src/sheet.ts` | 表上的纯函数：能不能填、栅栏、bis、小区、目标卡、计分 |
| `packages/game/src/engine.ts` | 引擎：同时提交、一次结算、首批验证、重洗、终局、超时、隐藏信息 |
| `packages/game/src/moves.ts`、`baseline.ts`、`bot.ts` | 合法手枚举、基线策略、人机 |
| `packages/game/src/scenes.ts` | 预览局面工厂 |
| `apps/server` | Socket.IO 房间（从谁是牛头王的同时出牌版改来：每回合一个截止时间、别人交 / 撤回不重置、到点人机替没交的人交）、人机座位和托管、观战、挤登录、管理员解散、每局种子和动作序列写进 `logs/games.jsonl` |
| `apps/web` | 网页 |
| `art/` | 美术 agent 的出图脚本和规格（`art/spec.md`），定稿在 `apps/web/public/art/` |

## 新手教程

站内统一做法（`~/projects/pipeline/handbook/tutorial-notes.md`）：剧本局 + 练习局 + 「第一次遇到」小贴士，向导咕噜嘎。

- 剧本 `packages/game/src/tutorial.ts`（`TUTORIAL_STEPS`）：6 回合，依次教 选组填号码（递增）→ 小区 → 泳池 → 栅栏和目标卡（你和咕噜一号同回合首批完成 n°3，都拿 7 分）→ 临时工 → 改造 → bis，再讲拒批、结束、计分、托管。开局表先写了几个号码；3 堆前 7 张按剧本排好（`scripts/tutorial-deck.ts` 算的），两个咕噜每回合交什么也写死。剧本单测 `test/tutorial.test.ts`。
- 一个 do 步骤是交一整手：`stageOf / stageAnchor / stageAllows` 按界面草稿算出下一个要点的地方（选组 → 改号码 → 空地 → 行动 → 确认提交），GameBoard 的 `allow(what)` 拦下别的点击。
- 网页 `apps/web/src/tutorial/`：教练层（Coach、gulu、useTutorial、tips、storage、Invite，从谁是牛头王复制）+ 本游戏的 `TutorialMode.tsx`、`tutorialGame.ts`（小贴士）。入口在首页和等候房间，地址带 `?tutorial` 直接打开。
- 「提示」：练习局、或者只有自己和人机的房间里有，等于让人机从你的位置算一手（`botHint`），并把草稿摆好，还要你自己点确认。
- 走查：`scripts/tut-all.sh <输出目录>`（四种可视区域 × 夜/日，逐步量高亮、遮挡、字号、滚动；1440 夜间和 390 白天跟着提示把练习局打完）。

## 画面：白天版和夜间版

只有像素风一种画面，配色分夜间（深色，默认）和白天（白底）。白天版由 `apps/web/day-theme.ts` 按 `day-palette.ts` 从夜间样式生成，手调的写在 `src/theme-day.css`；选择记在 `gm-pixel-theme`，全站共用。
