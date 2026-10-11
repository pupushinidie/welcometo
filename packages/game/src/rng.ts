/**
 * 随机数。两种，接口一样（Rng），状态都存在对局状态的 rngState 里（只在服务端，不下发），
 * 所以同一种子、同一串动作总能复现同一局：
 *
 * - createSecureRng(key)：**服务器发牌用**。ChaCha20 密钥流（RFC 8439 的块函数），key 是 128–256 位的十六进制串，
 *   服务器每场用 crypto.randomBytes(32) 生成。玩家看到自己的牌和排头也推不出密钥，穷举 2^128 以上不可行。
 *   纯 JS 实现，浏览器里也能跑。
 * - createRng(seed)：mulberry32，32 位状态，快，**只给测试、教程、预览、人机模拟用**。
 *   32 位种子能被穷举（首发验收 I7：只看自己的 10 张牌和 4 个排头，几秒到几分钟就能锁定种子），不能用来给真人发牌。
 */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  /** 当前状态：mulberry32 是数字；ChaCha20 是「c20:密钥:已用的字数」字符串。可以原样传回 restoreRng。 */
  readonly state: number | string;
}

function wrap(next: () => number, state: () => number | string): Rng {
  const int = (maxExclusive: number) => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    pick: (items) => items[int(items.length)]!,
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    },
    get state() {
      return state();
    },
  };
}

/** mulberry32：32 位状态，只给测试、教程、预览、模拟用（见文件开头）。 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return wrap(next, () => state);
}

const rotl = (value: number, shift: number) => ((value << shift) | (value >>> (32 - shift))) >>> 0;

/**
 * ChaCha20 块函数（RFC 8439 第 2.3 节）：256 位密钥（8 个 32 位字）、32 位块计数、96 位 nonce（3 个字）→ 16 个 32 位字。
 * 导出只为了拿 RFC 的测试向量做单测。
 */
export function chachaBlock(key: readonly number[], counter: number, nonce: readonly number[] = [0, 0, 0]): number[] {
  const initial = [
    0x61707865, 0x3320646e, 0x79622d32, 0x6b206574,
    ...key.map((word) => word >>> 0),
    counter >>> 0,
    ...nonce.map((word) => word >>> 0),
  ];
  const x = [...initial];
  const quarter = (a: number, b: number, c: number, d: number) => {
    x[a] = (x[a]! + x[b]!) >>> 0; x[d] = rotl(x[d]! ^ x[a]!, 16);
    x[c] = (x[c]! + x[d]!) >>> 0; x[b] = rotl(x[b]! ^ x[c]!, 12);
    x[a] = (x[a]! + x[b]!) >>> 0; x[d] = rotl(x[d]! ^ x[a]!, 8);
    x[c] = (x[c]! + x[d]!) >>> 0; x[b] = rotl(x[b]! ^ x[c]!, 7);
  };
  for (let round = 0; round < 10; round += 1) {
    quarter(0, 4, 8, 12); quarter(1, 5, 9, 13); quarter(2, 6, 10, 14); quarter(3, 7, 11, 15);
    quarter(0, 5, 10, 15); quarter(1, 6, 11, 12); quarter(2, 7, 8, 13); quarter(3, 4, 9, 14);
  }
  return x.map((word, index) => (word + initial[index]!) >>> 0);
}

/** 十六进制密钥 → 8 个 32 位字（按字节小端，不足 256 位的补 0）。要求 32–64 个十六进制字符（128–256 位）。 */
function keyWords(hex: string): number[] {
  if (!/^[0-9a-f]{32,64}$/i.test(hex) || hex.length % 2 !== 0) throw new Error("安全随机数的密钥要是 32–64 个十六进制字符（128–256 位）。");
  const bytes = new Array<number>(32).fill(0);
  for (let index = 0; index < hex.length / 2; index += 1) bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return Array.from({ length: 8 }, (_, word) => (bytes[word * 4]! | (bytes[word * 4 + 1]! << 8) | (bytes[word * 4 + 2]! << 16) | (bytes[word * 4 + 3]! << 24)) >>> 0);
}

/**
 * ChaCha20 密钥流随机数（服务器发牌用）。key：128–256 位十六进制；position：已经用掉的 32 位字数（从状态恢复时用）。
 * 每次 next() 取一个 32 位字 / 2^32。
 */
export function createSecureRng(key: string, position = 0): Rng {
  const words = keyWords(key);
  const normalized = key.toLowerCase();
  let used = position;
  let blockIndex = -1;
  let block: number[] = [];
  const next = () => {
    const wanted = Math.floor(used / 16);
    if (wanted !== blockIndex) {
      block = chachaBlock(words, wanted);
      blockIndex = wanted;
    }
    const word = block[used % 16]!;
    used += 1;
    return word / 4294967296;
  };
  return wrap(next, () => `c20:${normalized}:${used}`);
}

/** 种子 → 随机数：十六进制字符串用 ChaCha20（服务器），数字用 mulberry32（测试、教程）。 */
export function rngFromSeed(seed: number | string): Rng {
  return typeof seed === "string" ? createSecureRng(seed) : createRng(seed);
}

/** 从对局状态里存的 rng 状态恢复。 */
export function restoreRng(state: number | string): Rng {
  if (typeof state === "number") return createRng(state);
  const match = /^c20:([0-9a-f]+):(\d+)$/.exec(state);
  if (!match) throw new Error("随机数状态格式不对。");
  return createSecureRng(match[1]!, Number(match[2]));
}
