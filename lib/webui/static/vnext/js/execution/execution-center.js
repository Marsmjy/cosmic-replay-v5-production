import { escapeHtml, formatDuration, formatTime, statusTone } from "../utils.js?v=20260615-2";
import { renderLogViewer } from "../logs/log-viewer.js?v=20260615-2";

export function renderExecutionCenter(state) {
  const run = state.run;
  if (!run) {
    return `
      <div class="execution-empty">
        <strong>${state.selectedCase ? "准备执行当前用例" : "尚未选择用例"}</strong>
        <p>${state.selectedCase ? "启动前将再次检查 readiness，运行过程来自真实 runner 事件。" : "先从用例库选择一个用例。"}</p>
        <button class="btn btn-primary" data-action="start-run"
          ${state.selectedCase && state.caseDetail?.readiness?.allow_run ? "" : "disabled"}>启动执行</button>
      </div>`;
  }
  const running = run.state === "running";
  return `
    <section class="execution-header">
      <div class="execution-conclusion">
        <span class="status-label is-${statusTone(run.state)}">${stateLabel(run.state)}</span>
        <div><h1>${escapeHtml(run.display_name || run.case_name || state.selectedCase)}</h1>
          <p>${escapeHtml(run.current_phase)} · ${run.completed_steps}/${run.total_steps} 步</p>
        </div>
      </div>
      <dl class="execution-meta">
        <div><dt>环境</dt><dd>${escapeHtml(run.env_id || state.envId || "未指定")}</dd></div>
        <div><dt>开始时间</dt><dd>${formatTime(run.started_at)}</dd></div>
        <div><dt>耗时</dt><dd>${formatDuration(run.duration_s)}</dd></div>
        <div><dt>run_id</dt><dd>${escapeHtml(run.run_id)}</dd></div>
      </dl>
      <div class="execution-actions">
        ${running
          ? '<button class="btn btn-danger" data-action="cancel-run">停止执行</button>'
          : '<button class="btn btn-primary" data-action="rerun">重新执行</button>'}
      </div>
    </section>
    <section class="timeline-section">
      <div class="section-toolbar"><div><strong>执行过程</strong><span>真实 runner 事件</span></div>
        <span class="muted">${escapeHtml(run.primary_action || "")}</span></div>
      <div class="run-timeline">
        ${(run.steps || []).map((step) => renderTimelineStep(step, state.focusedStep)).join("")
          || '<div class="empty-state compact">等待 runner 产生步骤事件</div>'}
      </div>
    </section>
    ${renderLogViewer(state)}
  `;
}

function renderTimelineStep(step, focusedStep) {
  return `
    <button class="timeline-row ${focusedStep === step.id ? "is-focused" : ""}"
      data-run-step="${escapeHtml(step.id)}">
      <span class="timeline-state is-${statusTone(step.state)}"></span>
      <span class="timeline-main"><strong>${escapeHtml(step.business_action)}</strong>
        <small>${escapeHtml(step.business_stage)}</small></span>
      <span class="timeline-checks">
        ${check("请求", step.request_success)}
        ${check("动作", step.action_success)}
        ${check("契约", step.contract_passed)}
        ${check("写入", step.write_verified)}
      </span>
      <span class="timeline-duration">${
        step.duration_ms == null
          ? (["sending", "running"].includes(step.state) ? "进行中" : "-")
          : `${step.duration_ms} ms`
      }</span>
      ${step.failure_summary ? `<span class="timeline-error">${escapeHtml(step.failure_summary)}</span>` : ""}
      ${step.retry ? `<span class="timeline-retry">重试 ${step.retry.attempt}</span>` : ""}
    </button>`;
}

const check = (label, value) =>
  `<span class="${value === true ? "is-pass" : value === false ? "is-fail" : ""}">${label}</span>`;

const stateLabel = (state) => ({
  running: "执行中", passed: "执行完成", failed: "业务失败", cancelled: "已停止",
})[state] || state;
