import { useState } from "react";
import { actionIcon } from "./art.js";

/** 规则说明：用自己的话写，短。 */
function GameRules() {
  const [open, setOpen] = useState(false);
  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button className="game-rules-toggle" type="button" aria-expanded={open} aria-controls="game-rules-panel" onClick={() => setOpen((current) => !current)} data-tutorial="rules">
        <span aria-hidden="true">✦</span> 游戏规则
        <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>
      {open && (
        <div className="gm-modal-backdrop wt-backdrop-light" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="gm-panel wt-rules" id="game-rules-panel" role="dialog" aria-modal="true" aria-label="游戏规则">
          <div className="wt-rules-head"><h2>游戏规则</h2><button className="quiet-button" type="button" onClick={() => setOpen(false)}>关闭</button></div>
          <div className="wt-rules-body">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>你是一条郊区小街的建筑师。三条街一共 33 块空地，往上写门牌号盖房子，围小区、建公园泳池、抢目标卡。<b>总分最高</b>的人赢。</p>
          </div>
          <div className="game-rules-block">
            <h3>每回合</h3>
            <ul>
              <li>翻出 3 组「号码 + 行动」，<b>所有人同时</b>选一组（可以和别人选同一组），号码和行动不能拆开。</li>
              <li>把号码写进任意一条街的空地：<b>同一条街从左到右要越来越大</b>，可以跳号、可以先空着。</li>
              <li>行动可用可不用。交上去之后、大家都交齐之前能撤回；90 秒没交，人机替你交，连续 2 次转托管。</li>
            </ul>
          </div>
          <div className="game-rules-block">
            <h3>6 种行动</h3>
            <ul className="wt-rules-actions">
              <li><img src={actionIcon("fence")} alt="" width={32} height={32} /><span><b>栅栏</b>：在任意一条街两房之间画一道。两道栅栏之间填满的 1–6 座房是一个<b>小区</b>，7 座以上不算。</span></li>
              <li><img src={actionIcon("improve")} alt="" width={32} height={32} /><span><b>改造</b>：在计分区某个尺寸的小区列勾一格，这种小区每个更值钱。</span></li>
              <li><img src={actionIcon("park")} alt="" width={32} height={32} /><span><b>公园</b>：在写号码的那条街勾一个公园，建满有大奖。</span></li>
              <li><img src={actionIcon("pool")} alt="" width={32} height={32} /><span><b>泳池</b>：号码写进带泳池的房子才能建，越往后越值钱。</span></li>
              <li><img src={actionIcon("temp")} alt="" width={32} height={32} /><span><b>临时工</b>：把号码 ±1 或 ±2 再写。终局临时工最多的 7 分、第二 4 分、第三 1 分。</span></li>
              <li><img src={actionIcon("bis")} alt="" width={32} height={32} /><span><b>bis</b>：把一座房子的号码复制到它旁边的空地（扣分，救急用）。</span></li>
            </ul>
          </div>
          <div className="game-rules-block">
            <h3>目标卡和拒批</h3>
            <ul>
              <li>上面 3 张目标卡要求特定尺寸的小区。<b>同一回合最先完成的人都拿高分</b>，之后完成的拿低分；用过的小区不能再拆。</li>
              <li>3 组号码都写不进去就<b>拒批</b>：这回合什么都不做，拒批轨勾一格（第 2、3 次扣分）。</li>
            </ul>
          </div>
          <div className="game-rules-block">
            <h3>结束和计分</h3>
            <p>有人拒批满 3 次、完成 3 张目标卡、或 33 座房子填满，这回合结算完就结束。总分 = 目标卡 + 公园 + 泳池 + 临时工 + 小区（个数 × 单价）− bis − 拒批。平分比完成的小区多。</p>
          </div>
          </div>
        </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
