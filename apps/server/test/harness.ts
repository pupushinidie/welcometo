/** 服务器 socket 测试的公用工具：每个测试文件自己 import 服务器（环境变量要在 import 之前设好）。 */
import { AddressInfo } from "node:net";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  AckResponse,
  ClientToServerEvents,
  GameCommand,
  JoinRoomPayload,
  LobbyRoomSnapshot,
  ServerToClientEvents,
} from "@welcometo/game";

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type ServerModule = typeof import("../src/index.js");

export interface Harness {
  server: ServerModule;
  connect(headers?: Record<string, string>): Promise<TestSocket>;
  latest: Map<TestSocket, LobbyRoomSnapshot>;
  /** 每个连接收到的所有 room:updated，连同收到时自己的连接 id（抓包检查用；断线后 client.id 就没了）。 */
  received: Map<TestSocket, { selfId: string; room: LobbyRoomSnapshot }[]>;
  close(): Promise<void>;
}

export async function startServer(): Promise<Harness> {
  const server: ServerModule = await import("../src/index.js");
  await new Promise<void>((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(0, resolve);
  });
  const url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  const clients = new Set<TestSocket>();
  const latest = new Map<TestSocket, LobbyRoomSnapshot>();
  const received = new Map<TestSocket, { selfId: string; room: LobbyRoomSnapshot }[]>();
  return {
    server,
    latest,
    received,
    connect(headers = {}) {
      return new Promise((resolve, reject) => {
        const client: TestSocket = createClient(url, { transports: ["websocket"], reconnection: false, extraHeaders: headers });
        clients.add(client);
        received.set(client, []);
        client.on("room:updated", (room) => {
          latest.set(client, room);
          received.get(client)!.push({ selfId: client.id ?? "", room });
        });
        client.once("connect", () => resolve(client));
        client.once("connect_error", reject);
      });
    },
    async close() {
      for (const client of clients) client.disconnect();
      await new Promise<void>((resolve) => server.io.close(() => resolve()));
    },
  };
}

export function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

export async function ok<T>(promise: Promise<AckResponse<T>>): Promise<T> {
  const response = await promise;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export function join(client: TestSocket, payload: JoinRoomPayload): Promise<AckResponse<LobbyRoomSnapshot>> {
  return call((ack) => client.emit("room:join", payload, ack));
}

/** 发一个对局动作。回执里的房间快照比随后的 room:updated 先到，所以拿它更新 latest，后面马上读到的就是新状态。 */
export function command(client: TestSocket, value: GameCommand, harness?: Harness): Promise<AckResponse<LobbyRoomSnapshot>> {
  return call<LobbyRoomSnapshot>((ack) => client.emit("game:command", value, ack)).then((response) => {
    if (response.ok && harness) {
      const current = harness.latest.get(client);
      if (!current?.game || (response.data.game && response.data.game.version >= current.game.version)) harness.latest.set(client, response.data);
    }
    return response;
  });
}

export function updateWhere(
  harness: Harness,
  client: TestSocket,
  test: (room: LobbyRoomSnapshot) => boolean,
  timeoutMs = 10_000,
): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = harness.latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

export function seatOf(harness: Harness, client: TestSocket): string {
  return harness.latest.get(client)?.members.find((member) => member.id === client.id)?.playerId ?? "";
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
