/**
 * 玩家表上的纯函数：能不能填、栅栏、bis、小区、目标卡、计分。都不改输入。
 */
import {
  BIS_TRACK,
  ESTATE_TRACKS,
  MAX_ESTATE,
  MAX_NUMBER,
  MIN_NUMBER,
  PARK_TRACKS,
  POOL_SLOTS,
  POOL_TRACK,
  REFUSAL_TRACK,
  STREET_LENGTHS,
  TEMP_MAJORITY,
  TEMP_MAX,
} from "./data.js";
import type { Combo, House, Move, ScoreBreakdown, Sheet, UsedEstate } from "./types.js";

export function emptySheet(): Sheet {
  return {
    houses: STREET_LENGTHS.map((length) => Array.from({ length }, () => null)),
    fences: STREET_LENGTHS.map((length) => Array.from({ length: length - 1 }, () => false)),
    pools: STREET_LENGTHS.map((length) => Array.from({ length }, () => false)),
    parks: [0, 0, 0],
    poolTrack: 0,
    improve: [0, 0, 0, 0, 0, 0],
    temps: 0,
    bis: 0,
    refusals: 0,
    plans: [null, null, null],
    usedEstates: [],
  };
}

export function cloneSheet(sheet: Sheet): Sheet {
  return {
    houses: sheet.houses.map((street) => street.slice()),
    fences: sheet.fences.map((street) => street.slice()),
    pools: sheet.pools.map((street) => street.slice()),
    parks: sheet.parks.slice(),
    poolTrack: sheet.poolTrack,
    improve: sheet.improve.slice(),
    temps: sheet.temps,
    bis: sheet.bis,
    refusals: sheet.refusals,
    plans: sheet.plans.slice(),
    usedEstates: sheet.usedEstates.slice(),
  };
}

export function isPoolSlot(street: number, house: number): boolean {
  return POOL_SLOTS[street]?.includes(house) ?? false;
}

export function filledCount(sheet: Sheet): number {
  let count = 0;
  for (const street of sheet.houses) for (const house of street) if (house) count += 1;
  return count;
}

function validSpot(street: number, house: number): boolean {
  return Number.isInteger(street) && street >= 0 && street < STREET_LENGTHS.length
    && Number.isInteger(house) && house >= 0 && house < STREET_LENGTHS[street]!;
}

/** 普通填数字：位置是空的，左边所有已填的都比它小，右边所有已填的都比它大（同一条街不能重复，bis 除外）。 */
export function canPlaceNumber(sheet: Sheet, street: number, house: number, num: number): boolean {
  if (!validSpot(street, house) || !Number.isInteger(num) || num < MIN_NUMBER || num > MAX_NUMBER) return false;
  const row = sheet.houses[street]!;
  if (row[house]) return false;
  for (let i = 0; i < row.length; i += 1) {
    const other = row[i];
    if (!other || i === house) continue;
    if (i < house && other.num >= num) return false;
    if (i > house && other.num <= num) return false;
  }
  return true;
}

/** num 能写进哪些位置。 */
export function legalHouses(sheet: Sheet, num: number): { street: number; house: number }[] {
  const spots: { street: number; house: number }[] = [];
  for (let street = 0; street < STREET_LENGTHS.length; street += 1) {
    for (let house = 0; house < STREET_LENGTHS[street]!; house += 1) {
      if (canPlaceNumber(sheet, street, house, num)) spots.push({ street, house });
    }
  }
  return spots;
}

/** 临时工能不能用（11 格勾满后不能再用）。 */
export function canUseTemp(sheet: Sheet): boolean {
  return sheet.temps < TEMP_MAX;
}

/** 这组能写的数字和对应的临时工调整：不用临时工是 [num]，能用临时工时再加上 ±1、±2（0–17 之间）。 */
export function comboNumbers(sheet: Sheet, combo: Combo): { num: number; temp?: number }[] {
  const options: { num: number; temp?: number }[] = [{ num: combo.num }];
  if (combo.action === "temp" && canUseTemp(sheet)) {
    for (const delta of [-2, -1, 1, 2]) {
      const num = combo.num + delta;
      if (num >= MIN_NUMBER && num <= MAX_NUMBER) options.push({ num, temp: delta });
    }
  }
  return options;
}

/** 这组有没有地方填（含临时工调整）。 */
export function comboPlaceable(sheet: Sheet, combo: Combo): boolean {
  return comboNumbers(sheet, combo).some((option) => legalHouses(sheet, option.num).length > 0);
}

/** 3 组都填不进去：必须拒批（补充 1.5.3：bis 救不了拒批）。 */
export function mustRefuse(sheet: Sheet, combos: readonly Combo[]): boolean {
  return !combos.some((combo) => comboPlaceable(sheet, combo));
}

/** 第 pos 和 pos+1 座之间这道栅栏还能不能画：没画过、两边不是相同的号码（bis）、不在用过的小区里面。 */
export function canFence(sheet: Sheet, street: number, pos: number): boolean {
  if (!Number.isInteger(street) || street < 0 || street >= STREET_LENGTHS.length) return false;
  if (!Number.isInteger(pos) || pos < 0 || pos >= STREET_LENGTHS[street]! - 1) return false;
  if (sheet.fences[street]![pos]) return false;
  const left = sheet.houses[street]![pos];
  const right = sheet.houses[street]![pos + 1];
  if (left && right && left.num === right.num) return false;
  return !sheet.usedEstates.some((estate) => estate.street === street && pos >= estate.start && pos < estate.start + estate.size - 1);
}

export function legalFences(sheet: Sheet): { street: number; pos: number }[] {
  const fences: { street: number; pos: number }[] = [];
  for (let street = 0; street < STREET_LENGTHS.length; street += 1) {
    for (let pos = 0; pos < STREET_LENGTHS[street]! - 1; pos += 1) if (canFence(sheet, street, pos)) fences.push({ street, pos });
  }
  return fences;
}

/**
 * bis：把 house 旁边（from = -1 左 / 1 右）那座的号码复制进这个空位。
 * 复制后这条街仍然从左到右不递减，相同的号码必须挨在一起，中间不能有栅栏（补充 1.5.2）。
 */
export function canBis(sheet: Sheet, street: number, house: number, from: number): boolean {
  if (!validSpot(street, house) || (from !== -1 && from !== 1)) return false;
  const row = sheet.houses[street]!;
  if (row[house]) return false;
  const source = row[house + from];
  if (!source) return false;
  const value = source.num;
  let left = -1;
  for (let i = house - 1; i >= 0; i -= 1) if (row[i]) { left = i; break; }
  let right = -1;
  for (let i = house + 1; i < row.length; i += 1) if (row[i]) { right = i; break; }
  if (left >= 0) {
    const lv = row[left]!.num;
    if (lv > value) return false;
    if (lv === value && (left !== house - 1 || sheet.fences[street]![house - 1])) return false;
  }
  if (right >= 0) {
    const rv = row[right]!.num;
    if (rv < value) return false;
    if (rv === value && (right !== house + 1 || sheet.fences[street]![house])) return false;
  }
  return true;
}

export function legalBis(sheet: Sheet): { street: number; house: number; from: -1 | 1 }[] {
  const targets: { street: number; house: number; from: -1 | 1 }[] = [];
  for (let street = 0; street < STREET_LENGTHS.length; street += 1) {
    for (let house = 0; house < STREET_LENGTHS[street]!; house += 1) {
      for (const from of [-1, 1] as const) if (canBis(sheet, street, house, from)) targets.push({ street, house, from });
    }
  }
  return targets;
}

/** bis 轨还能不能勾。 */
export function canUseBis(sheet: Sheet): boolean {
  return sheet.bis < BIS_TRACK.length - 1;
}

export function canPark(sheet: Sheet, street: number): boolean {
  return sheet.parks[street]! < PARK_TRACKS[street]!.length - 1;
}

export function canImprove(sheet: Sheet, size: number): boolean {
  return Number.isInteger(size) && size >= 1 && size <= 6 && sheet.improve[size - 1]! < ESTATE_TRACKS[size - 1]!.length - 1;
}

/** 两道栅栏之间的一串房子。 */
export interface Segment {
  readonly street: number;
  readonly start: number;
  readonly size: number;
  /** 全部填满。 */
  readonly full: boolean;
  /** 完成小区：填满而且 1–6 座。 */
  readonly complete: boolean;
  /** 用于目标卡的那张卡（没用过为 null）。 */
  readonly plan: number | null;
}

export function segments(sheet: Sheet): Segment[] {
  const result: Segment[] = [];
  for (let street = 0; street < STREET_LENGTHS.length; street += 1) {
    const length = STREET_LENGTHS[street]!;
    let start = 0;
    for (let i = 0; i < length; i += 1) {
      if (i === length - 1 || sheet.fences[street]![i]) {
        const size = i - start + 1;
        let full = true;
        for (let k = start; k <= i; k += 1) if (!sheet.houses[street]![k]) { full = false; break; }
        const used = sheet.usedEstates.find((estate) => estate.street === street && estate.start === start && estate.size === size);
        result.push({ street, start, size, full, complete: full && size <= MAX_ESTATE, plan: used ? used.plan : null });
        start = i + 1;
      }
    }
  }
  return result;
}

/** 完成小区（填满、1–6 座）。 */
export function estates(sheet: Sheet): Segment[] {
  return segments(sheet).filter((segment) => segment.complete);
}

/** 每个尺寸的完成小区数（下标 0 = 尺寸 1）。 */
export function estateCounts(sheet: Sheet): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const estate of estates(sheet)) counts[estate.size - 1]! += 1;
  return counts;
}

/** 为目标卡挑小区：从还没用过的完成小区里，每个要求的尺寸挑最靠左的一个。凑不齐返回 null。 */
export function pickEstates(sheet: Sheet, need: readonly number[]): Segment[] | null {
  const free = estates(sheet).filter((estate) => estate.plan === null);
  const picked: Segment[] = [];
  for (const size of need) {
    const index = free.findIndex((estate) => estate.size === size);
    if (index < 0) return null;
    picked.push(free[index]!);
    free.splice(index, 1);
  }
  return picked;
}

/** 这张卡能不能验证（还没验证过、凑得齐小区）。 */
export function canClaimPlan(sheet: Sheet, planIndex: number, need: readonly number[]): boolean {
  return sheet.plans[planIndex] === null && pickEstates(sheet, need) !== null;
}

/** 把挑好的小区标成用过（返回新表）。 */
export function lockEstates(sheet: Sheet, picked: readonly Segment[], plan: number): Sheet {
  const next = cloneSheet(sheet);
  next.usedEstates = [
    ...next.usedEstates,
    ...picked.map((estate): UsedEstate => ({ street: estate.street, start: estate.start, size: estate.size, plan })),
  ];
  return next;
}

/**
 * 把一手写到表上（不含目标卡）。不合法就抛出中文原因。返回新表和实际写下的数字。
 */
export function applyMove(sheet: Sheet, move: Move, combo: Combo, round: number): { sheet: Sheet; number: number } {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (!move || typeof move !== "object") fail("这一手不完整。");
  const { street, house } = move;
  if (!validSpot(street, house)) fail("没有这个门牌位。");
  // 行动参数只能给和这组行动对应的那一个
  const given: string[] = [];
  if (move.temp !== undefined) given.push("temp");
  if (move.fence !== undefined) given.push("fence");
  if (move.improve !== undefined) given.push("improve");
  if (move.park !== undefined && move.park !== false) given.push("park");
  if (move.pool !== undefined && move.pool !== false) given.push("pool");
  if (move.bis !== undefined) given.push("bis");
  if (given.length > 1 || (given.length === 1 && given[0] !== combo.action)) fail("只能用这一组的行动。");

  let num = combo.num;
  if (move.temp !== undefined) {
    if (!canUseTemp(sheet)) fail("临时工格已经勾满了。");
    if (!Number.isInteger(move.temp) || move.temp < -2 || move.temp > 2) fail("临时工只能改 ±2 以内。");
    num += move.temp;
    if (num < MIN_NUMBER || num > MAX_NUMBER) fail("门牌号只能是 0–17。");
  }
  if (!canPlaceNumber(sheet, street, house, num)) fail("这里填不了这个号码：同一条街从左到右要越来越大。");

  const next = cloneSheet(sheet);
  const placed: House = { num, bis: false, round };
  next.houses[street]![house] = placed;
  if (move.temp !== undefined) next.temps += 1;

  if (move.pool) {
    if (!isPoolSlot(street, house)) fail("只有写进带泳池的房子才能建泳池。");
    next.pools[street]![house] = true;
    next.poolTrack += 1;
  }
  if (move.park) {
    if (!canPark(next, street)) fail("这条街的公园已经建满了。");
    next.parks[street]! += 1;
  }
  if (move.improve !== undefined) {
    if (!canImprove(next, move.improve)) fail("这一列改造已经勾满了。");
    next.improve[move.improve - 1]! += 1;
  }
  if (move.fence !== undefined) {
    const fence = move.fence;
    if (!fence || !canFence(next, fence.street, fence.pos)) fail("这里不能画栅栏。");
    next.fences[fence.street]![fence.pos] = true;
  }
  if (move.bis !== undefined) {
    const bis = move.bis;
    if (!canUseBis(next)) fail("bis 轨已经勾满了。");
    if (!bis || !canBis(next, bis.street, bis.house, bis.from)) fail("这里不能 bis。");
    const source = next.houses[bis.street]![bis.house + bis.from]!;
    next.houses[bis.street]![bis.house] = { num: source.num, bis: true, round };
    next.bis += 1;
  }
  return { sheet: next, number: num };
}

/** 临时工多数：按不同的格数从多到少排，第 1/2/3 档得 7/4/1，并列同档；一格没勾得 0（规则书 TC10）。 */
export function tempMajority(temps: Record<string, number>): Record<string, number> {
  const distinct = [...new Set(Object.values(temps).filter((count) => count > 0))].sort((a, b) => b - a);
  const result: Record<string, number> = {};
  for (const [id, count] of Object.entries(temps)) {
    const rank = count > 0 ? distinct.indexOf(count) : -1;
    result[id] = rank >= 0 && rank < TEMP_MAJORITY.length ? TEMP_MAJORITY[rank]! : 0;
  }
  return result;
}

/** 一张表的分（临时工多数分要从外面给，因为要和别人比）。 */
export function scoreSheet(sheet: Sheet, tempScore = 0): ScoreBreakdown {
  const plans = sheet.plans.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const parks = sheet.parks.reduce((sum, count, street) => sum + PARK_TRACKS[street]![count]!, 0);
  const pools = POOL_TRACK[sheet.poolTrack]!;
  const counts = estateCounts(sheet);
  const values = ESTATE_TRACKS.map((track, index) => track[sheet.improve[index]!]!);
  const estateScore = counts.reduce((sum, count, index) => sum + count * values[index]!, 0);
  const bis = BIS_TRACK[sheet.bis]!;
  const refusals = REFUSAL_TRACK[sheet.refusals]!;
  return {
    plans,
    parks,
    pools,
    temps: tempScore,
    estateCounts: counts,
    estateValues: values,
    estates: estateScore,
    bis,
    refusals,
    total: plans + parks + pools + tempScore + estateScore - bis - refusals,
  };
}

/** 两人比大小：总分 → 完成小区总数 → 1 房小区数 → 2 房 … → 6 房（规则书第 6 节）。正数 = a 排前面。 */
export function compareScores(a: ScoreBreakdown, b: ScoreBreakdown): number {
  if (a.total !== b.total) return a.total - b.total;
  const sumA = a.estateCounts.reduce((sum, count) => sum + count, 0);
  const sumB = b.estateCounts.reduce((sum, count) => sum + count, 0);
  if (sumA !== sumB) return sumA - sumB;
  for (let size = 0; size < 6; size += 1) {
    if (a.estateCounts[size] !== b.estateCounts[size]) return a.estateCounts[size]! - b.estateCounts[size]!;
  }
  return 0;
}
