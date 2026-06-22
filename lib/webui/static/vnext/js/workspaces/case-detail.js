import { api } from "../api-client.js";
import { runSingleWithDiagnosis, applyRepairAndRerun } from "./run-workspace.js";
import { buildSingleRunPrompt, copyPrompt } from "../components/agent-prompt.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// ============================================================
// YAML 轻量解析（端口自 legacy，仅用于详情展示/编辑）
// ============================================================
function parseScalar(value) {
  let s = String(value ?? "").trim();
  if (!s) return "";
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s;
}

export function parsePickFields(yamlText) {
  const text = yamlText || "";
  const result = {};
  const pfMatch = text.match(/^pick_fields:\s*\n((?:[ \t]+[^\n]+\n)*)/m);
  if (!pfMatch) return [];
  const lines = pfMatch[1].split("\n");
  let currentKey = null;
  for (const line of lines) {
    const keyMatch = line.match(/^ {2}([\w]+):\s*$/);
    if (keyMatch) { currentKey = keyMatch[1]; result[currentKey] = {}; continue; }
    if (currentKey) {
      const propMatch = line.match(/^\s{4}([\w]+):\s*(.*)\s*$/);
      if (propMatch) result[currentKey][propMatch[1]] = parseScalar(propMatch[2]);
    }
  }
  return Object.keys(result).map((key) => {
    const e = result[key];
    return {
      step_id: key,
      label: e.label || key,
      value_id: e.value_id || "",
      value_name: e.value_name || "",
      value_code: e.value_code || "",
      form_label: e.form_label || "",
      group_label: e.group_label || "",
      env_sensitive: e.env_sensitive || "medium",
      resolve_status: e.resolve_status || "",
      order: Number.isFinite(Number(e.order)) ? Number(e.order) : 99999,
    };
  }).sort((a, b) => a.order - b.order);
}

export function parseValidationPoints(yamlText) {
  const text = yamlText || "";
  const points = [];
  const lines = text.split("\n");
  let inBlock = false;
  let current = null;
  let itemIndent = -1;
  for (const line of lines) {
    const raw = line.replace(/\t/g, "    ");
    const trimmed = raw.trim();
    if (!inBlock && /^validation_points\s*:/.test(raw.trimStart())) { inBlock = true; continue; }
    if (!inBlock) continue;
    const itemMatch = raw.match(/^(\s*)-\s+id:\s*(.*)\s*$/);
    if (itemMatch) {
      if (current) points.push(current);
      itemIndent = itemMatch[1].length;
      current = { id: parseScalar(itemMatch[2]) };
      continue;
    }
    if (trimmed && !raw.startsWith(" ") && !trimmed.startsWith("#")) break;
    if (!current) continue;
    const propMatch = raw.match(/^(\s+)([\w-]+):\s*(.*)\s*$/);
    if (propMatch) {
      const indent = propMatch[1].length;
      if (indent !== itemIndent + 2) continue;
      const key = propMatch[2];
      if (key === "assertion") continue;
      current[key] = parseScalar(propMatch[3]);
    }
  }
  if (current) points.push(current);
  return points.map((p) => ({
    id: p.id,
    label: p.label || p.id,
    required: p.required === "true" || p.required === true,
    enabled: p.enabled === "true" || p.enabled === true,
    category: p.category || "",
    scope: p.scope || "",
    help: p.help || "",
  }));
}

// ============================================================
// 打开 / 关闭 用例详情
// ============================================================
export async function openCaseDetail(store, caseName) {
  store.update({ busy: true, error: "" });
  try {
    const data = await api.getCaseYaml(caseName);
    store.update({
      stage: "detail",
      currentCase: caseName,
      selectedCase: caseName,
      yamlSource: data.yaml || "",
      caseFieldCatalog: Array.isArray(data.field_catalog) ? data.field_catalog : [],
      yamlDirty: false,
      detailTab: "result",
      selectedStep: "",
      busy: false,
    });
  } catch (error) {
    store.update({ busy: false, error: error.message });
  }
}

async function reloadCaseYaml(store) {
  const name = store.get().currentCase;
  if (!name) return;
  try {
    const data = await api.getCaseYaml(name);
    store.update({
      yamlSource: data.yaml || "",
      caseFieldCatalog: Array.isArray(data.field_catalog) ? data.field_catalog : [],
      yamlDirty: false,
    });
  } catch (error) {
    store.update({ error: error.message });
  }
}

// ============================================================
// 渲染
// ============================================================
const TABS = [
  ["result", "运行结果"],
  ["vars", "变量面板"],
  ["validation", "校验点"],
  ["yaml", "YAML"],
  ["steps", "步骤导航"],
];

export function renderCaseDetail(state) {
  const tab = state.detailTab || "result";
  return `
    <div class="detail-layout">
      <aside class="panel detail-steps">
        <div class="panel-header"><h2>执行步骤</h2></div>
        <div class="panel-body">${renderStepsList(state)}</div>
      </aside>
      <section class="panel detail-main">
        <div class="panel-header">
          <h2>${escapeHtml(state.currentCase || "用例详情")}</h2>
          <div class="toolbar">
            <button class="btn btn-primary" id="detail-run" ${state.running ? "disabled" : ""}>
              ${state.running ? "执行中…" : "运行并诊断"}
            </button>
            <button class="btn" id="detail-back">返回列表</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="tabs">
            ${TABS.map(([key, label]) => `
              <button class="tab ${tab === key ? "is-active" : ""}" data-detail-tab="${key}">
                ${label}${key === "yaml" && state.yamlDirty ? " ·" : ""}
              </button>`).join("")}
          </div>
          <div class="tab-content">${renderTab(state, tab)}</div>
        </div>
      </section>
    </div>`;
}

function renderStepsList(state) {
  const phases = state.phases || [];
  if (!phases.length) return '<div class="cell-muted">运行后展示执行步骤。</div>';
  return `<ol class="step-flow">${phases.map((p) => {
    const tone = p.status === "ok" ? "is-success" : p.status === "fail" ? "is-danger" : "is-warning";
    const sel = state.selectedStep === p.id ? "is-selected-row" : "";
    return `
      <li class="step-flow-item ${sel}" data-step-id="${escapeHtml(p.id)}">
        <span class="badge ${tone}">${p.status === "ok" ? "通过" : p.status === "fail" ? "失败" : "进行"}</span>
        <span class="step-flow-label">${escapeHtml(p.label || p.id)}</span>
        ${p.duration_ms != null ? `<small class="cell-muted">${p.duration_ms}ms</small>` : ""}
      </li>`;
  }).join("")}</ol>`;
}

function renderTab(state, tab) {
  if (tab === "vars") return renderVarsTab(state);
  if (tab === "validation") return renderValidationTab(state);
  if (tab === "yaml") return renderYamlTab(state);
  if (tab === "steps") return renderStepsTab(state);
  return renderResultTab(state);
}

// ---- Tab：运行结果 ----
function renderResultTab(state) {
  const summary = state.summary;
  const diag = state.singleRunDiagnosis;
  if (!summary && !diag) {
    return '<div class="empty-state">点击「运行并诊断」执行当前用例，结果与下一步将显示在这里。</div>';
  }
  const passed = Boolean(summary?.passed ?? diag?.passed);
  const tone = passed ? "is-success" : "is-danger";
  const title = passed ? "执行通过" : "执行失败";
  const reason = diag?.ai_reason || diag?.error || state.failureAnalysis?.root_cause || summary?.error || "";
  const assertions = (diag?.assertions) || [];
  const fa = state.failureAnalysis || diag?.failure_analysis || null;
  const repairs = state.repairPlan || [];
  // 失败或入库未验证：提供复制 AI 指令
  const writeStatus = diag?.write_status || "";
  const needsAi = !passed || writeStatus === "unverified" || writeStatus === "failed";
  const aiBtn = needsAi && state.runId
    ? `<div class="toolbar" style="margin:10px 0"><button class="btn" id="detail-ai-prompt">复制 AI 修复指令</button></div>`
    : "";
  return `
    <div class="result-conclusion">
      <span class="badge ${tone}">${title}</span>
      <span class="cell-muted">步骤 ${summary?.step_ok ?? "—"}/${summary?.step_count ?? (state.phases || []).length} ·
        ${summary?.duration_s != null ? Number(summary.duration_s).toFixed(2) + "s" : "—"}</span>
    </div>
    ${reason ? `<p class="result-reason">${escapeHtml(reason)}</p>` : ""}
    ${!passed ? `<p class="cell-muted result-disclaimer">请求成功不等于业务写入成功，结果按证据层级解释。</p>` : ""}
    ${aiBtn}
    ${assertions.length ? `
      <section class="field-group">
        <div class="field-group-title"><strong>断言</strong></div>
        <div class="validation-list">
          ${assertions.map((a) => `
            <div class="validation-row">
              <span class="badge ${a.ok ? "is-success" : "is-danger"}">${a.ok ? "通过" : "失败"}</span>
              <span><strong>${escapeHtml(a.type || "断言")}</strong><small>${escapeHtml(a.msg || "")}</small></span>
            </div>`).join("")}
        </div>
      </section>` : ""}
    ${fa && !passed ? `
      <section class="field-group">
        <div class="field-group-title"><strong>失败归因</strong>
          <span class="cell-muted">${escapeHtml(fa.category || "unknown")}</span></div>
        <p class="result-reason">${escapeHtml(fa.root_cause || fa.summary || "")}</p>
        ${fa.next_step ? `<p class="cell-muted">下一步：${escapeHtml(fa.next_step)}</p>` : ""}
      </section>` : ""}
    ${renderRepairPlan(repairs, state)}`;
}

function renderRepairPlan(repairs, state) {
  if (!repairs.length) return "";
  const hasSafe = repairs.some((r) => r && r.safe_to_apply);
  return `
    <section class="field-group">
      <div class="field-group-title">
        <strong>修复建议</strong>
        <span class="cell-muted">共 ${repairs.length} 项${hasSafe ? "，含可自动应用的安全修复" : ""}</span>
      </div>
      <div class="repair-list">
        ${repairs.map((r) => `
          <div class="repair-item">
            <div class="repair-head">
              <strong>${escapeHtml(r.title || r.id || "修复")}</strong>
              <span class="badge ${r.safe_to_apply ? "is-success" : "is-warning"}">
                ${r.safe_to_apply ? "可安全自动应用" : "需手动确认"}</span>
              <span class="badge is-accent">置信度 ${escapeHtml(r.confidence || "medium")}</span>
            </div>
            ${r.reason ? `<p class="cell-muted">${escapeHtml(r.reason)}</p>` : ""}
            ${r.preview ? `<pre class="repair-preview">${escapeHtml(r.preview)}</pre>` : ""}
          </div>`).join("")}
      </div>
      ${hasSafe ? `<div class="toolbar" style="margin-top:12px">
        <button class="btn btn-primary" id="repair-apply" ${state.busy ? "disabled" : ""}>应用安全修复并重跑</button>
      </div>` : ""}
    </section>`;
}

// ---- Tab：变量面板 ----
function renderVarsTab(state) {
  const picks = parsePickFields(state.yamlSource);
  if (!picks.length) return '<div class="empty-state">当前用例没有需要维护的业务字段。</div>';
  return `
    <section class="field-group">
      <div class="field-group-title">
        <strong>业务字段（环境敏感）</strong>
        <span class="cell-muted">编辑后写入版本化 YAML</span>
      </div>
      <div class="table-wrap">
        <table class="field-table">
          <thead><tr>
            <th>业务字段</th><th>当前值</th><th>用户值</th><th>归属</th>
          </tr></thead>
          <tbody>
            ${picks.map((pf) => {
              const current = pf.value_code || pf.value_name || pf.value_id || "空";
              return `
                <tr>
                  <td class="field-name">
                    <strong>${escapeHtml(pf.label || pf.step_id)}</strong>
                    <small>${escapeHtml(pf.env_sensitive)} · ${escapeHtml(pf.resolve_status || "—")}</small>
                  </td>
                  <td>${escapeHtml(current)}</td>
                  <td>
                    <input class="input detail-pick-input" data-pick-step="${escapeHtml(pf.step_id)}"
                      value="${escapeHtml(pf.value_code || pf.value_id || "")}" placeholder="业务编码 / value_id">
                  </td>
                  <td><small class="cell-muted">${escapeHtml(pf.group_label || pf.form_label || "")}</small></td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
}

// ---- Tab：校验点 ----
function renderValidationTab(state) {
  const points = parseValidationPoints(state.yamlSource);
  if (!points.length) return '<div class="empty-state">当前用例没有业务校验点。</div>';
  return `
    <section class="validation-section">
      <div class="field-group-title">
        <strong>业务校验点</strong>
        <span class="cell-muted">状态会写入版本化 YAML，不在生成后丢失</span>
      </div>
      <div class="validation-list">
        ${points.map((point) => {
          const enabled = point.required ? true : point.enabled;
          const [kind, tone] = point.required
            ? ["必需", "is-danger"]
            : point.category === "system"
              ? ["技术契约", "is-accent"]
              : enabled ? ["用户启用", "is-success"] : ["建议", "is-warning"];
          return `
            <label class="validation-row">
              <input type="checkbox" data-detail-validation="${escapeHtml(point.id)}"
                ${enabled ? "checked" : ""} ${point.required ? "disabled" : ""}>
              <span>
                <strong>${escapeHtml(point.label || point.id)}</strong>
                <small>${escapeHtml(point.help || point.scope || "运行时验证")}</small>
              </span>
              <span class="badge ${tone}">${kind}</span>
            </label>`;
        }).join("")}
      </div>
    </section>`;
}

// ---- Tab：YAML ----
function renderYamlTab(state) {
  const text = state.yamlSource || "";
  const lineCount = text ? text.split("\n").length : 0;
  return `
    <div class="yaml-editor">
      <div class="toolbar" style="margin-bottom:8px">
        <span class="cell-muted">${lineCount} 行${state.yamlDirty ? " · 有未保存修改" : ""}</span>
        <span style="flex:1"></span>
        <button class="btn btn-primary" id="yaml-save" ${state.yamlDirty ? "" : "disabled"}>保存（Ctrl+S）</button>
      </div>
      <textarea id="detail-yaml" class="yaml-textarea" spellcheck="false">${escapeHtml(text)}</textarea>
    </div>`;
}

// ---- Tab：步骤导航（含运行中间数据：请求 / 响应） ----
function renderStepsTab(state) {
  const phases = state.phases || [];
  if (!phases.length) return '<div class="empty-state">运行后按业务阶段展示步骤导航，点击步骤可查看请求与响应。</div>';
  const selected = phases.find((p) => p.id === state.selectedStep) || phases[0];
  let activeStage = "";
  const flow = phases.map((p) => {
    const stage = p.business_stage || activeStage || "执行链路";
    const heading = stage !== activeStage ? `<div class="run-stage">${escapeHtml(stage)}</div>` : "";
    activeStage = stage;
    const tone = p.status === "ok" ? "is-success" : p.status === "fail" ? "is-danger" : "is-warning";
    const sel = (selected && selected.id === p.id) ? "is-selected-row" : "";
    return `${heading}
      <li class="step-flow-item ${sel}" data-step-id="${escapeHtml(p.id)}">
        <span class="badge ${tone}">${p.status === "ok" ? "通过" : p.status === "fail" ? "失败" : "进行"}</span>
        <span class="step-flow-label">${escapeHtml(p.label || p.id)}</span>
        ${p.duration_ms != null ? `<small class="cell-muted">${p.duration_ms}ms</small>` : ""}
      </li>`;
  }).join("");
  return `
    <div class="logs-steps-layout">
      <ol class="step-flow logs-step-flow">${flow}</ol>
      <div class="logs-step-detail">${renderStepDetail(selected)}</div>
    </div>`;
}

function renderStepDetail(phase) {
  if (!phase) return '<div class="empty-state">选择左侧步骤查看请求与响应。</div>';
  const tone = phase.status === "ok" ? "is-success" : phase.status === "fail" ? "is-danger" : "is-warning";
  return `
    <div class="result-conclusion">
      <span class="badge ${tone}">${phase.status === "ok" ? "通过" : phase.status === "fail" ? "失败" : "进行"}</span>
      <strong>${escapeHtml(phase.label || phase.id)}</strong>
      ${phase.duration_ms != null ? `<span class="cell-muted">${phase.duration_ms}ms</span>` : ""}
    </div>
    ${phase.detail ? `<p class="cell-muted">${escapeHtml(phase.detail)}</p>` : ""}
    ${(phase.errors || []).length ? `<p class="cell-danger">${escapeHtml((phase.errors || []).join("; "))}</p>` : ""}
    ${renderJsonBlock("请求", phase.resolved_request)}
    ${renderJsonBlock("响应", phase.response)}
    ${phase.resolved_request == null && phase.response == null
      ? '<p class="cell-muted">该步骤暂无请求/响应中间数据。</p>' : ""}`;
}

function renderJsonBlock(title, value) {
  if (value == null || value === "") return "";
  const text = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  return `
    <details class="logs-json" open>
      <summary>${escapeHtml(title)}</summary>
      <pre class="repair-preview">${escapeHtml(text)}</pre>
    </details>`;
}

// ============================================================
// 绑定
// ============================================================
export function bindCaseDetail(store) {
  if (!document.querySelector(".detail-layout")) return;
  const name = store.get().currentCase;

  document.querySelectorAll("[data-detail-tab]").forEach((el) => {
    el.addEventListener("click", () => store.update({ detailTab: el.dataset.detailTab }));
  });
  document.querySelector("#detail-back")?.addEventListener("click", () =>
    store.update({ stage: "run" }));
  document.querySelector("#detail-run")?.addEventListener("click", () => {
    if (name) runSingleWithDiagnosis(store, name);
  });
  document.querySelector("#repair-apply")?.addEventListener("click", () => {
    if (name) applyRepairAndRerun(store, name);
  });
  document.querySelector("#detail-ai-prompt")?.addEventListener("click", () => {
    if (name) copyPrompt(buildSingleRunPrompt(store.get(), name), store);
  });
  document.querySelectorAll("[data-step-id]").forEach((el) => {
    el.addEventListener("click", () => store.update({ selectedStep: el.dataset.stepId, detailTab: "steps" }));
  });

  // 变量编辑：失焦保存（pickFieldUpdate）
  document.querySelectorAll("[data-pick-step]").forEach((el) => {
    el.addEventListener("change", () => savePickField(store, el.dataset.pickStep, el.value));
  });

  // 校验点：切换保存（validationPointUpdate）
  document.querySelectorAll("[data-detail-validation]").forEach((el) => {
    el.addEventListener("change", () => saveValidationPoint(store, el.dataset.detailValidation, el.checked));
  });

  // YAML 编辑
  const yamlEl = document.querySelector("#detail-yaml");
  if (yamlEl) {
    yamlEl.addEventListener("input", (e) =>
      store.mutate((draft) => { draft.yamlSource = e.target.value; draft.yamlDirty = true; }));
    yamlEl.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveYaml(store);
      }
    });
  }
  document.querySelector("#yaml-save")?.addEventListener("click", () => saveYaml(store));
}

async function savePickField(store, stepId, value) {
  const name = store.get().currentCase;
  if (!name || !stepId) return;
  const text = String(value || "").trim();
  if (!text) return;
  store.update({ busy: true, error: "" });
  try {
    await api.pickFieldUpdate({
      case_name: name,
      step_id: stepId,
      value_id: text,
      value_code: text,
      resolve_by: "value_code",
      auto_resolve: true,
      manual_override: false,
      user_overridden: true,
    });
    await reloadCaseYaml(store);
    store.update({ busy: false, notice: "字段值已保存" });
  } catch (error) {
    store.update({ busy: false, error: "字段保存失败：" + error.message });
  }
}

async function saveValidationPoint(store, pointId, enabled) {
  const name = store.get().currentCase;
  if (!name || !pointId) return;
  store.update({ busy: true, error: "" });
  try {
    const resp = await api.validationPointUpdate({ case_name: name, point_id: pointId, enabled });
    store.update({
      busy: false,
      yamlSource: resp.yaml || store.get().yamlSource,
      yamlDirty: false,
      notice: resp.enabled ? "校验点已启用" : "校验点已停用",
    });
  } catch (error) {
    store.update({ busy: false, error: "校验点保存失败：" + error.message });
  }
}

async function saveYaml(store) {
  const name = store.get().currentCase;
  if (!name) return;
  store.update({ busy: true, error: "" });
  try {
    await api.saveCaseYaml(name, store.get().yamlSource);
    store.update({ busy: false, yamlDirty: false, notice: "YAML 已保存" });
  } catch (error) {
    store.update({ busy: false, error: "YAML 保存失败：" + error.message });
  }
}
