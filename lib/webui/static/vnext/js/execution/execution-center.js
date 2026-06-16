import { escapeHtml, formatDuration, formatTime, statusTone } from "../utils.js?v=20260615-2";
import { renderLogViewer } from "../logs/log-viewer.js?v=20260615-2";
import { runOutcomeModel, failureReason } from "../reports/run-diagnostics.js?v=20260616-1";

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
    ${renderOutcomeHero(run)}
    ${renderCopyFallback(state)}
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
    ${renderRuntimeValues(run)}
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

function renderCopyFallback(state) {
  if (!state.diagnosticCopyText) return "";
  return `
    <section class="copy-fallback-panel">
      <div>
        <strong>排障信息已生成</strong>
        <span>浏览器拦截了自动复制，你可以从这里手动复制后丢给 AI 排查。</span>
      </div>
      <textarea class="input" readonly>${escapeHtml(state.diagnosticCopyText)}</textarea>
      <button class="btn" data-action="close-copy-fallback">收起</button>
    </section>`;
}

function renderOutcomeHero(run) {
  const model = runOutcomeModel(run);
  const failed = run.state === "failed";
  return `
    <section class="execution-result-hero is-${model.tone}">
      <div>
        <span class="result-kicker">${escapeHtml(run.env_id || "目标环境")}</span>
        <h2>${escapeHtml(model.title)}</h2>
        <p>${escapeHtml(model.subtitle)}</p>
      </div>
      <div class="execution-result-actions">
        ${failed ? '<button class="btn btn-primary" data-action="open-diagnosis">交给 AI 排查</button>' : ""}
        ${failed ? '<button class="btn" data-action="copy-ai-prompt">复制AI排障信息</button>' : ""}
      </div>
    </section>`;
}

function renderRuntimeValues(run) {
  const runtime = run.runtime_values || {};
  const variables = runtime.variables || [];
  const fields = runtime.fields || [];
  if (!variables.length && !fields.length) {
    return `
      <section class="runtime-values-section">
        <div class="section-toolbar">
          <div><strong>执行值快照</strong><span>等待 runner 解析变量</span></div>
        </div>
        <div class="empty-state compact">本次运行尚未产生可展示的变量或业务字段值。</div>
      </section>`;
  }
  return `
    <section class="runtime-values-section">
      <div class="section-toolbar">
        <div><strong>执行值快照</strong><span>${variables.length} 个变量 · ${fields.length} 个业务字段</span></div>
        <span class="muted">用于去目标环境核对是否真的生成了对应数据</span>
      </div>
      <div class="runtime-values-grid">
        <div class="runtime-values-panel">
          <h3>运行时变量</h3>
          <div class="runtime-table-wrap">
            <table class="runtime-table">
              <thead><tr><th>变量</th><th>模板/录制值</th><th>执行值</th></tr></thead>
              <tbody>
                ${variables.map((item) => `
                  <tr>
                    <td><strong>${escapeHtml(item.label || item.key)}</strong><small>${escapeHtml(item.key)}</small></td>
                    <td class="value-cell">${escapeHtml(shortValue(item.template_value ?? item.recorded_value))}</td>
                    <td class="value-cell final-value">${escapeHtml(shortValue(item.resolved_value))}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
        <div class="runtime-values-panel">
          <h3>业务字段最终值</h3>
          <div class="runtime-table-wrap">
            <table class="runtime-table">
              <thead><tr><th>字段</th><th>录制值</th><th>用户值</th><th>环境解析</th><th>最终请求值</th></tr></thead>
              <tbody>
                ${fields.map((item) => `
                  <tr>
                    <td><strong>${escapeHtml(item.label || item.field_id)}</strong><small>${escapeHtml(item.field_key || item.field_id)}</small></td>
                    <td class="value-cell">${escapeHtml(shortValue(item.recorded_value))}</td>
                    <td class="value-cell">${escapeHtml(shortValue(item.user_override))}</td>
                    <td class="value-cell">${escapeHtml(shortValue(item.environment_resolved_value))}</td>
                    <td class="value-cell final-value">${escapeHtml(shortValue(item.final_request_value))}</td>
                  </tr>
                `).join("") || '<tr><td colspan="5" class="empty-state compact">没有可维护业务字段</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ${run.state === "failed" ? `<div class="failure-reason"><strong>错误原因</strong><span>${escapeHtml(failureReason(run))}</span></div>` : ""}
    </section>`;
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
  running: "执行中", passed: "通过", failed: "失败", cancelled: "已停止",
})[state] || state;

function shortValue(value) {
  const text = value === undefined || value === null || value === "" ? "-" : String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
