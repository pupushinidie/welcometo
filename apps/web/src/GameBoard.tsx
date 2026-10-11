/** 临时调试牌桌（界面阶段换成正式的）。 */
import type { GameCommand, LobbyRoomSnapshot } from "@welcometo/game";

export interface GameBoardProps {
  room: LobbyRoomSnapshot;
  onCommand?: (command: GameCommand) => void;
  [key: string]: unknown;
}

function GameBoard({ room }: GameBoardProps) {
  const game = room.game;
  if (!game) return null;
  return (
    <main className="wt-debug">
      <h2>第 {game.round} 回合</h2>
      <p>{game.combos.map((combo) => `${combo.num}·${combo.action}`).join("　")}</p>
    </main>
  );
}

export default GameBoard;
