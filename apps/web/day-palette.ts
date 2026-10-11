import type { DayPalette } from "./day-theme";

/**
 * 白天版调色表（糖果色黄昏街 → 晴天）：深紫底、面板 → 白底、淡紫面板；深紫描边保留；浅色字 → 深紫字。
 * 表上的内容（房子、门牌号牌、建造牌、目标卡、栅栏、计分格的行动色、标签）在白天保持原色（keep）。
 * 牌桌背景的遮罩、计分空格这类机械换色不合适的，写在 src/theme-day.css。
 */
export const palette: DayPalette = {
  files: ["app-pixel.css", "wt-pages.css", "welcometo.css"],
  colors: {
    "#1c1426": "#ffffff", // 底色、输入框
    "#221930": "#f9f6fc", // 底色的棋盘纹
    "#2c2140": "#faf6fd", // 面板
    "#3b2d55": "#efe6f6", // 面板 2、分隔线
    "#0e0914": "#2e1f3a", // 像素描边（保持深紫）
    "#8a6fb0": "#ffffff", // 面板亮边
    "#6a5490": "#ffffff", // 牌桌面板亮边
    "#130d1c": "#d6c8e2", // 面板暗边
    "#4a3864": "#e9dff2", // 普通按钮、分隔线
    "#9e86c4": "#ffffff", // 按钮亮边
    "#160f22": "#b39cc9", // 按钮暗边
    "#261c38": "#f8f2fb", // 管理员区
    "#3d3220": "#fcefc6", // 金色字的底
    "#241a33": "#fbf7fe", // 手机菜单
    "#1e162a": "#fffaf4", // 牌桌面板（rgba 里的色）
    "#3a2c52": "#f3ecf8", // 牌桌面板 2
    "#140e1e": "#ffffff", // 顶栏
    "#12452a": "#d8f0dc",
    "#0b2614": "#7fbf8f",
  },
  text: {
    "#fff3ea": "#2e1f3a",
    "#cdb6dc": "#6a557a",
    "#8a76a0": "#a898b8",
    "#ffd77a": "#a5650a",
    "#f6d77c": "#94650a",
    "#f25c5c": "#d1303f",
    "#ff8a7a": "#c0392b",
    "#ff7a6a": "#c0392b",
    "#b7f0c0": "#1f6b35",
    "#8ec0ff": "#1d4f9e",
  },
  background: {},
  values: {
    "grayscale(0.6) brightness(0.7)": "grayscale(0.85) brightness(1.15)",
  },
  textShadows: {
    "calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--edge)": "calc(var(--px) * 2) calc(var(--px) * 2) 0 #e6d2f0",
  },
  textVarColors: {
    "--gold": "#94650a",
    "--gold-2": "#94650a",
    "--ok": "#1f8a45",
    "--bad": "#d1303f",
  },
  keep: [
    ".wt-plate", ".wt-card", ".wt-plan-", ".wt-need", ".wt-confetti", ".wt-lot", ".wt-house-pic", ".wt-pool-", ".wt-fence-slot",
    ".wt-tag", ".wt-flash", ".wt-viewing", ".wt-hero-art", ".wt-mini-avatar", ".wt-park", ".wt-bracket",
  ],
};
