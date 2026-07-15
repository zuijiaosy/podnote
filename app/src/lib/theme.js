// 主题管理 — 皮肤(cassette/glass)× 外观(light/dark/auto)
// 纯前端偏好:存 localStorage(webview 数据目录),不经 Rust、不进 settings.json;
// index.html 里有一段前置内联脚本在首帧前先落 data 属性,这里只负责运行期切换。
export const SKINS = [
  { value: "cassette", label: "磁带机" },
  { value: "glass", label: "玻璃" },
];
export const MODES = [
  { value: "light", label: "亮" },
  { value: "dark", label: "暗" },
  { value: "auto", label: "跟随系统" },
];

const KEY_SKIN = "pn-skin";
const KEY_MODE = "pn-mode";

// URL 参数(?skin=&mode=)优先于本机偏好:测试与截图直达任意组合用
const urlPref = (key) => new URLSearchParams(location.search).get(key);

export function currentSkin() {
  const v = urlPref("skin") || localStorage.getItem(KEY_SKIN);
  return SKINS.some((s) => s.value === v) ? v : "cassette";
}
export function currentMode() {
  const v = urlPref("mode") || localStorage.getItem(KEY_MODE);
  return MODES.some((m) => m.value === v) ? v : "auto";
}

const dark = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme() {
  const root = document.documentElement;
  root.dataset.skin = currentSkin();
  const mode = currentMode();
  root.dataset.mode = mode === "auto" ? (dark().matches ? "dark" : "light") : mode;
}

/** 换装动效:新主题从屏幕中心圆形扩散(View Transitions);不支持时瞬时切换 */
function reveal(fn) {
  if (document.startViewTransition) document.startViewTransition(fn);
  else fn();
}

export function setSkin(v) { localStorage.setItem(KEY_SKIN, v); reveal(applyTheme); }
export function setMode(v) { localStorage.setItem(KEY_MODE, v); reveal(applyTheme); }

/** 启动时调用一次:落属性 + 跟随系统外观变化 */
export function initTheme() {
  applyTheme();
  dark().addEventListener("change", () => { if (currentMode() === "auto") applyTheme(); });
}
