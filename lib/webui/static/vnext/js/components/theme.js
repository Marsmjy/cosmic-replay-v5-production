// ⭐ P2: 主题切换（浅色默认，可切深色，localStorage 持久化）
const THEME_KEY = "cosmic-replay-vnext-theme";

export function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "dark" ? "dark" : "light";
  } catch (e) {
    return "light";
  }
}

export function applyTheme(theme) {
  const dark = theme === "dark";
  document.body.classList.toggle("theme-dark", dark);
}

// 启动时调用：读取持久化主题并写入 state + body
export function initTheme(store) {
  const theme = readTheme();
  applyTheme(theme);
  store.update({ theme });
}

export function toggleTheme(store) {
  const next = store.get().theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    // 忽略隐私模式等存储失败
  }
  applyTheme(next);
  store.update({ theme: next });
}

// 渲染顶栏主题切换按钮（日/月图标，纯内联 SVG）
export function renderThemeToggle(state) {
  const dark = state.theme === "dark";
  const icon = dark
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 006.752-2.998z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36l-.7-.7M6.34 6.34l-.7-.7m12.72 0l-.7.7M6.34 17.66l-.7.7"/></svg>';
  return `<button class="icon-btn" id="theme-toggle" title="${dark ? "切换到浅色" : "切换到深色"}" aria-label="切换主题">${icon}</button>`;
}

export function bindThemeToggle(store) {
  const btn = document.querySelector("#theme-toggle");
  if (btn) btn.onclick = () => toggleTheme(store);
}
