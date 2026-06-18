import { api } from "../api-client.js";
import { renderResult } from "../components/result-summary.js";
import { openCaseDetail } from "./case-detail.js";
import { runBatchTask, openReport } from "./report-workspace.js";
import {
  bindFolderTree,
  caseInFolder,
  casesUnderFolder,
  renderFolderTree,
} from "../components/folder-tree.js";

// 当前文件夹（含子孙）+ 搜索 过滤后的用例列表
function visibleCases(state) {
  let list = (state.cases || []).filter((c) => caseInFolder(c.name, state.currentFolder));
  const q = (state.caseSearch || "").trim().toLowerCase();
  if (q) {
    list = list.filter((c) =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.display_name || "").toLowerCase().includes(q) ||
      (c.description || "").toLowerCase().includes(q));
  }
  return list;
}

function folderBreadcrumb(state) {
  if (!state.currentFolder) return escapeHtml(state.rootLabel);
  return escapeHtml(state.rootLabel) + " / " + escapeHtml(state.currentFolder.replaceAll("/", " / "));
}

export function renderRunWorkspace(state) {
  const list = visibleCases(state);
  const checked = new Set(state.checkedCases || []);
  const allChecked = list.length > 0 && list.every((c) => checked.has(c.name));
  const moveDialog = state.showMoveDialog ? renderMoveDialog(state) : "";
  return `
    <div class="tree-table-layout">
      ${renderFolderTree(state)}
      <section class="panel tree-table-main">
        <div class="panel-header">
          <h2>${folderBreadcrumb(state)}</h2>
          <div class="toolbar">
            <input class="input" id="case-search" placeholder="搜索用例" value="${escapeHtml(state.caseSearch)}" style="width:160px">
            <button class="btn" id="refresh-cases">刷新</button>
            ${state.taskId ? '<button class="btn" id="open-report">查看报告</button>' : ""}
          </div>
        </div>
        <div class="panel-body">
          <div class="toolbar batch-bar ${checked.size ? "" : "is-hidden"}">
            <span class="cell-muted">已选 <strong>${checked.size}</strong> 项</span>
            <span style="flex:1"></span>
            <button class="btn" id="batch-move">移动到文件夹</button>
            <button class="btn btn-danger" id="batch-delete">批量删除</button>
            <button class="btn btn-primary" id="batch-run" ${state.busy ? "disabled" : ""}>运行选中</button>
            <button class="btn" id="batch-clear">取消</button>
          </div>
          <div class="table-wrap">
            <table class="field-table case-table">
              <thead><tr>
                <th style="width:34px"><input type="checkbox" id="check-all" ${allChecked ? "checked" : ""}></th>
                <th>用例</th>
                <th style="width:90px">步骤</th>
                <th style="width:110px">最近结果</th>
                <th style="width:110px">操作</th>
              </tr></thead>
              <tbody>
                ${list.map((item) => renderRow(item, checked, state)).join("") ||
                  '<tr><td colspan="5" class="empty-state">该文件夹下没有用例。</td></tr>'}
              </tbody>
            </table>
          </div>
          <div class="toolbar" style="margin-top:12px">
            <span class="cell-muted">${state.runId ? `run_id ${state.runId}` : "勾选用例后可批量运行，或点击单条“运行”"}</span>
          </div>
          <div class="run-log">${renderEvents(state.runEvents)}</div>
        </div>
      </section>
    </div>
    ${moveDialog}`;
}

function renderRow(item, checked, state) {
  const selected = state.selectedCase === item.name ? "is-selected-row" : "";
  const resultBadge = item.last_result === "PASS"
    ? '<span class="badge is-success">通过</span>'
    : item.last_result === "FAIL"
      ? '<span class="badge is-danger">失败</span>'
      : '<span class="cell-muted">—</span>';
  return `
    <tr class="${selected}">
      <td><input type="checkbox" data-check-case="${escapeHtml(item.name)}" ${checked.has(item.name) ? "checked" : ""}></td>
      <td class="field-name">
        <strong>${escapeHtml(item.display_name || item.name)}${renderStabilityBadge(item.name, state)}</strong>
        <small>${escapeHtml(item.description || item.file || "")}</small>
      </td>
      <td>${item.step_count ?? "—"}</td>
      <td>${resultBadge}</td>
      <td>
        <button class="btn" data-detail-case="${escapeHtml(item.name)}">详情</button>
        <button class="btn" data-run-one="${escapeHtml(item.name)}" ${state.busy ? "disabled" : ""}>运行</button>
      </td>
    </tr>`;
}

// ⭐ P2: 用例稳定性徽标（flaky 才打扰，稳定不打扰）
function renderStabilityBadge(name, state) {
  const st = state.stability?.[name];
  if (!st || !st.is_flaky) return "";
  const rate = st.pass_rate != null ? Math.round(st.pass_rate * 100) + "%" : "—";
  return ` <span class="badge is-flaky" title="近 ${st.total_runs ?? 0} 次通过率 ${rate}，结果不稳定">不稳定 ${rate}</span>`;
}

function renderMoveDialog(state) {
  return `
    <div class="modal-mask" id="move-mask">
      <div class="modal-card">
        <h2>移动到文件夹</h2>
        <p class="cell-muted">将选中的 <strong>${(state.checkedCases || []).length}</strong> 条用例移动到目标文件夹（保留用例名）。</p>
        <label class="cell-muted" style="display:block;margin:10px 0 4px">目标文件夹</label>
        <select class="select" id="move-target" style="width:100%">
          <option value="">${escapeHtml(state.rootLabel)}（根节点）</option>
          ${(state.folders || []).map((f) =>
            `<option value="${escapeHtml(f)}" ${f === state.moveTargetFolder ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
        </select>
        <div class="toolbar" style="margin-top:16px;justify-content:flex-end">
          <button class="btn" id="move-cancel">取消</button>
          <button class="btn btn-primary" id="move-confirm">确认移动</button>
        </div>
      </div>
    </div>`;
}

export function renderResultWorkspace(state) {
  return renderResult(state);
}

export function bindRunWorkspace(store) {
  const reload = () => reloadFoldersAndCases(store);
  // 仅在执行阶段绑定（其它阶段无这些节点时跳过）
  if (document.querySelector(".tree-table-layout")) {
    bindFolderTree(store, reload);
    // ⭐ 进入执行页且尚未拉取稳定性时惰性加载一次
    const s = store.get();
    if (s.stage === "run" && !Object.keys(s.stability || {}).length) {
      loadStability(store, s.cases);
    }
  }
  document.querySelector("#refresh-cases")?.addEventListener("click", reload);
  document.querySelector("#case-search")?.addEventListener("input", (e) => {
    store.mutate((draft) => { draft.caseSearch = e.target.value; });
  });
  // 勾选
  document.querySelectorAll("[data-check-case]").forEach((el) => {
    el.addEventListener("change", () => {
      const name = el.dataset.checkCase;
      store.mutate((draft) => {
        const set = new Set(draft.checkedCases);
        el.checked ? set.add(name) : set.delete(name);
        draft.checkedCases = Array.from(set);
      });
    });
  });
  document.querySelector("#check-all")?.addEventListener("change", (e) => {
    const list = visibleCases(store.get()).map((c) => c.name);
    store.mutate((draft) => {
      const set = new Set(draft.checkedCases);
      e.target.checked ? list.forEach((n) => set.add(n)) : list.forEach((n) => set.delete(n));
      draft.checkedCases = Array.from(set);
    });
  });
  // 单条运行
  document.querySelectorAll("[data-run-one]").forEach((el) => {
    el.addEventListener("click", () => runCases(store, [el.dataset.runOne]));
  });
  // 进入用例详情
  document.querySelectorAll("[data-detail-case]").forEach((el) => {
    el.addEventListener("click", () => openCaseDetail(store, el.dataset.detailCase));
  });
  // 批量操作
  document.querySelector("#batch-clear")?.addEventListener("click", () => store.update({ checkedCases: [] }));
  document.querySelector("#batch-run")?.addEventListener("click", () => runBatchTask(store, store.get().checkedCases));
  document.querySelector("#open-report")?.addEventListener("click", () => openReport(store, store.get().taskId));
  document.querySelector("#batch-delete")?.addEventListener("click", () => batchDelete(store));
  document.querySelector("#batch-move")?.addEventListener("click", () =>
    store.update({ showMoveDialog: true, moveTargetFolder: store.get().currentFolder || "" }));
  // 移动对话框
  document.querySelector("#move-cancel")?.addEventListener("click", () => store.update({ showMoveDialog: false }));
  document.querySelector("#move-mask")?.addEventListener("click", (e) => {
    if (e.target.id === "move-mask") store.update({ showMoveDialog: false });
  });
  document.querySelector("#move-target")?.addEventListener("change", (e) =>
    store.mutate((draft) => { draft.moveTargetFolder = e.target.value; }));
  document.querySelector("#move-confirm")?.addEventListener("click", () => confirmMove(store));
}

export async function refreshCases(store) {
  try {
    store.update({ cases: await api.cases() });
  } catch (error) {
    store.update({ error: error.message });
  }
}

export async function reloadFoldersAndCases(store) {
  try {
    const [foldersResp, cases] = await Promise.all([api.folders(), api.cases()]);
    store.update({ folders: foldersResp.folders || [], cases });
    loadStability(store, cases);
  } catch (error) {
    store.update({ error: error.message });
  }
}

// ⭐ P2: 并发拉取可见用例的稳定性（容错：失败按非 flaky，限制并发避免阻塞首屏）
async function loadStability(store, cases) {
  const list = (cases || []).map((c) => c.name).filter(Boolean);
  if (!list.length) return;
  const BATCH = 6;
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    const results = await Promise.all(slice.map((name) =>
      api.caseStability(name).then((st) => [name, st]).catch(() => [name, null])));
    store.mutate((draft) => {
      results.forEach(([name, st]) => {
        if (st) draft.stability = { ...draft.stability, [name]: st };
      });
    });
  }
}

async function batchDelete(store) {
  const names = store.get().checkedCases || [];
  if (!names.length) return;
  if (!confirm(`确认删除 ${names.length} 条用例？此操作不可撤销。`)) return;
  try {
    const data = await api.batchDeleteCases(names);
    store.update({ checkedCases: [], notice: `已删除 ${data.count} 条用例` });
    await reloadFoldersAndCases(store);
  } catch (error) {
    store.update({ error: error.message });
  }
}

async function confirmMove(store) {
  const state = store.get();
  const names = state.checkedCases || [];
  if (!names.length) { store.update({ showMoveDialog: false }); return; }
  try {
    const data = await api.batchMoveCases(names, state.moveTargetFolder || "");
    let msg = `已移动 ${data.count} 条用例`;
    if (data.skipped?.length) msg += `，${data.skipped.length} 条已在目标`;
    if (data.errors?.length) msg += `，${data.errors.length} 条失败`;
    store.update({ showMoveDialog: false, checkedCases: [], currentFolder: state.moveTargetFolder || "", notice: msg });
    await reloadFoldersAndCases(store);
  } catch (error) {
    store.update({ showMoveDialog: false, error: error.message });
  }
}

async function runCases(store, names) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return;
  const state = store.get();
  // 串行执行：依次运行每个用例，复用事件流订阅
  store.update({ busy: true, error: "", result: null, runEvents: [], notice: `正在执行 ${list.length} 个用例` });
  runQueue(store, list, 0, state.envId);
}

function runQueue(store, list, index, envId) {
  if (index >= list.length) {
    store.update({ busy: false, notice: `已完成 ${list.length} 个用例` });
    return;
  }
  const name = list[index];
  store.update({ selectedCase: name, notice: `正在执行 ${name}（${index + 1}/${list.length}）` });
  api.runCase(name, envId).then((run) => {
    store.update({ runId: run.run_id });
    subscribeRun(run.run_id, store, () => runQueue(store, list, index + 1, envId));
  }).catch((error) => {
    store.mutate((draft) => { draft.runEvents.push({ type: "case_error", data: { error: error.message }, ts: new Date().toLocaleTimeString() }); });
    runQueue(store, list, index + 1, envId);
  });
}

function subscribeRun(runId, store, onDone, options = {}) {
  const source = new EventSource(`/api/runs/${runId}/events`);
  const eventTypes = [
    "step_start", "step_ok", "step_fail", "assertion_ok", "assertion_fail",
    "failure_analysis", "env_fields_resolved", "case_error", "case_done",
  ];
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    source.close();
    onDone && onDone();
  };
  eventTypes.forEach((type) => source.addEventListener(type, (event) => {
    const data = JSON.parse(event.data || "{}");
    store.mutate((state) => {
      state.runEvents.push({ type, data, ts: new Date().toLocaleTimeString() });
      applyDetailEvent(state, type, data);
      if (type === "case_done") {
        state.result = data;
        if (!options.detail) state.stage = "result";
      }
      if (type === "case_error") {
        state.result = { passed: false, error: data.error, result_evidence: { outcome: "business_failed", request_success: false } };
      }
    });
    if (type === "case_done" || type === "case_error") finish();
  }));
  source.addEventListener("close", finish);
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) finish();
  };
}

// ⭐ 将 SSE 事件映射为详情态 phases / summary / failureAnalysis（与后端重建逻辑对齐）
function applyDetailEvent(state, type, data) {
  if (type === "step_start" || type === "step_ok" || type === "step_fail") {
    const id = data.id || data.step_id || "";
    if (!id) return;
    let phase = (state.phases || []).find((p) => p.id === id);
    if (!phase) {
      phase = { id, label: id, detail: "", status: "running", errors: [] };
      state.phases.push(phase);
    }
    if (type === "step_start") {
      phase.label = data.label || data.description || id;
      phase.detail = data.detail || data.description || "";
      phase.status = "running";
      phase.business_stage = data.business_stage || phase.business_stage || "";
    } else if (type === "step_ok") {
      phase.status = "ok";
      phase.duration_ms = data.duration_ms;
      phase.response = data.response;
    } else if (type === "step_fail") {
      phase.status = "fail";
      phase.duration_ms = data.duration_ms;
      phase.errors = data.errors || (data.error ? [data.error] : []);
      phase.response = data.response;
    }
  } else if (type === "failure_analysis") {
    state.failureAnalysis = data;
  } else if (type === "env_fields_resolved") {
    state.envFields = data.fields || [];
  } else if (type === "case_done") {
    state.summary = data;
  }
}

// ⭐ 详情页：单次运行 + 失败后拉诊断与修复计划
export async function runSingleWithDiagnosis(store, name) {
  const envId = store.get().envId;
  store.update({
    running: true, busy: true, error: "", detailTab: "result",
    phases: [], summary: null, failureAnalysis: null, repairPlan: [],
    singleRunDiagnosis: null, runEvents: [], envFields: [],
    selectedCase: name, currentCase: name,
  });
  try {
    const run = await api.runCase(name, envId);
    store.update({ runId: run.run_id });
    subscribeRun(run.run_id, store, async () => {
      const s = store.get();
      const passed = Boolean(s.summary?.passed);
      if (!passed) {
        try {
          const diag = await api.runDiagnosis(run.run_id, name);
          store.update({ singleRunDiagnosis: diag });
          const plan = await api.repairPlan(name, {
            failure_analysis: diag.failure_analysis || s.failureAnalysis || {},
            fixes: diag.fixes || s.fixes || [],
          });
          store.update({ repairPlan: plan.repair_plan || [] });
        } catch (e) {
          store.update({ error: e.message });
        }
      }
      store.update({ running: false, busy: false, notice: passed ? `用例 ${name} 执行通过` : `用例 ${name} 执行失败，已生成诊断` });
    }, { detail: true });
  } catch (error) {
    store.update({ running: false, busy: false, error: error.message });
  }
}

// ⭐ 应用安全修复并重跑
export async function applyRepairAndRerun(store, name) {
  const plan = store.get().repairPlan || [];
  const safe = plan.filter((r) => r && r.safe_to_apply);
  if (!safe.length) {
    store.update({ notice: "没有可自动应用的安全修复，请手动确认。" });
    return;
  }
  store.update({ busy: true, error: "" });
  try {
    let applied = 0;
    for (const repair of safe) {
      const resp = await api.applyRepair(name, { repair });
      if (resp.applied) applied += 1;
    }
    store.update({ busy: false, notice: `已应用 ${applied} 项安全修复，正在重跑…` });
    await runSingleWithDiagnosis(store, name);
  } catch (error) {
    store.update({ busy: false, error: error.message });
  }
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
  if (event.type === "case_error") return `执行出错 ${data.error || ""}`;
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
