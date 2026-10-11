// 浏览器实打一局：网页建 3 人房、加 2 个人机、开局，脚本像真人一样点（每种行动都用一次、撤回一次、中途刷新一次），
// 打到终局、点「再来一局」看新的一局开始。沿途截图。
// 用法（先起服务器和 vite）：node scripts/play-ui.mjs <输出目录> [宽 高]
//   服务器：cd apps/server && PORT=3027 TURN_MS=20000 BOT_DELAY_SCALE=0.15 npx tsx src/index.ts
import puppeteer from "/Users/pp/projects/qa-reports/tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";

const [out = "/tmp/wt-play", wArg = "1440", hArg = "790"] = process.argv.slice(2);
const BASE = process.env.BASE ?? "http://localhost:5298/";
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const log = [];
const say = (...parts) => { const line = parts.join(" "); log.push(line); console.log(line); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: Number(wArg), height: Number(hArg) });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
  const setInput = (sel, v) => page.evaluate((s, value) => {
    const el = document.querySelector(s);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, sel, v);
  const clickText = (sel, t) => page.evaluate((s, text) => { const el = [...document.querySelectorAll(s)].find((n) => n.textContent.includes(text) && !n.disabled); el?.click(); return !!el; }, sel, t);
  const click = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el && !el.disabled) { el.click(); return true; } return false; }, sel);

  await page.goto(BASE, { waitUntil: "networkidle0" });
  await setInput("#player-name", "实测甲");
  await clickText(".capacity-option", "3");
  await clickText("button.primary-button", "创建房间");
  await page.waitForSelector(".room-code-display");
  const code = await page.$eval(".room-code-display", (el) => el.textContent.slice(0, 6));
  say("房间码", code);
  await click("[data-tutorial=add-bot]");
  await sleep(300);
  await click("[data-tutorial=add-bot]");
  await sleep(500);
  await shot("01-waiting");
  await click("[data-tutorial=start]");
  await page.waitForSelector(".wt-screen");
  say("开局");

  const used = new Set();
  let reloaded = false;
  let retracted = false;
  let rounds = 0;
  let rematched = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60_000) {
    await sleep(250);
    const st = await page.evaluate(() => ({
      final: !!document.querySelector(".wt-final"),
      round: Number(document.querySelector(".wt-screen")?.dataset.round ?? 0),
      canPick: [...document.querySelectorAll("button.wt-combo")].filter((b) => !b.disabled).length,
      submitted: !!document.querySelector("[data-tutorial=submitted]"),
      refuse: !!document.querySelector("[data-tutorial=refuse]"),
      board: !!document.querySelector(".wt-screen"),
      combos: [...document.querySelectorAll(".wt-combo")].map((b) => ({ act: b.querySelector(".wt-combo-info b")?.textContent, ok: b.tagName === "BUTTON" && !b.disabled })),
    }));
    if (!st.board) continue;
    if (st.final) {
      if (!rematched) {
        await shot("90-final");
        const text = await page.$eval(".wt-final", (el) => el.textContent.slice(0, 120));
        say("终局：", text.replace(/\s+/g, " "));
        await clickText(".wt-final button", "再来一局");
        rematched = true;
      }
      continue;
    }
    if (rematched) {
      if (st.round === 1) { say("再来一局：新的一局第 1 回合开始"); await shot("91-rematch"); break; }
      continue;
    }
    if (st.refuse) {
      await click("[data-tutorial=submit]");
      say(`第 ${st.round} 回合：拒批`);
      used.add("拒批");
      await sleep(400);
      continue;
    }
    if (st.submitted || st.canPick === 0) continue;
    // 先挑还没用过的行动
    const order = st.combos.map((c, i) => ({ ...c, i })).filter((c) => c.ok).sort((a, b) => Number(used.has(a.act)) - Number(used.has(b.act)));
    const pick = order[0];
    if (!pick) continue;
    await page.evaluate((i) => document.querySelectorAll(".wt-combo")[i].click(), pick.i);
    await sleep(150);
    if (pick.act === "临时工") {
      await page.evaluate(() => { const b = [...document.querySelectorAll("[data-temp]")].find((x) => x.dataset.temp === "1") ?? document.querySelector("[data-temp]"); b?.click(); });
      await sleep(120);
      const legal = await page.$$eval("button.wt-lot.legal", (els) => els.length);
      if (!legal) { await page.evaluate(() => document.querySelector("[data-temp].on")?.click()); await sleep(120); }
    }
    const spots = await page.$$eval("button.wt-lot.legal", (els) => els.map((e) => e.dataset.house));
    if (!spots.length) { say("没有亮着的空地？", pick.act); await click(".wt-buttons .quiet-button"); continue; }
    // 大概按数字位置挑：取中间那个
    const spot = spots[Math.floor(spots.length / 2)];
    await page.evaluate((key) => document.querySelector(`button.wt-lot[data-house="${key}"]`).click(), spot);
    await sleep(150);
    if (pick.act === "栅栏") await click("button.wt-fence-slot");
    if (pick.act === "改造") await click("button.wt-estate-col");
    if (pick.act === "bis") await click("button.wt-lot.bis-target");
    await sleep(120);
    if (!used.has(pick.act)) await shot(`r${String(st.round).padStart(2, "0")}-${pick.act}`);
    used.add(pick.act);
    const plans = await page.$$eval("[data-tutorial=plan-claim] input", (els) => els.length);
    if (plans) say(`第 ${st.round} 回合：能验证目标卡（${plans} 个勾选框）`);
    const ok = await click("[data-tutorial=submit]");
    rounds += 1;
    say(`第 ${st.round} 回合：${pick.act}，填在 ${spot}${ok ? "" : "（提交按钮不能点！）"}`);
    await sleep(300);
    if (!retracted && st.round >= 3) {
      retracted = await click("[data-tutorial=retract]");
      await sleep(300);
      const restored = await page.$$eval(".wt-lot.draft", (els) => els.length);
      say("撤回：", retracted ? `成功，草稿恢复 ${restored} 格` : "没找到撤回按钮（可能已经结算）");
      if (retracted) await click("[data-tutorial=submit]");
    }
    if (!reloaded && st.round >= 5) {
      reloaded = true;
      await shot("50-before-reload");
      await page.reload({ waitUntil: "networkidle0" });
      const r0 = Date.now();
      let back = false;
      while (Date.now() - r0 < 100_000) {
        await sleep(500);
        back = await page.evaluate(() => !!document.querySelector(".wt-screen") && !!document.querySelector(".wt-player.viewing"));
        if (back) break;
      }
      say("刷新页面：", back ? `回到座位，用了 ${Math.round((Date.now() - r0) / 100) / 10} 秒` : "没回到座位！");
      await shot("51-after-reload");
    }
  }
  say("用过的行动：", [...used].join("、"), "；我交了", rounds, "手");
  say("页面报错：", errors.length ? errors.join(" | ") : "无");
} finally {
  await browser.close();
}
fs.writeFileSync(`${out}/log.txt`, log.join("\n"));
