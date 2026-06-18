import { api } from "../api-client.js";
import { caseInFolder } from "../components/folder-tree.js";
import { buildReportPrompt, copyPrompt } from "../components/agent-prompt.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// ============================================================
// 批量任务：createTask → startTask → 轮询 getTask
// ============================================================
export async function runBatchTask(store, names) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return;
  const state = store.get();
  store.update({ batchRunning: true, error: "", notice: `正在创建批量任务（${list.length} 条）…` });
  try {
    const created = await api.createTask({
      case_names: list,
      env_id: state.envId,
      name: `vNext 批量执行 ${new Date().toLocaleString()}`,
      concurrency: 3,
    });
    const taskId = created.task_id;
    store.update({ taskId, notice: `任务已创建，正在启动…` });
    await api.startTask(taskId);
    pollTask(store, taskId);
  } catch (error) {
    store.update({ batchRunning: false, error: error.message });
  }
}

function pollTask(store, taskId) {
  const tick = async () => {
    if (store.get().taskId !== taskId) return; // 任务已切换
    try {
      const detail = await api.getTask(taskId);
      const done = detail.passed_count + detail.failed_count;
      store.update({
        taskDetail: detail,
        notice: `批量执行中：${done}/${detail.total_count}（通过 ${detail.passed_count} · 失败 ${detail.failed_count}）`,
      });
      if (detail.status === "completed" || detail.status === "cancelled") {
        store.update({ batchRunning: false, notice: `批量任务${detail.status === "completed" ? "完成" : "已取消"}` });
        await openReport(store, taskId);
        return;
      }
    } catch (error) {
      store.update({ batchRunning: false, error: error.message });
      return;
    }
    setTimeout(tick, 1200);
  };
  setTimeout(tick, 1000);
}

export async function openReport(store, taskId) {
  if (!taskId) return;
  store.update({ busy: true, error: "" });
  try {
    const report = await api.getTaskReport(taskId);
    store.update({
      busy: false,
      currentReport: report,
      showReportDialog: true,
      reportCurrentFolder: "",
      reportExpandedFolders: {},
    });
  } catch (error) {
    store.update({ busy: false, error: "报告尚未就绪：" + error.message });
  }
}

// ============================================================
// 报告弹窗渲染
// ============================================================
function reportCaseResults(report) {
  return Array.isArray(report?.case_results) ? report.case_results : [];
}

function writeVerifiedCount(results) {
  return results.filter((r) => r.write_status === "verified").length;
}

// 由报告用例名派生文件夹列表
function reportFolders(results) {
  const set = new Set();
  for (const r of results) {
    const idx = (r.name || "").lastIndexOf("/");
    if (idx > 0) {
      const parts = r.name.slice(0, idx).split("/");
      let acc = "";
      for (const part of parts) { acc = acc ? acc + "/" + part : part; set.add(acc); }
    }
  }
  return Array.from(set).filter(Boolean).sort();
}

export function renderReportDialog(state) {
  if (!state.showReportDialog || !state.currentReport) return "";
  const report = state.currentReport;
  const summary = report.summary || {};
  const results = reportCaseResults(report);
  const total = summary.total_cases ?? results.length;
  const passed = summary.passed_cases ?? results.filter((r) => r.passed).length;
  const failed = summary.failed_cases ?? results.filter((r) => !r.passed).length;
  const rate = total ? Math.round((passed / total) * 100) : 0;
  const verified = writeVerifiedCount(results);

  const folders = reportFolders(results);
  const cur = state.reportCurrentFolder || "";
  const visible = results.filter((r) => caseInFolder(r.name, cur));

  return `
    <div class="modal-mask" id="report-mask">
      <div class="modal-card modal-wide">
        <div class="panel-header">
          <h2>执行报告 · ${escapeHtml(report.task_name || report.task_id || "")}</h2>
          <div class="toolbar">
            <button class="btn" id="report-export">导出 HTML</button>
            <button class="btn" id="report-close">关闭</button>
          </div>
        </div>

        <div class="report-metrics">
          ${metricCard("用例总数", total)}
          ${metricCard("通过", passed, "is-success")}
          ${metricCard("失败", failed, "is-danger")}
          ${metricCard("通过率", rate + "%")}
          ${metricCard("入库验证", verified, "is-accent")}
        </div>

        ${renderBarChart(passed, failed)}

        <div class="tree-table-layout report-tree-table">
          <aside class="folder-tree">
            <div class="folder-tree-head"><strong>用例分组</strong></div>
            <div class="folder-tree-body">
              <div class="tree-row ${cur ? "" : "is-active"}" data-report-folder="">
                <span class="tree-label">全部 (${results.length})</span>
              </div>
              ${folders.map((f) => `
                <div class="tree-row ${cur === f ? "is-active" : ""}" data-report-folder="${escapeHtml(f)}">
                  <span class="tree-label">${escapeHtml(f)} (${results.filter((r) => caseInFolder(r.name, f)).length})</span>
                </div>`).join("")}
            </div>
          </aside>
          <section class="panel tree-table-main">
            <div class="panel-body">
              <div class="table-wrap">
                <table class="field-table case-table">
                  <thead><tr>
                    <th>用例</th><th style="width:90px">结果</th>
                    <th style="width:90px">步骤</th><th style="width:110px">入库</th>
                    <th>说明</th><th style="width:110px">AI</th>
                  </tr></thead>
                  <tbody>
                    ${visible.map(renderReportRow).join("") ||
                      '<tr><td colspan="6" class="empty-state">该分组下没有用例结果。</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>`;
}

function metricCard(label, value, tone = "") {
  return `
    <div class="metric-card ${tone}">
      <span class="metric-value">${escapeHtml(value)}</span>
      <span class="metric-label">${escapeHtml(label)}</span>
    </div>`;
}

function renderBarChart(passed, failed) {
  const total = passed + failed || 1;
  const passPct = Math.round((passed / total) * 100);
  const failPct = 100 - passPct;
  return `
    <div class="report-chart">
      <div class="bar-chart">
        <div class="bar-fill is-success" style="width:${passPct}%" title="通过 ${passed}"></div>
        <div class="bar-fill is-danger" style="width:${failPct}%" title="失败 ${failed}"></div>
      </div>
      <div class="bar-legend">
        <span><i class="dot is-success"></i>通过 ${passed}</span>
        <span><i class="dot is-danger"></i>失败 ${failed}</span>
      </div>
    </div>`;
}

function renderReportRow(r) {
  const resultBadge = r.passed
    ? '<span class="badge is-success">通过</span>'
    : '<span class="badge is-danger">失败</span>';
  const writeMap = {
    verified: ['<span class="badge is-success">已验证</span>'],
    unverified: ['<span class="badge is-warning">未验证</span>'],
    failed: ['<span class="badge is-danger">失败</span>'],
    not_applicable: ['<span class="cell-muted">不适用</span>'],
    not_checked: ['<span class="cell-muted">—</span>'],
  };
  const writeBadge = (writeMap[r.write_status] || ['<span class="cell-muted">—</span>'])[0];
  const note = r.passed ? "" : (r.ai_reason || r.error || r.error_category || "");
  // 失败或入库未验证：提供复制 AI 指令
  const needsAi = !r.passed || r.write_status === "unverified" || r.write_status === "failed";
  const aiCell = needsAi
    ? `<button class="btn" data-ai-prompt-case="${escapeHtml(r.name)}">复制 AI 指令</button>`
    : '<span class="cell-muted">—</span>';
  return `
    <tr>
      <td class="field-name"><strong>${escapeHtml(r.name)}</strong></td>
      <td>${resultBadge}</td>
      <td>${r.step_ok ?? "—"}/${r.step_count ?? "—"}</td>
      <td>${writeBadge}</td>
      <td><small class="cell-muted">${escapeHtml(note)}</small></td>
      <td>${aiCell}</td>
    </tr>`;
}

// ============================================================
// 报告弹窗绑定
// ============================================================
export function bindReportDialog(store) {
  if (!document.querySelector("#report-mask")) return;
  document.querySelector("#report-close")?.addEventListener("click", () =>
    store.update({ showReportDialog: false }));
  document.querySelector("#report-mask")?.addEventListener("click", (e) => {
    if (e.target.id === "report-mask") store.update({ showReportDialog: false });
  });
  document.querySelector("#report-export")?.addEventListener("click", () => {
    const taskId = store.get().currentReport?.task_id || store.get().taskId;
    if (taskId) window.open(api.exportReportUrl(taskId), "_blank");
  });
  document.querySelectorAll("[data-report-folder]").forEach((el) => {
    el.addEventListener("click", () => store.update({ reportCurrentFolder: el.dataset.reportFolder }));
  });
  document.querySelectorAll("[data-ai-prompt-case]").forEach((el) => {
    el.addEventListener("click", () => {
      const report = store.get().currentReport;
      const result = reportCaseResults(report).find((r) => r.name === el.dataset.aiPromptCase);
      if (result) copyPrompt(buildReportPrompt(report, result), store);
    });
  });
}
