import { api } from "../api-client.js";
import { renderResult } from "../components/result-summary.js";

export function renderRunWorkspace(state) {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>选择用例并执行</h2>
        <button class="btn" id="refresh-cases">刷新</button>
      </div>
      <div class="panel-body">
        <div class="case-list">
          ${(state.cases || []).slice(0, 30).map((item) => `
            <button class="case-row ${state.selectedCase === item.name ? "is-selected" : ""}" data-case-name="${escapeHtml(item.name)}">
              <span><strong>${escapeHtml(item.display_name || item.name)}</strong>
              <p>${escapeHtml(item.description || item.file || "")}</p></span>
              <span class="badge">${escapeHtml(item.scenario_kind || "case")}</span>
            </button>`).join("") || '<div class="empty-state">还没有可执行用例。</div>'}
        </div>
        <div class="toolbar" style="margin-top:12px">
          <button class="btn btn-primary" id="run-selected" ${state.selectedCase && !state.busy ? "" : "disabled"}>执行选中用例</button>
          <span class="cell-muted">${state.runId ? `run_id ${state.runId}` : "执行事件会按业务阶段展示"}</span>
        </div>
        <div class="run-log">${renderEvents(state.runEvents)}</div>
      </div>
    </section>`;
}

export function renderResultWorkspace(state) {
  return renderResult(state);
}

export function bindRunWorkspace(store) {
  document.querySelector("#refresh-cases")?.addEventListener("click", () => refreshCases(store));
  document.querySelectorAll("[data-case-name]").forEach((element) => {
    element.addEventListener("click", () => store.update({ selectedCase: element.dataset.caseName }));
  });
  document.querySelector("#run-selected")?.addEventListener("click", () => runSelected(store));
}

export async function refreshCases(store) {
  try {
    store.update({ cases: await api.cases() });
  } catch (error) {
    store.update({ error: error.message });
  }
}

async function runSelected(store) {
  const state = store.get();
  if (!state.selectedCase) return;
  store.update({ busy: true, error: "", result: null, runEvents: [], notice: `正在执行 ${state.selectedCase}` });
  try {
    const run = await api.runCase(state.selectedCase, state.envId);
    store.update({ runId: run.run_id });
    subscribeRun(run.run_id, store);
  } catch (error) {
    store.update({ busy: false, error: error.message, notice: "" });
  }
}

function subscribeRun(runId, store) {
  const source = new EventSource(`/api/runs/${runId}/events`);
  const eventTypes = [
    "step_start", "step_ok", "step_fail", "assertion_ok", "assertion_fail",
    "failure_analysis", "env_fields_resolved", "case_error", "case_done",
  ];
  eventTypes.forEach((type) => source.addEventListener(type, (event) => {
    const data = JSON.parse(event.data || "{}");
    store.mutate((state) => {
      state.runEvents.push({ type, data, ts: new Date().toLocaleTimeString() });
      if (type === "case_done") {
        state.result = data;
        state.busy = false;
        state.notice = "";
        state.stage = "result";
      }
      if (type === "case_error") {
        state.result = { passed: false, error: data.error, result_evidence: { outcome: "business_failed", request_success: false } };
      }
    });
  }));
  source.addEventListener("close", () => {
    source.close();
    store.update({ busy: false });
  });
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) store.update({ busy: false });
  };
}

function renderEvents(events) {
  if (!events.length) return '<div class="cell-muted">尚未开始执行。</div>';
  let activeStage = "";
  return events.slice(-80).map((event) => {
    const stage = event.data?.business_stage || activeStage || "执行链路";
    const heading = event.type === "step_start" && stage !== activeStage
      ? `<div class="run-stage">${escapeHtml(stage)}</div>`
      : "";
    if (event.type === "step_start") activeStage = stage;
    return `${heading}
      <div class="run-line is-${escapeHtml(eventTone(event.type))}">
        <time>${event.ts}</time><span>${escapeHtml(eventLabel(event))}</span>
      </div>`;
  }).join("");
}

function eventLabel(event) {
  const data = event.data || {};
  if (event.type === "step_start") return `开始 ${data.description || data.id || data.step_id || "步骤"}`;
  if (event.type === "step_ok") return `通过 ${data.description || data.id || data.step_id || "步骤"}`;
  if (event.type === "step_fail") return `失败 ${data.error || data.description || data.id || "步骤"}`;
  if (event.type === "case_done") return data.passed ? "执行完成" : "执行失败";
  return `${event.type} ${data.message || data.error || ""}`;
}

function eventTone(type) {
  if (["step_fail", "assertion_fail", "case_error"].includes(type)) return "danger";
  if (["step_ok", "assertion_ok", "case_done"].includes(type)) return "success";
  return "neutral";
}

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
