/**
 * 断线 / 刷新后回到座位（首发验收 I18、I19）。
 *
 * 进了房间（坐着的玩家，不含观战）就把「昵称 + 房间码」记在 sessionStorage（只在这个标签页里，关掉就没了）；
 * socket 断开再连上、或者刷新页面后，App 自动用它重新 room:join，服务器按原昵称把人放回原座位。
 * 主动离开、房间解散、被移出、加入失败时清掉。昵称另外记在 localStorage，下次打开首页自动填好。
 *
 * 断网时服务器要等心跳超时（几十秒）才知道旧连接断了，这之前重新加入会被拒（「这个昵称的玩家仍在线」），
 * 所以被拒时每 2 秒重试一次，最多 45 次（90 秒）。
 * 移植到别的游戏：复制这个文件，改 KEY 前缀，App 里照情书（loveletter）的 handleConnect / rejoinSeat 接上。
 */
const SEAT_KEY = "wt-seat";
const NAME_KEY = "wt-nickname";

export interface Seat {
  readonly name: string;
  readonly code: string;
}

function safe<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

export function readSeat(): Seat | null {
  return safe(() => {
    const raw = window.sessionStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const seat = JSON.parse(raw) as Partial<Seat>;
    return typeof seat.name === "string" && typeof seat.code === "string" && seat.code ? { name: seat.name, code: seat.code } : null;
  }, null);
}

export function rememberSeat(seat: Seat): void {
  safe(() => window.sessionStorage.setItem(SEAT_KEY, JSON.stringify(seat)), undefined);
  rememberName(seat.name);
}

export function forgetSeat(): void {
  safe(() => window.sessionStorage.removeItem(SEAT_KEY), undefined);
}

export function readName(): string {
  return safe(() => window.localStorage.getItem(NAME_KEY) ?? "", "");
}

export function rememberName(name: string): void {
  safe(() => window.localStorage.setItem(NAME_KEY, name), undefined);
}

/** 被拒是因为旧连接还没超时（过一会儿再试就行）。 */
export function retryable(error: string): boolean {
  return /仍在线|同名/.test(error);
}
