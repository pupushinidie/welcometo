import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dayTheme } from "./day-theme";
import { palette } from "./day-palette";

// 端口从环境变量读，默认是分配给欢迎来到的 5298 / 3027。
// 人机、界面要用特殊环境变量另起一套服务时：WEB_PORT=5398 SERVER_PORT=3127 npm run dev。
const webPort = Number(process.env.WEB_PORT ?? 5298);
const serverTarget = `http://localhost:${process.env.SERVER_PORT ?? process.env.PORT ?? 3027}`;

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/welcometo/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), dayTheme(palette)],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/socket.io": { target: serverTarget, ws: true },
      "/health": serverTarget
    }
  }
});
