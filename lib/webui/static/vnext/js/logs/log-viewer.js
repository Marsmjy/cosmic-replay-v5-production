import { escapeHtml, safeJson } from "../utils.js?v=20260615-2";

export function renderLogViewer(state) {
  const logs = filteredLogs(state);
  const filters = state.logFilters;
  return `
    <section class="log-section">
      <div class="section-toolbar log-toolbar">
        <div><strong>运行日志</strong><span>${logs.length} 条脱敏记录</span></div>
        <div class="filter-row">
          ${select("log-category", "层级", filters.category, [
            "business", "execution", "contract", "resolver", "pageid", "request_response", "system",
          ])}
          ${select("log-severity", "级别", filters.severity, ["info", "warning", "error"])}
          <input class="input" id="log-search" value="${escapeHtml(filters.search)}" placeholder="关键词">
          <label class="switch-label"><input type="checkbox" id="log-autoscroll" ${state.autoScroll ? "checked" : ""}>自动滚动</label>
          <a class="btn" href="${state.runId ? `/api/vnext/runs/${encodeURIComponent(state.runId)}/diagnostic-bundle` : "#"}">导出诊断包</a>
        </div>
      </div>
      <div class="log-table-wrap" id="run-log-container">
        <table class="log-table">
          <thead><tr><th>时间</th><th>层级</th><th>步骤</th><th>消息</th><th>证据</th></tr></thead>
          <tbody>
            ${logs.map((log) => `
              <tr class="log-${escapeHtml(log.severity)}">
                <td>${escapeHtml(String(log.timestamp || "").slice(11, 23))}</td>
                <td>${escapeHtml(log.category)}</td>
                <td>${escapeHtml(log.step_id || "-")}</td>
                <td><details><summary>${escapeHtml(log.message)}</summary>
                  <pre>${escapeHtml(safeJson(log.data))}</pre></details></td>
                <td>${escapeHtml(log.evidence_ref)}</td>
              </tr>
            `).join("") || '<tr><td colspan="5" class="empty-state compact">暂无匹配日志</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>`;
}

export function bindLogViewer(store) {
  const bind = (selector, key) => document.querySelector(selector)?.addEventListener("input", (event) => {
    store.mutate((state) => { state.logFilters[key] = event.target.value; });
  });
  bind("#log-category", "category");
  bind("#log-severity", "severity");
  bind("#log-search", "search");
  document.querySelector("#log-autoscroll")?.addEventListener("change", (event) => {
    store.update({ autoScroll: event.target.checked });
  });
  if (store.get().autoScroll) {
    const container = document.querySelector("#run-log-container");
    if (container) container.scrollTop = container.scrollHeight;
  }
}

function filteredLogs(state) {
  const filters = state.logFilters;
  return (state.run?.logs || []).filter((log) =>
    (!filters.category || log.category === filters.category)
    && (!filters.severity || log.severity === filters.severity)
    && (!filters.stepId || log.step_id === filters.stepId)
    && (!filters.search || `${log.message} ${JSON.stringify(log.data)}`.toLowerCase().includes(filters.search.toLowerCase()))
  );
}

const select = (id, label, selected, values) => `
  <select class="input" id="${id}">
    <option value="">${label}：全部</option>
    ${values.map((value) => `<option value="${value}" ${selected === value ? "selected" : ""}>${value}</option>`).join("")}
  </select>`;
