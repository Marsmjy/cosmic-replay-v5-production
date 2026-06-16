import { escapeHtml, formatDuration, formatTime, statusTone } from "../utils.js?v=20260615-2";
import { valuePreview } from "./run-diagnostics.js?v=20260616-1";

export function renderRunHistory(state, compact = false) {
  const runs = compact
    ? (state.caseDetail?.runs || []).map((item) => normalizeLegacyRun(item))
    : state.runs;
  return `
    <div class="section-toolbar">
      <div><strong>${compact ? "当前用例运行记录" : "运行历史"}</strong><span>${runs.length} 条</span></div>
      <button class="btn" data-action="refresh-runs">刷新</button>
    </div>
    <div class="history-table-wrap">
      <table class="history-table">
        <thead><tr><th>结论</th><th>用例</th><th>环境</th><th>执行值</th><th>步骤</th><th>耗时</th><th>开始时间</th><th>操作</th></tr></thead>
        <tbody>
          ${runs.map((run) => `
            <tr>
              <td><span class="status-label is-${statusTone(run.state)}">${escapeHtml(runLabel(run))}</span></td>
              <td><strong>${escapeHtml(run.case_name || "-")}</strong><small>${escapeHtml(run.run_id || "")}</small></td>
              <td>${escapeHtml(run.env_id || "-")}</td>
              <td class="history-values-cell">${renderValuePreview(run)}</td>
              <td>${run.completed_steps ?? run.step_ok ?? 0}/${run.total_steps ?? ((run.step_ok || 0) + (run.step_fail || 0))}</td>
              <td>${formatDuration(run.duration_s)}</td>
              <td>${formatTime(run.started_at || run.mtime)}</td>
              <td>
                <button class="text-btn" data-open-run="${escapeHtml(run.run_id)}">查看详情</button>
                ${run.state === "failed" ? `
                  <button class="text-btn" data-action="open-diagnosis" data-run-id="${escapeHtml(run.run_id)}">AI排故</button>
                  <button class="text-btn" data-action="copy-ai-prompt" data-run-id="${escapeHtml(run.run_id)}">复制排障</button>
                ` : ""}
              </td>
            </tr>
          `).join("") || '<tr><td colspan="8" class="empty-state compact">暂无运行记录</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function renderValuePreview(run) {
  const values = valuePreview(run);
  if (!values.length) return '<span class="muted">无执行值</span>';
  return `
    <div class="history-value-chips">
      ${values.map((item) => `
        <span title="${escapeHtml(item.label)}=${escapeHtml(item.value)}">
          ${escapeHtml(item.label)}=${escapeHtml(shortValue(item.value, 28))}
        </span>
      `).join("")}
    </div>`;
}

const runLabel = (run) => ({
  write_verified: "写入已验证",
  write_unverified: "写入待确认",
  business_failed: "业务失败",
  unsupported: "暂不支持",
  cancelled: "已停止",
}[run.result_evidence?.outcome] || ({
  passed: "通过", failed: "失败", running: "执行中", cancelled: "已停止",
})[run.state] || "未完成");

const normalizeLegacyRun = (run) => ({
  ...run,
  state: run.passed === true ? "passed" : run.passed === false ? "failed" : "running",
  started_at: run.mtime ? new Date(run.mtime * 1000).toISOString() : null,
  completed_steps: run.step_ok || 0,
  total_steps: (run.step_ok || 0) + (run.step_fail || 0),
});

function shortValue(value, max = 80) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
