import { api } from "./api-client.js?v=20260615-2";
import { createState } from "./state.js?v=20260616-1";
import { renderCaseBrowser, bindCaseBrowser } from "./cases/case-browser.js?v=20260615-2";
import {
  renderCaseHeader, renderCaseTabs, renderOverview, renderSteps,
  renderContracts, renderTechnical, renderEmptyCase,
} from "./cases/case-workspace.js?v=20260615-2";
import { renderVariables, bindVariables } from "./variables/variable-workspace.js?v=20260615-3";
import { renderReadinessPanel } from "./components/readiness-panel.js?v=20260615-2";
import { renderExecutionCenter } from "./execution/execution-center.js?v=20260616-2";
import { renderRunHistory } from "./reports/run-history.js?v=20260616-1";
import { buildAiTroubleshootingPrompt } from "./reports/run-diagnostics.js?v=20260616-1";
import { bindLogViewer } from "./logs/log-viewer.js?v=20260615-2";
import { renderDiagnosis } from "./diagnosis/diagnosis-workspace.js?v=20260615-2";
import {
  renderEnvironmentSettings,
  makeEnvDraft,
  environmentPayloadFromDraft,
  defaultEnvTemplate,
} from "./settings/environment-settings.js?v=20260616-1";
import { renderImportDialog } from "./import/import-dialog.js?v=20260615-2";
import { escapeHtml } from "./utils.js?v=20260615-2";

const store = createState();
const navItems = [
  ["cases", "用例工作区"],
  ["execution", "执行中心"],
  ["history", "运行历史"],
  ["diagnosis", "AI 排故"],
  ["settings", "环境配置"],
];
let eventSource = null;
let refreshTimer = null;

store.subscribe(render);
bootstrap().catch((error) => {
  console.error("workspace bootstrap failed", error);
  const region = document.querySelector("#notice-region");
  if (region) region.innerHTML = `<div class="notice is-error">${escapeHtml(error.message)}</div>`;
});

async function bootstrap() {
  try {
    render(store.get());
    const [health, config, cases, history] = await Promise.all([
      api.health(), api.config(), api.cases(), api.runs(50),
    ]);
    hydrateConfig(config);
    const envs = config.envs || [];
    const configuredDefault = config.webui?.default_env || "";
    const envId = store.get().envId || configuredDefault || envs[0]?.id || "";
    store.update({
      health,
      envId,
      cases,
      runs: history.runs || [],
    });
    if (store.get().selectedCase && cases.some((item) => item.name === store.get().selectedCase)) {
      await loadCase(store.get().selectedCase);
    } else if (cases.length) {
      await selectCase(cases[0].name);
    }
    if (store.get().runId) await restoreRun(store.get().runId);
  } catch (error) {
    showError(error);
  }
}

function render(state) {
  document.querySelector("#primary-nav").innerHTML = navItems.map(([id, label]) => `
    <button data-view="${id}" class="${state.view === id ? "is-active" : ""}">${label}</button>
  `).join("");
  document.querySelector("#case-browser").innerHTML = renderCaseBrowser(state);
  document.querySelector("#case-browser").classList.toggle("is-mobile-open", state.mobileCasesOpen === true);
  document.querySelector("#context-header").innerHTML = state.view === "cases"
    ? renderCaseHeader(state)
    : renderAreaHeader(state);
  document.querySelector("#case-tabs").innerHTML = state.view === "cases" ? renderCaseTabs(state) : "";
  document.querySelector("#case-tabs").classList.toggle("is-hidden", state.view !== "cases");
  document.querySelector("#notice-region").innerHTML = state.error
    ? `<div class="notice is-error"><strong>${escapeHtml(state.error)}</strong>
       ${state.errorAction ? `<span>${escapeHtml(state.errorAction)}</span>` : ""}</div>`
    : state.notice ? `<div class="notice">${escapeHtml(state.notice)}</div>` : "";
  document.querySelector("#workspace-content").innerHTML = renderContent(state) + renderImportDialog(state);
  document.querySelector("#readiness-panel").innerHTML = renderReadinessPanel(state);

  const envSelect = document.querySelector("#environment-select");
  envSelect.innerHTML = (state.envs || []).map((env) =>
    `<option value="${escapeHtml(env.id)}" ${env.id === state.envId ? "selected" : ""}>${escapeHtml(env.name || env.id)}</option>`
  ).join("");
  envSelect.disabled = !(state.envs || []).length;
  envSelect.onchange = async (event) => {
    const envId = event.target.value;
    store.update({ envId });
    try {
      await api.saveWebui({ default_env: envId });
      store.mutate((draftState) => {
        draftState.webuiPrefs.default_env = envId;
        draftState.webuiDraft.default_env = envId;
      });
    } catch (error) {
      showError(error);
      return;
    }
    if (store.get().selectedCase) await loadCase(store.get().selectedCase);
  };
  const health = document.querySelector("#api-health");
  health.textContent = state.health?.status === "healthy" ? "服务正常" : "服务待确认";
  health.classList.toggle("is-ok", state.health?.status === "healthy");

  bindEvents();
  bindCaseBrowser(store, { selectCase });
  if (state.view === "cases" && state.caseTab === "variables") {
    bindVariables(store, { resolveField, applyCandidate });
  }
  if (state.view === "execution") bindLogViewer(store);
}

function renderContent(state) {
  if (state.view === "execution") return renderExecutionCenter(state);
  if (state.view === "history") return renderRunHistory(state);
  if (state.view === "diagnosis") return renderDiagnosis(state);
  if (state.view === "settings") return renderEnvironmentSettings(state);
  if (!state.caseDetail) return renderEmptyCase();
  if (state.caseTab === "variables") return renderVariables(state);
  if (state.caseTab === "steps") return renderSteps(state.caseDetail);
  if (state.caseTab === "contracts") return renderContracts(state.caseDetail);
  if (state.caseTab === "runs") return renderRunHistory(state, true);
  if (state.caseTab === "technical") return renderTechnical(state.caseDetail);
  return renderOverview(state.caseDetail);
}

function renderAreaHeader(state) {
  const meta = {
    execution: ["执行中心", state.run ? `${state.run.case_name} · ${state.run.current_phase}` : "实时观察 runner 事件、契约和业务证据"],
    history: ["运行历史", "恢复任意运行现场并查看分层结果"],
    diagnosis: ["AI 排故", "基于结构化证据生成结论、修复草案和验证步骤"],
    settings: ["环境配置", "维护目标环境、登录凭证、基础资料映射和默认环境"],
  }[state.view];
  return `<div><h1>${meta[0]}</h1><p>${escapeHtml(meta[1])}</p></div>
    <div class="context-actions">${state.runId ? `<span class="schema-label">${escapeHtml(state.runId)}</span>` : ""}</div>`;
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      store.update({ view: button.dataset.view });
      if (button.dataset.view === "history") await refreshRuns();
      if (button.dataset.view === "diagnosis" && store.get().runId) await loadDiagnosis();
    });
  });
  document.querySelectorAll("[data-case-tab]").forEach((button) => {
    button.addEventListener("click", () => store.update({ caseTab: button.dataset.caseTab }));
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    const action = button.dataset.action;
    button.addEventListener("click", () => runAction(action, button));
  });
  document.querySelectorAll("[data-webui-field]").forEach((input) => {
    input.addEventListener(input.type === "checkbox" ? "change" : "input", () => {
      const value = input.type === "checkbox" ? input.checked : input.value;
      store.silent((state) => { state.webuiDraft[input.dataset.webuiField] = value; });
    });
  });
  document.querySelectorAll("[data-env-field]").forEach((input) => {
    input.addEventListener(input.type === "checkbox" ? "change" : "input", () => {
      const value = input.type === "checkbox" ? input.checked : input.value;
      store.silent((state) => setDraftPath(state.envDrafts[input.dataset.envId], input.dataset.envField, value));
    });
  });
  document.querySelectorAll("[data-new-env-field]").forEach((input) => {
    input.addEventListener("input", () => {
      store.silent((state) => { state.newEnvDraft[input.dataset.newEnvField] = input.value; });
    });
    input.addEventListener("change", () => {
      store.silent((state) => { state.newEnvDraft[input.dataset.newEnvField] = input.value; });
    });
  });
  document.querySelectorAll("[data-open-run]").forEach((button) => {
    button.addEventListener("click", () => openRun(button.dataset.openRun));
  });
  document.querySelectorAll("[data-run-step]").forEach((button) => {
    button.addEventListener("click", () => {
      store.mutate((state) => {
        state.focusedStep = button.dataset.runStep;
        state.logFilters.stepId = button.dataset.runStep;
      });
    });
  });
  document.querySelectorAll("[data-preview-repair]").forEach((button) => {
    button.addEventListener("click", () => previewRepair(Number(button.dataset.previewRepair)));
  });
  const importInput = document.querySelector("#import-har-input");
  importInput?.addEventListener("change", () => importInput.files[0] && previewImport(importInput.files[0]));
}

async function runAction(action, button) {
  if (action === "refresh-cases") return refreshCases();
  if (action === "refresh-case") return loadCase(store.get().selectedCase);
  if (action === "refresh-readiness") return refreshReadiness();
  if (action === "go-execution") return store.update({ view: "execution" });
  if (action === "start-run" || action === "rerun") return startRun();
  if (action === "cancel-run") return cancelRun();
  if (action === "refresh-runs") return refreshRuns();
  if (action === "open-diagnosis") return openDiagnosis(button?.dataset.runId || "");
  if (action === "copy-ai-prompt") return copyAiTroubleshootingInfo(button?.dataset.runId || "");
  if (action === "close-copy-fallback") return store.update({ diagnosticCopyText: "", error: "" });
  if (action === "save-variables") return saveVariables();
  if (action === "restore-selected") return batchFieldChange(true);
  if (action === "clear-selected") return batchFieldChange(false);
  if (action === "fix-readiness") {
    const readiness = store.get().caseDetail?.readiness;
    const target = readiness?.state === "needs_fields" ? "variables" : "technical";
    return store.update({ view: "cases", caseTab: target });
  }
  if (action === "open-import") return store.update({ importMode: true, importPreview: null });
  if (action === "close-import") return store.update({ importMode: false, importPreview: null, importFile: null });
  if (action === "generate-import") return generateImport();
  if (action === "apply-repair") return applyRepair();
  if (action === "toggle-cases") return store.update({ mobileCasesOpen: !store.get().mobileCasesOpen });
  if (action === "reload-settings") return loadSettings(true);
  if (action === "save-webui") return saveWebuiPrefs();
  if (action === "reset-webui") return resetWebuiDraft();
  if (action === "new-env") return openNewEnvDialog();
  if (action === "cancel-new-env") return store.update({ newEnvDialog: false, newEnvDraft: { id: "", cloneFrom: "" } });
  if (action === "create-env") return createEnv();
  if (action === "toggle-env") return toggleEnv(button.dataset.envId);
  if (action === "toggle-secret") return toggleEnvSecret(button.dataset.envId);
  if (action === "save-env") return saveEnvironment(button.dataset.envId);
  if (action === "reset-env") return resetEnvironmentDraft(button.dataset.envId);
  if (action === "delete-env") return deleteEnvironment(button.dataset.envId);
  if (action === "set-default-env") return setDefaultEnvironment(button.dataset.envId);
}

function setDraftPath(target, dottedPath, value) {
  if (!target || !dottedPath) return;
  const parts = dottedPath.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function hydrateConfig(config, notice = "") {
  const envs = config.envs || [];
  const current = store.get();
  const configuredDefault = config.webui?.default_env || "";
  const defaultEnv = envs.find((env) => env.id === configuredDefault)?.id || envs[0]?.id || "";
  const validEnv = envs.find((env) => env.id === current.envId)
    ? current.envId
    : defaultEnv;
  const envExpanded = { ...current.envExpanded };
  const envDrafts = {};
  envs.forEach((env, index) => {
    envDrafts[env.id] = makeEnvDraft(env);
    if (envExpanded[env.id] === undefined) {
      envExpanded[env.id] = env.id === validEnv || index === 0;
    }
  });
  store.update({
    envs,
    envId: validEnv,
    webuiPrefs: { ...(config.webui || {}) },
    webuiDraft: { ...(config.webui || {}), default_env: defaultEnv || validEnv },
    envDrafts,
    envExpanded,
    settingsBusy: false,
    notice,
  });
}

async function loadSettings(showNotice = false) {
  try {
    store.update({ settingsBusy: true, error: "" });
    hydrateConfig(await api.config(), showNotice ? "环境配置已重新加载" : "");
  } catch (error) {
    showError(error);
  }
}

async function saveWebuiPrefs() {
  try {
    const draft = { ...store.get().webuiDraft };
    draft.port = Number.parseInt(draft.port, 10) || 8768;
    await api.saveWebui(draft);
    hydrateConfig(await api.config(), "默认环境与 Web UI 偏好已保存");
  } catch (error) {
    showError(error);
  }
}

function resetWebuiDraft() {
  store.mutate((state) => {
    state.webuiDraft = { ...state.webuiPrefs };
    state.notice = "已恢复为上次保存的 Web UI 配置";
  });
}

function openNewEnvDialog() {
  const firstEnv = store.get().envId || store.get().envs?.[0]?.id || "";
  store.update({ newEnvDialog: true, newEnvDraft: { id: "", cloneFrom: firstEnv } });
}

async function createEnv() {
  const state = store.get();
  const id = String(state.newEnvDraft.id || "").trim();
  if (!id) return store.update({ error: "环境标识不能为空。" });
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    return store.update({ error: "环境标识只能包含字母、数字、横线和下划线。" });
  }
  if (state.envs.some((env) => env.id === id)) {
    return store.update({ error: `环境 ${id} 已存在。` });
  }
  const cloneId = state.newEnvDraft.cloneFrom;
  const clone = cloneId ? state.envDrafts[cloneId] : null;
  const draft = clone ? JSON.parse(JSON.stringify(clone)) : defaultEnvTemplate(id);
  draft.id = id;
  draft.name = id;
  if (draft.credentials) draft.credentials.password = "";
  try {
    await api.saveEnv(id, environmentPayloadFromDraft(draft));
    hydrateConfig(await api.config(), `已创建环境 ${id}`);
    store.mutate((draftState) => {
      draftState.newEnvDialog = false;
      draftState.newEnvDraft = { id: "", cloneFrom: "" };
      draftState.envExpanded[id] = true;
    });
  } catch (error) {
    showError(error);
  }
}

function toggleEnv(envId) {
  store.mutate((state) => {
    state.envExpanded[envId] = state.envExpanded[envId] === false;
  });
}

function toggleEnvSecret(envId) {
  store.mutate((state) => {
    state.envShowPwd[envId] = !state.envShowPwd[envId];
  });
}

async function saveEnvironment(envId) {
  const draft = store.get().envDrafts[envId];
  if (!draft) return;
  if (!draft.base_url) return store.update({ error: "Base URL 不能为空。" });
  try {
    await api.saveEnv(envId, environmentPayloadFromDraft(draft));
    hydrateConfig(await api.config(), `环境 ${envId} 已保存`);
  } catch (error) {
    showError(error);
  }
}

function resetEnvironmentDraft(envId) {
  const env = store.get().envs.find((item) => item.id === envId);
  if (!env) return;
  store.mutate((state) => {
    state.envDrafts[envId] = makeEnvDraft(env);
    state.notice = `已重置环境 ${envId} 的未保存更改`;
  });
}

async function deleteEnvironment(envId) {
  if (!envId || !confirm(`确认删除环境 ${envId}？`)) return;
  try {
    await api.deleteEnv(envId);
    hydrateConfig(await api.config(), `环境 ${envId} 已删除`);
  } catch (error) {
    showError(error);
  }
}

async function setDefaultEnvironment(envId) {
  if (!envId) return;
  try {
    await api.saveWebui({ default_env: envId });
    store.update({ envId });
    hydrateConfig(await api.config(), `默认环境已切换为 ${envId}`);
    if (store.get().selectedCase) await loadCase(store.get().selectedCase);
  } catch (error) {
    showError(error);
  }
}

async function selectCase(name) {
  store.update({ selectedCase: name, caseTab: "overview", mobileCasesOpen: false });
  await loadCase(name);
}

async function loadCase(name) {
  if (!name) return;
  store.update({ busy: true, error: "", notice: "正在加载用例工作区" });
  try {
    const detail = await api.caseDetail(name, store.get().envId);
    const drafts = Object.fromEntries((detail.field_catalog || []).map((field) => [field.field_id, field.user_override ?? ""]));
    store.update({ caseDetail: detail, fieldDrafts: drafts, busy: false, notice: "" });
  } catch (error) {
    showError(error);
  }
}

async function refreshCases() {
  try {
    store.update({ cases: await api.cases(), notice: "用例列表已刷新" });
  } catch (error) {
    showError(error);
  }
}

async function refreshReadiness() {
  try {
    const readiness = await api.readiness(store.get().selectedCase, store.get().envId);
    store.mutate((state) => { state.caseDetail.readiness = readiness; state.notice = "执行前检查已更新"; });
  } catch (error) {
    showError(error);
  }
}

async function saveVariables() {
  const state = store.get();
  const fields = {};
  for (const field of state.caseDetail?.field_catalog || []) {
    const value = state.fieldDrafts[field.field_id];
    if (value !== field.user_override) fields[field.field_id] = { user_override: value };
  }
  const validationPoints = Object.fromEntries(
    [...document.querySelectorAll("[data-validation-id]")].map((item) => [item.dataset.validationId, item.checked])
  );
  try {
    const data = await api.saveVariables(state.selectedCase, {
      env_id: state.envId,
      fields,
      validation_points: validationPoints,
    });
    store.update({ caseDetail: data.detail, notice: "业务变量已保存，readiness 已重新计算" });
  } catch (error) {
    showError(error);
  }
}

function batchFieldChange(restore) {
  store.mutate((state) => {
    for (const fieldId of state.selectedFields) {
      const field = state.caseDetail.field_catalog.find((item) => item.field_id === fieldId);
      state.fieldDrafts[fieldId] = restore ? field.recorded_value ?? "" : "";
    }
  });
}

async function resolveField(fieldId) {
  const state = store.get();
  const field = state.caseDetail.field_catalog.find((item) => item.field_id === fieldId);
  if (!field?.resolver_contract) return;
  const contract = { ...field.resolver_contract };
  const draft = state.fieldDrafts[fieldId];
  if (draft) {
    contract.value_code = draft;
    contract.value_name = draft;
    contract.resolve_by = "value_code";
  }
  store.update({ notice: `正在精确查询 ${field.label}`, error: "" });
  try {
    const data = await api.resolveFields({ env_id: state.envId, har_file: "", fields: [contract] });
    const result = data.fields?.[0] || { resolve_status: "error", message: "解析服务未返回结果" };
    store.mutate((draftState) => {
      draftState.resolverResults[fieldId] = result;
      draftState.notice = result.resolve_status === "resolved" ? "已唯一解析，可保存目标环境值" : result.message || "需要选择唯一结果";
    });
    if (result.resolve_status === "resolved") await persistResolution(fieldId, result);
  } catch (error) {
    store.mutate((draftState) => {
      draftState.resolverResults[fieldId] = {
        resolve_status: "error",
        message: error.message,
        candidates: [],
      };
      if (draftState.caseDetail?.readiness) {
        draftState.caseDetail.readiness = {
          ...draftState.caseDetail.readiness,
          state: "environment_unavailable",
          title: "环境不可用",
          allow_run: false,
          issues: [{
            code: "resolver_environment_error",
            reason: `${field.label} 解析失败：${error.message}`,
            affected_step: field.source_step_id || "",
            suggested_action: "检查目标环境连通性与认证后重新精确查询。",
            confirmable: false,
            severity: "critical",
          }, ...(draftState.caseDetail.readiness.issues || [])],
        };
      }
      draftState.error = error.message;
      draftState.errorAction = "检查目标环境连通性与认证后重新查询。";
      draftState.notice = "";
    });
  }
}

async function applyCandidate(fieldId, index) {
  const result = store.get().resolverResults[fieldId];
  const candidate = result?.candidates?.[index];
  if (!candidate) return;
  await persistResolution(fieldId, {
    resolve_status: "resolved",
    resolved_value_id: candidate.id || candidate.value_id || candidate.pk,
    resolved_value_name: candidate.name || candidate.display_name || "",
    resolved_value_code: candidate.number || candidate.code || "",
    confidence: "user_confirmed",
  });
}

async function persistResolution(fieldId, resolution) {
  try {
    const data = await api.applyResolution(store.get().selectedCase, { field_id: fieldId, resolution });
    store.update({ caseDetail: data.detail, notice: "目标环境解析结果已保存" });
  } catch (error) {
    showError(error);
  }
}

async function startRun() {
  const state = store.get();
  if (!state.selectedCase || !state.caseDetail?.readiness?.allow_run) return;
  store.update({ busy: true, error: "", notice: "正在启动执行", diagnosis: null, repairPreview: null });
  try {
    const started = await api.runCase(state.selectedCase, state.envId);
    store.update({ runId: started.run_id, view: "execution", notice: "", busy: false });
    await restoreRun(started.run_id);
  } catch (error) {
    showError(error);
  }
}

async function restoreRun(runId) {
  try {
    const run = await api.runSnapshot(runId);
    store.update({ runId, run, selectedCase: run.case_name || store.get().selectedCase });
    if (run.state === "running") subscribeRun(runId, run.events?.at(-1)?.seq || 0);
    if (run.state === "failed" && store.get().view === "diagnosis") {
      await loadDiagnosis(false);
    }
  } catch (error) {
    store.update({ runId: "", run: null });
  }
}

function subscribeRun(runId, afterSeq = 0) {
  eventSource?.close();
  eventSource = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?after_seq=${afterSeq}`);
  const eventTypes = [
    "case_start", "preflight_start", "preflight_ok", "preflight_fail",
    "step_start", "pageid_trace", "step_ok", "step_warning", "step_fail",
    "retry", "assertion_ok", "assertion_fail", "failure_analysis",
    "fixes_ready", "env_fields_resolved", "cancel_requested",
    "case_cancelled", "case_error", "case_done",
  ];
  eventTypes.forEach((type) => eventSource.addEventListener(type, () => scheduleRunRefresh(runId)));
  eventSource.addEventListener("close", async () => {
    eventSource.close();
    await refreshRun(runId);
  });
  eventSource.onerror = () => scheduleRunRefresh(runId);
}

function scheduleRunRefresh(runId) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshRun(runId), 120);
}

async function refreshRun(runId) {
  try {
    const run = await api.runSnapshot(runId);
    store.update({ run });
    if (run.state !== "running") {
      eventSource?.close();
      await refreshRuns(false);
      if (run.state === "failed") await loadDiagnosis(false);
    }
  } catch (error) {
    showError(error);
  }
}

async function cancelRun() {
  try {
    const data = await api.cancelRun(store.get().runId);
    store.update({ notice: data.message });
  } catch (error) {
    showError(error);
  }
}

async function refreshRuns(renderNotice = true) {
  try {
    const data = await api.runs(50);
    store.update({ runs: data.runs || [], notice: renderNotice ? "运行历史已刷新" : "" });
  } catch (error) {
    showError(error);
  }
}

async function openRun(runId) {
  store.update({ runId, view: "execution", diagnosis: null, repairPreview: null });
  await restoreRun(runId);
}

async function openDiagnosis(runId = "") {
  if (runId && runId !== store.get().runId) {
    store.update({ runId, diagnosis: null, repairPreview: null });
    await restoreRun(runId);
  }
  await loadDiagnosis(true);
}

async function copyAiTroubleshootingInfo(runId = "") {
  const state = store.get();
  const run = (
    runId && state.run?.run_id !== runId
      ? state.runs.find((item) => item.run_id === runId)
      : state.run
  ) || state.run || state.runs.find((item) => item.run_id === runId);
  if (!run) {
    return store.update({ error: "没有找到可复制的运行证据。" });
  }
  const text = buildAiTroubleshootingPrompt(run);
  try {
    await writeClipboard(text);
    store.update({ notice: "已复制脱敏排障信息，可直接粘贴给 AI 分析。", error: "", diagnosticCopyText: "" });
  } catch (error) {
    store.update({
      error: "浏览器不允许直接写入剪贴板，排障信息已展开，可手动复制。",
      errorAction: error.message,
      diagnosticCopyText: text,
    });
  }
}

async function writeClipboard(text) {
  try {
    window.focus();
  } catch {}
  if (navigator.clipboard?.writeText && document.hasFocus()) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) throw new Error("浏览器拒绝写入剪贴板");
}

async function loadDiagnosis(switchView = true) {
  if (!store.get().runId) return;
  try {
    const diagnosis = await api.diagnosis(store.get().runId);
    store.update({ diagnosis, view: switchView ? "diagnosis" : store.get().view });
  } catch (error) {
    showError(error);
  }
}

async function previewRepair(index) {
  const repair = store.get().diagnosis?.repair_plan?.[index];
  if (!repair) return;
  try {
    const preview = await api.previewRepair(store.get().selectedCase, repair);
    store.update({ repairPreview: preview });
  } catch (error) {
    showError(error);
  }
}

async function applyRepair() {
  const checkbox = document.querySelector("#confirm-repair");
  if (!checkbox?.checked) {
    store.update({ error: "请先审查并确认修复差异。" });
    return;
  }
  try {
    const data = await api.applyRepair(store.get().selectedCase, store.get().repairPreview.repair);
    store.update({
      caseDetail: data.detail,
      repairPreview: null,
      notice: "修复已应用，请重新执行 readiness 和用例",
      view: "cases",
      caseTab: "variables",
    });
  } catch (error) {
    showError(error);
  }
}

async function previewImport(file) {
  store.update({ busy: true, importFile: file, notice: `正在解析 ${file.name}` });
  try {
    const data = await api.previewHar(file, store.get().envId);
    store.update({ busy: false, importPreview: data, notice: "HAR 建模完成" });
  } catch (error) {
    showError(error);
  }
}

async function generateImport() {
  const state = store.get();
  const caseName = document.querySelector("#import-case-name")?.value || state.importFile?.name?.replace(/\.har$/i, "") || "untitled";
  try {
    const data = await api.extractHar({
      har_file: state.importPreview.har_file,
      case_name: caseName,
      env_id: state.envId,
    });
    const cases = await api.cases();
    store.update({ cases, importMode: false, importPreview: null, importFile: null, selectedCase: data.name });
    await loadCase(data.name);
  } catch (error) {
    showError(error);
  }
}

function showError(error) {
  store.update({
    busy: false,
    error: error.message,
    errorAction: error.suggestedAction || "",
    notice: "",
  });
}
