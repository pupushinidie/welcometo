// 欢迎来到「新手教程」走查（先起 vite：cd apps/web && npx vite；练习局不连服务器）。
// 用法：node scripts/tut-walk.mjs <输出目录> [尺寸=1440] [主题=night]
//   首页邀请卡 → 剧本每一步（按 TUTORIAL_STEPS 逐步核对文字）；do 步骤按阶段一下一下点（选组 → 改号码 → 空地 → 行动 → 确认提交），
//   每个阶段量：高亮在不在、套没套在对的东西上、看不看得见、教练框挡没挡住、文字截没截断、字号、滚动、能不能跳过；
//   第一个 do 步骤先点一个不该点的组，看是不是被拦下 → 练习局跟着「提示」打到终局 → 结算框按钮 → 回首页只剩「再看一遍」。
//   SHORT=1 只走到练习局开头。结果写进 <输出目录>/<尺寸>-<主题>.json，截图 <输出目录>/<尺寸>-<主题>-<序号>-<步骤>.png。
import puppeteer from "/Users/pp/projects/qa-reports/tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";

const [out = "/tmp/wt-tut", sizeArg = "1440", theme = "night"] = process.argv.slice(2);
const SIZES = { "1440": [1440, 790], "1920": [1920, 960], "1024": [1024, 690], "390": [390, 664] };
const [w, h] = SIZES[sizeArg];
const mobile = sizeArg === "390";
const base = process.env.BASE ?? "http://localhost:5298/";
const repo = process.env.REPO ?? `${process.env.HOME}/projects/welcometo`;
const { TUTORIAL_STEPS, stageAnchor } = await import(`${repo}/packages/game/dist/index.js`);
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const tag = `${sizeArg}-${theme}`;
const checks = [];
const steps = [];
const problems = [];
const check = (ok, what) => checks.push(`${ok ? "✓" : "✗"} ${what}`);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await page.evaluateOnNewDocument((t) => {
    if (!sessionStorage.getItem("wt-tut-init")) {
      sessionStorage.setItem("wt-tut-init", "1");
      localStorage.clear();
      localStorage.setItem("gm-pixel-theme", t);
    }
  }, theme === "day" ? "day" : "night");
  page.on("pageerror", (e) => problems.push(`ERR ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon") && !m.text().includes("socket")) problems.push(`console ${m.text().slice(0, 160)}`); });
  let n = 0;
  const shot = async (name) => { n += 1; const file = `${out}/${tag}-${String(n).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: file }); return file.split("/").pop(); };
  const exists = (s) => page.evaluate((sel) => Boolean(document.querySelector(sel)), s);
  const press = async (selector) => {
    await page.waitForSelector(selector, { visible: true, timeout: 10000 });
    if (mobile) await page.tap(selector);
    else await page.click(selector);
  };
  const measure = (anchor) => page.evaluate((name) => {
    const vw = innerWidth;
    const vh = innerHeight;
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const d = r(document.querySelector(".tut-dock"));
    const g = r(document.querySelector(".tut-ring"));
    const inter = (a, b) => (a && b ? Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y)) : 0);
    const a = name ? r(document.querySelector(`[data-tutorial="${name}"]`)) : null;
    const seen = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const fonts = [...document.querySelectorAll(".tut-dock .tut-say, .tut-dock .tut-note, .tut-dock .tut-flash, .tut-dock button")].filter(seen).map((el) => ({ cls: el.className, size: parseFloat(getComputedStyle(el).fontSize) }));
    const truncated = [...document.querySelectorAll(".tut-dock .tut-say, .tut-dock .tut-note, .tut-dock button")].some((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    const main = document.querySelector(".wt-main");
    return {
      say: document.querySelector(".tut-say")?.textContent ?? "",
      anchor: name, found: Boolean(a && a.w > 0), ring: Boolean(g),
      ringOnTarget: a && g ? inter(a, g) >= 0.8 * a.w * a.h : null,
      targetInView: a ? a.x >= -2 && a.y >= -2 && a.r <= vw + 2 && a.b <= vh + 2 : null,
      covers: a && d ? inter(a, d) : 0,
      dockInView: d ? d.x >= 0 && d.y >= 0 && d.r <= vw && d.b <= vh : null,
      sayPx: fonts.find((f) => f.cls.includes("tut-say"))?.size ?? null,
      minPx: fonts.length ? Math.min(...fonts.map((f) => f.size)) : null,
      truncated,
      dy: document.documentElement.scrollHeight - vh,
      inner: main ? main.scrollHeight - main.clientHeight : 0,
      skip: Boolean(document.querySelector(".tut-dock .tut-link")) || [...document.querySelectorAll(".tut-dock button")].some((b) => b.textContent.includes("结束教程")),
    };
  }, anchor);
  const waitSay = async (text) => {
    try {
      await page.waitForFunction((t) => (document.querySelector(".tut-say")?.textContent ?? "") === t, { timeout: 30000 }, text);
    } catch (error) {
      const state = await page.evaluate(() => ({ say: document.querySelector(".tut-say")?.textContent, flash: document.querySelector(".tut-flash")?.textContent, panel: document.querySelector(".wt-panel")?.textContent?.slice(0, 160) }));
      console.log("等不到：", text, JSON.stringify(state));
      await shot("stuck");
      throw error;
    }
    await sleep(600);
  };
  const waitRing = async (anchor) => {
    await page.waitForFunction((name) => {
      const ring = document.querySelector(".tut-ring")?.getBoundingClientRect();
      const el = document.querySelector(`[data-tutorial="${name}"]`)?.getBoundingClientRect();
      return ring && el && el.width > 0 && Math.abs(ring.left + ring.width / 2 - (el.left + el.width / 2)) < 6 && Math.abs(ring.top + ring.height / 2 - (el.top + el.height / 2)) < 6;
    }, { timeout: 8000 }, anchor).catch(() => problems.push(`高亮没挪到 ${anchor}`));
    await sleep(450);
  };

  await page.goto(base, { waitUntil: "networkidle0" });
  await sleep(800);
  check(await exists(".tut-invite"), "第一次来：首页有邀请卡");
  const homeDy = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  check(mobile || homeDy <= 0, `首页加了邀请卡后不滚动（dy=${homeDy}）`);
  await shot("home");
  await press(".tut-invite-go");
  let triedWrong = false;
  for (const step of TUTORIAL_STEPS) {
    await waitSay(step.say);
    const finale = step.kind === "info" && step.finale === true;
    if (step.kind === "do") {
      const move = step.expect.command.submission.move;
      const stages = ["combo", ...(move.temp !== undefined ? ["temp"] : []), "house", ...(move.fence || move.improve !== undefined || move.bis ? ["action"] : []), "submit"];
      for (const stage of stages) {
        const anchor = stageAnchor(move, stage);
        await waitRing(anchor);
        const m = await measure(anchor);
        const file = stage === "combo" || stage === "action" || stage === "temp" ? await shot(`${step.id}-${stage}`) : "";
        steps.push({ id: `${step.id}:${stage}`, ...m, file });
        if (!triedWrong && stage === "combo") {
          triedWrong = true;
          const other = `combo-${((move.combo + 1) % 3) + 1}`;
          await page.evaluate((name) => document.querySelector(`[data-tutorial="${name}"]`)?.click(), other);
          await sleep(300);
          const flash = await page.evaluate(() => document.querySelector(".tut-flash")?.textContent ?? "");
          const stayed = await page.evaluate(() => !document.querySelector(".wt-combo.selected"));
          check(flash.includes("照我说的") && stayed, `点了别的组被拦下（红字：${flash}）`);
          await shot("wrong");
          await sleep(2700);
        }
        if (anchor.startsWith("house:") && stage === "action") {
          await page.evaluate((name) => document.querySelector(`[data-tutorial="${name}"]`)?.click(), anchor);
        } else {
          await press(`[data-tutorial="${anchor}"]`);
        }
        await sleep(250);
      }
    } else {
      const candidates = !step.anchor ? [] : typeof step.anchor === "string" ? [step.anchor] : step.anchor;
      const m = await measure(candidates[0] ?? null);
      const file = await shot(step.id);
      steps.push({ id: step.id, ...m, file });
      if (finale) break;
      if (step.kind === "info") await press(".tut-dock .tut-main");
    }
  }
  check(await page.evaluate(() => localStorage.getItem("gm-tutorial-welcometo") === "done"), "走到最后一步记为学完");
  await page.evaluate(() => [...document.querySelectorAll(".tut-dock button")].find((b) => b.textContent.includes("打完这局"))?.click());
  for (let i = 0; i < 30 && !(await exists('[data-tutorial="hint"]')); i += 1) await sleep(500);
  check(await exists('[data-tutorial="hint"]'), "练习局：有「提示」按钮");
  await shot("practice");
  if (!process.env.SHORT) {
    let rounds = 0;
    const t0 = Date.now();
    while (!(await exists(".wt-final")) && Date.now() - t0 < 240_000) {
      await sleep(400);
      if (await exists("[data-tutorial=refuse]")) { await page.click("[data-tutorial=submit]"); rounds += 1; continue; }
      if (await exists("[data-tutorial=submitted]")) continue;
      if (!(await exists('[data-tutorial="hint"]'))) continue;
      await page.click('[data-tutorial="hint"]');
      await sleep(250);
      if (rounds === 0) {
        const hint = await page.evaluate(() => document.querySelector(".wt-hint")?.textContent ?? "");
        check(hint.length > 6, `提示给出理由：${hint.slice(0, 60)}`);
        await shot("hint");
      }
      if (await exists('[data-tutorial="submit"]:not([disabled])')) { await page.click('[data-tutorial="submit"]'); rounds += 1; }
    }
    check(await exists(".wt-final"), `练习局跟着提示打到终局（我交了 ${rounds} 手）`);
    await shot("final");
    check(await exists('.wt-final [data-tutorial="again"]') && await exists('.wt-final [data-tutorial="end"]'), "结算框有「再练一局」「结束教程」");
    await page.click('.wt-final [data-tutorial="end"]');
    await sleep(800);
    check(!(await exists(".tut-invite-go")) || await page.evaluate(() => document.querySelector(".tut-invite")?.textContent.includes("再看一遍") ?? true), "回首页后只剩「再看一遍」");
  }
  const bad = steps.filter((s) => (s.anchor && !s.found) || s.ringOnTarget === false || s.targetInView === false || s.covers > 0 || s.truncated || (s.sayPx !== null && s.sayPx < 24) || (s.minPx !== null && s.minPx < 12) || (!mobile && (s.dy > 0 || s.inner > 0)) || !s.skip && !s.id.startsWith("finale"));
  check(bad.length === 0, `每一步：高亮套在目标上、看得见、不被挡、不截断、主句 24px、无滚动（有问题的 ${bad.length} 步：${bad.map((s) => s.id).join("、")}）`);
  fs.writeFileSync(`${out}/${tag}.json`, JSON.stringify({ checks, problems, steps }, null, 1));
  console.log(`${tag}：${steps.length} 个量点`);
  for (const line of checks) console.log("  " + line);
  if (problems.length) console.log("  问题：" + [...new Set(problems)].join(" | "));
  for (const s of bad.slice(0, 6)) console.log("  ✗", s.id, JSON.stringify({ found: s.found, onTarget: s.ringOnTarget, inView: s.targetInView, covers: s.covers, trunc: s.truncated, dy: s.dy, inner: s.inner, sayPx: s.sayPx }));
} finally {
  await browser.close();
}
