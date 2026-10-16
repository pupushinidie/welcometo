import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { installArtVars } from "./art.js";
import { applyTheme, readTheme } from "./theme.js";
import { startPreload } from "./gm-preload.js";
import "./styles.css";
// 像素风皮肤叠在 styles.css 上面：app-pixel.css 管首页和等候房间，wt-pages.css 管它们的排版，welcometo.css 管牌桌。
import "./app-pixel.css";
import "./wt-pages.css";
import "./welcometo.css";
import "./theme-day.css";

applyTheme(readTheme());
// 后台先把图片、字体下好，对局里第一次用到时不用再等服务器（见 gm-preload.ts）。
startPreload();
installArtVars();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
