import { api } from "../api-client.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// ============================================================
// 打开日志页：切 stage + 加载执行历史
// ============================================================
export async function openLogs(store) {
  store.update({ stage: "logs", busy: true, error: "" });
  try {
    const runs = await api.runHistory(100);
    store.update({ busy: false, runHistory: Array.isArray(runs) ? runs : [] });
  } catch (error) {
    store.update({ busy: false, error: "加载执行历史失败：" + error.message });
  }
}

export async function openRunDetail(store, runId) {
  store.update({
    busy: true, error: "", selectedRunId: runId,
    historyPhases: [], historyVars: [], historyEnvFields: [],
    historySummary: null, selectedHistoryStep: "",
  });
  try {
    const data = await api.runHistoryDetail(runId);
    const parsed = buildHistoryPhases(data.events || []);
    store.update({
      busy: false,
      historyPhases: parsed.phases,
      historyVars: parsed.historyVars,
      historyEnvFields: parsed.historyEnvFields,
      historySummary: parsed.historySummary,
      selectedHistoryStep: parsed.phases[0]?.id || "",
    });
  } catch (error) {
    store.update({ busy: false, error: "加载执行详情失败：" + error.message });
  }
}

// 移植 legacy buildHistoryPhases：事件流 → phases / vars / envFields / summary
function buildHistoryPhases(events) {
  const phases = [];
  const stepMap = {};
  let historyVars = [];
  let historyEnvFields = [];
  let historySummary = null;

  for (const ev of events) {
    const d = ev.data || {};
    switch (ev.type) {
      case "login_start":
        phases.push({ id: "login", label: "登录", detail: "", status: "running", duration_ms: null });
        break;
      case "login_ok": {
        const loginPhase = phases.find((p) => p.id === "login");
        if (loginPhase) { loginPhase.status = "ok"; if (d.duration_ms) loginPhase.duration_ms = d.duration_ms; }
        break;
      }
      case "session_ready": {
        historyVars = d.resolved_vars || [];
        const sessionPhase = phases.find((p) => p.id === "login");
        if (sessionPhase && d.duration_ms) sessionPhase.duration_ms = d.duration_ms;
        break;
      }
      case "step_start": {
        const phase = {
          id: d.id || ("step_" + phases.length), label: d.label || d.id || "步骤",
          detail: d.detail || "", status: "running", duration_ms: null,
          business_stage: d.business_stage || "", resolved_request: d.resolved_request || null, response: null,
        };
        phases.push(phase);
        stepMap[phase.id] = phase;
        break;
      }
      case "step_ok": {
        const okStep = stepMap[d.id];
        if (okStep) {
          okStep.status = "ok";
          if (d.duration_ms) okStep.duration_ms = d.duration_ms;
          if (d.response !== undefined) okStep.response = d.response;
        }
        break;
      }
      case "step_fail": {
        const failStep = stepMap[d.id];
        if (failStep) {
          failStep.status = "fail";
          if (d.duration_ms) failStep.duration_ms = d.duration_ms;
          failStep.error = d.error || "";
          if (d.response !== undefined) failStep.response = d.response;
        }
        break;
      }
      case "case_start":
        if (d.pick_fields_preview && d.pick_fields_preview.length > 0) {
          historyEnvFields = d.pick_fields_preview;
        }
        break;
      case "env_fields_resolved":
        if (historyEnvFields.length > 0 && (d.fields || []).length > 0) {
          (d.fields || []).forEach((uf) => {
            const existing = historyEnvFields.find((ef) => ef.step_id === uf.step_id);
            if (existing) Object.assign(existing, uf);
            else historyEnvFields.push(uf);
          });
          historyEnvFields = [...historyEnvFields];
        } else {
          historyEnvFields = d.fields || [];
        }
        break;
      case "case_done":
        historySummary = d;
        break;
      default:
        break;
    }
  }
  phases.forEach((p) => { if (p.status === "running") p.status = "fail"; });
  return { phases, historyVars, historyEnvFields, historySummary };
}

// ============================================================
// 渲染
// ============================================================
export function renderLogs(state) {
  const runs = state.runHistory || [];
  return `
    <div class="tree-table-layout logs-layout">
      <section class="panel logs-list">
        <div class="panel-header">
          <h2>执行历史</h2>
          <div class="toolbar">
            <button class="btn" id="logs-refresh">刷新</button>
            <button class="btn btn-danger" id="logs-clear">清空</button>
          </div>
        </div>
        <div class="panel-body logs-list-body">
          ${runs.map((r) => renderRunItem(r, state)).join("") ||
            '<div class="empty-state">暂无执行历史，运行用例后这里会出现记录。</div>'}
        </div>
      </section>
      <section class="panel logs-detail">
        ${renderRunDetail(state)}
      </section>
    </div>`;
}

function renderRunItem(r, state) {
  const sel = state.selectedRunId === r.run_id ? "is-active" : "";
  const tone = r.passed === true ? "is-success" : r.passed === false ? "is-danger" : "";
  const label = r.passed === true ? "通过" : r.passed === false ? "失败" : "—";
  const when = r.mtime ? new Date(r.mtime * 1000).toLocaleString() : "";
  return `
    <div class="logs-run-item ${sel}" data-run-id="${escapeHtml(r.run_id)}">
      <div class="logs-run-top">
        <span class="badge ${tone}">${label}</span>
        <strong>${escapeHtml(r.case_name || r.run_id)}</strong>
      </div>
      <div class="logs-run-meta">
        <small class="cell-muted">${escapeHtml(when)}</small>
        <small class="cell-muted">步骤 ${r.step_ok ?? 0}/${(r.step_ok ?? 0) + (r.step_fail ?? 0)} ·
          ${r.duration_s != null ? Number(r.duration_s).toFixed(2) + "s" : "—"}</small>
      </div>
    </div>`;
}

function renderRunDetail(state) {
  if (!state.selectedRunId) {
    return '<div class="panel-body"><div class="empty-state">选择左侧一条执行记录查看步骤、变量与请求响应证据。</div></div>';
  }
  const summary = state.historySummary;
  const passed = summary?.passed;
  return `
    <div class="panel-header">
      <h2>${escapeHtml(state.selectedRunId)}</h2>
      ${summary ? `<span class="badge ${passed ? "is-success" : "is-danger"}">${passed ? "通过" : "失败"}</span>` : ""}
    </div>
    <div class="panel-body logs-detail-body">
      ${renderSummaryBar(summary)}
      ${renderVarsBlock(state.historyVars)}
      ${renderEnvFieldsBlock(state.historyEnvFields)}
      ${renderStepsAndDetail(state)}
    </div>`;
}

function renderSummaryBar(summary) {
  if (!summary) return "";
  return `
    <div class="logs-summary">
      <span>步骤 <strong>${summary.step_ok ?? 0}/${(summary.step_ok ?? 0) + (summary.step_fail ?? 0)}</strong></span>
      <span>耗时 <strong>${summary.duration_s != null ? Number(summary.duration_s).toFixed(2) + "s" : "—"}</strong></span>
      ${summary.error ? `<span class="cell-danger">${escapeHtml(summary.error)}</span>` : ""}
    </div>`;
}

function renderVarsBlock(vars) {
  if (!vars || !vars.length) return "";
  return `
    <section class="field-group">
      <div class="field-group-title"><strong>运行变量</strong><span class="cell-muted">${vars.length} 项</span></div>
      <div class="table-wrap">
        <table class="field-table" style="min-width:0">
          <thead><tr><th>变量</th><th>值</th></tr></thead>
          <tbody>
            ${vars.map((v) => `
              <tr>
                <td class="field-name"><strong>${escapeHtml(v.name || v.key || v.id || "")}</strong></td>
                <td><small>${escapeHtml(typeof v.value === "object" ? JSON.stringify(v.value) : (v.value ?? ""))}</small></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderEnvFieldsBlock(fields) {
  if (!fields || !fields.length) return "";
  return `
    <section class="field-group">
      <div class="field-group-title"><strong>环境字段</strong><span class="cell-muted">${fields.length} 项</span></div>
      <div class="table-wrap">
        <table class="field-table" style="min-width:0">
          <thead><tr><th>字段</th><th>解析结果</th><th>状态</th></tr></thead>
          <tbody>
            ${fields.map((f) => `
              <tr>
                <td class="field-name"><strong>${escapeHtml(f.label || f.step_id || "")}</strong></td>
                <td><small>${escapeHtml(f.value_id || f.value_code || f.value_name || "—")}</small></td>
                <td>${renderResolveStatus(f.status || f.resolve_status)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderResolveStatus(status) {
  if (!status) return '<span class="cell-muted">—</span>';
  const ok = /ok|resolved|success|found/i.test(status);
  const bad = /not_found|fail|error/i.test(status);
  const tone = ok ? "is-success" : bad ? "is-danger" : "is-warning";
  return `<span class="badge ${tone}">${escapeHtml(status)}</span>`;
}

function renderStepsAndDetail(state) {
  const phases = state.historyPhases || [];
  if (!phases.length) return '<div class="empty-state">该执行记录没有步骤事件。</div>';
  const selected = phases.find((p) => p.id === state.selectedHistoryStep) || phases[0];
  return `
    <div class="logs-steps-layout">
      <ol class="step-flow logs-step-flow">
        ${phases.map((p) => {
          const tone = p.status === "ok" ? "is-success" : p.status === "fail" ? "is-danger" : "is-warning";
          const sel = (selected && selected.id === p.id) ? "is-selected-row" : "";
          return `
            <li class="step-flow-item ${sel}" data-history-step="${escapeHtml(p.id)}">
              <span class="badge ${tone}">${p.status === "ok" ? "通过" : p.status === "fail" ? "失败" : "进行"}</span>
              <span class="step-flow-label">${escapeHtml(p.label || p.id)}</span>
              ${p.duration_ms != null ? `<small class="cell-muted">${p.duration_ms}ms</small>` : ""}
            </li>`;
        }).join("")}
      </ol>
      <div class="logs-step-detail">${renderStepDetail(selected)}</div>
    </div>`;
}

function renderStepDetail(phase) {
  if (!phase) return '<div class="empty-state">选择左侧步骤查看请求与响应。</div>';
  return `
    <div class="result-conclusion">
      <span class="badge ${phase.status === "ok" ? "is-success" : phase.status === "fail" ? "is-danger" : "is-warning"}">
        ${phase.status === "ok" ? "通过" : phase.status === "fail" ? "失败" : "进行"}</span>
      <strong>${escapeHtml(phase.label || phase.id)}</strong>
      ${phase.duration_ms != null ? `<span class="cell-muted">${phase.duration_ms}ms</span>` : ""}
    </div>
    ${phase.detail ? `<p class="cell-muted">${escapeHtml(phase.detail)}</p>` : ""}
    ${phase.error ? `<p class="cell-danger">${escapeHtml(phase.error)}</p>` : ""}
    ${renderJsonBlock("请求", phase.resolved_request)}
    ${renderJsonBlock("响应", phase.response)}`;
}

function renderJsonBlock(title, value) {
  if (value == null || value === "") return "";
  const text = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  return `
    <details class="logs-json">
      <summary>${escapeHtml(title)}</summary>
      <pre class="repair-preview">${escapeHtml(text)}</pre>
    </details>`;
}

// ============================================================
// 绑定
// ============================================================
export function bindLogs(store) {
  if (store.get().stage !== "logs") return;
  document.querySelector("#logs-refresh")?.addEventListener("click", () => openLogs(store));
  document.querySelector("#logs-clear")?.addEventListener("click", () => clearLogs(store));
  document.querySelectorAll("[data-run-id]").forEach((el) => {
    el.addEventListener("click", () => openRunDetail(store, el.dataset.runId));
  });
  document.querySelectorAll("[data-history-step]").forEach((el) => {
    el.addEventListener("click", () => store.update({ selectedHistoryStep: el.dataset.historyStep }));
  });
}

async function clearLogs(store) {
  if (!confirm("确认清空所有执行历史日志？仅删除运行记录，不影响用例与批量任务。")) return;
  store.update({ busy: true, error: "" });
  try {
    const data = await api.clearRunLogs();
    store.update({
      busy: false, runHistory: [], selectedRunId: "", historyPhases: [],
      historyVars: [], historyEnvFields: [], historySummary: null,
      notice: `已清空 ${data.deleted ?? 0} 条执行历史日志`,
    });
  } catch (error) {
    store.update({ busy: false, error: "清空失败：" + error.message });
  }
}
