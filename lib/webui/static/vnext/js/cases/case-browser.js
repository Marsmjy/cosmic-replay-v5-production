import { escapeHtml, statusTone } from "../utils.js?v=20260615-2";

export function renderCaseBrowser(state) {
  const needle = state.caseSearch.trim().toLowerCase();
  const cases = (state.cases || []).filter((item) => {
    if (!needle) return true;
    return `${item.display_name || ""} ${item.name || ""} ${item.description || ""}`
      .toLowerCase().includes(needle);
  });
  return `
    <div class="case-browser-header">
      <div><strong>用例库</strong><span>${cases.length}/${state.cases.length}</span></div>
      <button class="icon-btn" data-action="refresh-cases" title="刷新用例">↻</button>
    </div>
    <div class="case-search">
      <input class="input" id="case-search-input" value="${escapeHtml(state.caseSearch)}"
        placeholder="搜索名称、场景或表单">
    </div>
    <div class="case-list">
      ${cases.map((item) => `
        <button class="case-row ${state.selectedCase === item.name ? "is-selected" : ""}"
          data-case-name="${escapeHtml(item.name)}">
          <span class="case-row-main">
            <strong>${escapeHtml(item.display_name || item.name)}</strong>
            <small>${escapeHtml(item.main_form_id || item.description || "未识别主表单")}</small>
          </span>
          <span class="case-row-meta">
            <span>${escapeHtml(item.scenario_kind || "case")}</span>
            ${item.last_result ? `<i class="status-mark is-${statusTone(item.last_result === "PASS" ? "passed" : "failed")}"></i>` : ""}
          </span>
        </button>
      `).join("") || '<div class="empty-state compact">暂无匹配用例</div>'}
    </div>
    <div class="case-browser-footer">
      <button class="btn" data-action="open-import">导入 HAR</button>
    </div>
  `;
}

export function bindCaseBrowser(store, actions) {
  document.querySelector("#case-search-input")?.addEventListener("input", (event) => {
    store.update({ caseSearch: event.target.value });
  });
  document.querySelectorAll("[data-case-name]").forEach((button) => {
    button.addEventListener("click", () => actions.selectCase(button.dataset.caseName));
  });
}
