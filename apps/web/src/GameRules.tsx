import { useState } from "react";

/** 规则说明：用自己的话写，不照搬原版规则书。 */
function GameRules() {
  const [open, setOpen] = useState(false);

  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button
        className="game-rules-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="game-rules-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">✦</span> 游戏规则
        <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>

      {open && (
        <div className="game-rules-panel" id="game-rules-panel">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>
              山上有 11 条登山路，编号 2–12（两颗骰子的和）。点数越常见的路越长：7 号最长 13 格，2 号和 12 号只有 3 格。
              谁先<b>登顶 3 条路</b>谁就赢。
            </p>
          </div>

          <div className="game-rules-block">
            <h3>轮到你时</h3>
            <ul>
              <li><b>掷 4 颗骰子</b>，把它们分成两对，两对的和就是这次往上爬的两条路。比如 2、3、4、5 可以走 5 和 9、6 和 8，或者 7 号连爬 2 格。</li>
              <li>你有 <b>3 个登山者</b>：每回合最多同时爬 3 条不同的路。在已有登山者的路上往上爬 1 格；新上一条路时，登山者从你在这条路的营地上方一格出发（还没营地就从最底下一格）。</li>
              <li>两个和都能走就必须都走；只能走其中一个时任选一个。</li>
              <li>每爬完一次，选择<b>再掷</b>继续冒险，或者<b>收手扎营</b>：登山者的位置换成你的营地小旗，下回合从这里接着爬。</li>
            </ul>
          </div>

          <div className="game-rules-block">
            <h3>爆掉</h3>
            <p>
              如果这把骰子怎么分组都走不了（路已经被占领、登山者已经在顶上、或者 3 个登山者都在别的路上），就<b>爆掉</b>：
              这回合爬的全部作废，登山者摔回山脚。之前扎好的营地不受影响。
            </p>
          </div>

          <div className="game-rules-block">
            <h3>登顶</h3>
            <ul>
              <li>登山者到了一条路的最顶格，<b>收手时</b>就占领这条路：插上你的大旗，其他人在这条路上的营地全部撤下，这条路之后谁都不能再走。</li>
              <li>到了顶格还继续掷骰，爆掉的话这次登顶也一起作废。</li>
            </ul>
          </div>

          <div className="game-rules-block">
            <h3>其他</h3>
            <ul>
              <li>每一步限时 45 秒：还没掷骰就超时会跳过这回合；掷了骰子以后超时，会替你选第一种走法并收手。</li>
              <li>收手前可以看到「再掷爆掉的概率」，不想看可以隐藏。</li>
              <li>骰子在服务器上掷，谁也做不了手脚。掉线后用原昵称和房间码可以回到自己的座位。</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
