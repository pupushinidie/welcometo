import type { ReactNode } from "react";

/** 新手教程（教程阶段换成剧本局 + 练习局）。 */
function TutorialMode({ brand, themeToggle, onExit }: { name: string; brand: ReactNode; themeToggle: ReactNode; theme: "day" | "night"; waitingRoom?: string | undefined; onExit: () => void }) {
  return (
    <div className="wt-page">
      <header className="topbar wt-pagebar">{brand}<div className="topbar-right">{themeToggle}</div></header>
      <p>新手教程还在做。</p>
      <button className="quiet-button" type="button" onClick={onExit}>回去</button>
    </div>
  );
}

export default TutorialMode;
