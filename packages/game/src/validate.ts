/**
 * 不变量检查（随机对局测试、模拟脚本用）：返回发现的问题，空数组 = 没问题。只用于服务端完整状态。
 */
import {
  BIS_TRACK,
  DECK_SIZE,
  ESTATE_TRACKS,
  MAX_NUMBER,
  MAX_REFUSALS,
  MIN_NUMBER,
  PARK_TRACKS,
  POOL_SLOTS,
  STREET_LENGTHS,
  TEMP_MAX,
} from "./data.js";
import { segments } from "./sheet.js";
import type { GameState, Sheet } from "./types.js";

export function sheetProblems(sheet: Sheet, label = ""): string[] {
  const problems: string[] = [];
  const say = (text: string) => problems.push(`${label}${text}`);
  sheet.houses.forEach((row, street) => {
    if (row.length !== STREET_LENGTHS[street]) say(`街 ${street + 1} 长度不对`);
    let prev: { num: number; index: number; bis: boolean } | null = null;
    let runOriginals = 0;
    row.forEach((house, index) => {
      if (!house) {
        if (sheet.pools[street]![index]) say(`街 ${street + 1} 空位上有泳池`);
        return;
      }
      if (house.num < MIN_NUMBER || house.num > MAX_NUMBER) say(`号码越界 ${house.num}`);
      if (sheet.pools[street]![index] && !POOL_SLOTS[street]!.includes(index)) say(`非泳池位建了泳池`);
      if (prev) {
        if (house.num < prev.num) say(`街 ${street + 1} 不递增：${prev.num} → ${house.num}`);
        if (house.num === prev.num) {
          if (prev.index !== index - 1) say(`街 ${street + 1} 相同号码 ${house.num} 不挨着`);
          if (sheet.fences[street]![index - 1]) say(`街 ${street + 1} 相同号码之间有栅栏`);
          runOriginals += house.bis ? 0 : 1;
          if (runOriginals > 1) say(`街 ${street + 1} 号码 ${house.num} 重复且不是 bis`);
        } else {
          runOriginals = house.bis ? 0 : 1;
        }
      } else {
        runOriginals = house.bis ? 0 : 1;
      }
      prev = { num: house.num, index, bis: house.bis };
    });
  });
  const poolCount = sheet.pools.flat().filter(Boolean).length;
  if (poolCount !== sheet.poolTrack) say(`泳池轨 ${sheet.poolTrack} 和泳池数 ${poolCount} 不一致`);
  sheet.parks.forEach((count, street) => {
    if (count < 0 || count > PARK_TRACKS[street]!.length - 1) say(`公园越界`);
  });
  sheet.improve.forEach((count, size) => {
    if (count < 0 || count > ESTATE_TRACKS[size]!.length - 1) say(`改造越界`);
  });
  if (sheet.temps < 0 || sheet.temps > TEMP_MAX) say(`临时工越界`);
  if (sheet.bis < 0 || sheet.bis > BIS_TRACK.length - 1) say(`bis 越界`);
  const bisHouses = sheet.houses.flat().filter((house) => house?.bis).length;
  if (bisHouses !== sheet.bis) say(`bis 轨 ${sheet.bis} 和 bis 房 ${bisHouses} 不一致`);
  if (sheet.refusals < 0 || sheet.refusals > MAX_REFUSALS) say(`拒批越界`);
  const segs = segments(sheet);
  for (const used of sheet.usedEstates) {
    const seg = segs.find((candidate) => candidate.street === used.street && candidate.start === used.start && candidate.size === used.size);
    if (!seg || !seg.complete) say(`用过的小区不再是完成小区`);
    if (sheet.plans[used.plan] === null) say(`小区用在了没验证的卡上`);
  }
  return problems;
}

export function stateProblems(state: GameState): string[] {
  const problems: string[] = [];
  const ids = state.stacks.flatMap((stack) => [...stack.draw, ...stack.discard].map((card) => card.id));
  if (ids.length !== DECK_SIZE || new Set(ids).size !== DECK_SIZE) problems.push(`牌不守恒：${ids.length} 张`);
  for (const stack of state.stacks) {
    if (stack.draw.length !== stack.drawCount) problems.push("drawCount 不对");
    if (state.phase === "play" && stack.draw.length === 0) problems.push("对局中有空牌堆");
  }
  if (state.phase === "play" && state.combos.length !== 3) problems.push("对局中不是 3 组");
  state.plans.forEach((plan, index) => {
    const scored = state.players.map((player) => player.sheet.plans[index]).filter((value) => value !== null);
    if (scored.length > 0 && plan.approvedRound === null) problems.push(`目标卡 ${index + 1} 有人验证了却没翻面`);
    for (const value of scored) if (value !== plan.high && value !== plan.low) problems.push(`目标卡 ${index + 1} 分值不对 ${value}`);
  });
  for (const player of state.players) problems.push(...sheetProblems(player.sheet, `${player.name}：`));
  if (state.phase === "gameOver" && !state.finalResult) problems.push("终局没有结果");
  return problems;
}
