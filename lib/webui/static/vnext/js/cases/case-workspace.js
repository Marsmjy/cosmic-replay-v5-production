import { escapeHtml, safeJson, formatTime } from "../utils.js?v=20260615-2";

export const CASE_TABS = [
  ["overview", "概览"],
  ["variables", "业务变量"],
  ["steps", "执行步骤"],
  ["contracts", "校验契约"],
  ["runs", "运行记录"],
  ["technical", "技术诊断"],
];

export function renderCaseHeader(state) {
  const item = state.caseDetail?.case;
  if (!item) {
    return `
      <div>
        <h1>用例工作区</h1>
        <p>选择一个用例，维护业务值并完成执行闭环。</p>
      </div>
      <button class="btn btn-primary" data-action="open-import">导入 HAR</button>`;
  }
  return `
    <div class="context-title">
      <button class="mobile-case-toggle" data-action="toggle-cases">用例库</button>
      <div>
        <h1>${escapeHtml(item.display_name)}</h1>
        <p>${escapeHtml(item.description || item.main_form_id || "")}</p>
      </div>
    </div>
    <div class="context-actions">
      <span class="schema-label">schema ${escapeHtml(item.schema_version)}</span>
      <button class="btn" data-action="refresh-case">刷新</button>
      <button class="btn btn-primary" data-action="go-execution">执行</button>
    </div>`;
}

export function renderCaseTabs(state) {
  if (!state.caseDetail) return "";
  return CASE_TABS.map(([id, label]) => `
    <button class="${state.caseTab === id ? "is-active" : ""}" data-case-tab="${id}">
      ${label}
    </button>`).join("");
}

export function renderOverview(detail) {
  const item = detail.case;
  const scenario = item.scenario || {};
  const readiness = detail.readiness || {};
  return `
    <section class="overview-grid">
      <div class="overview-section">
        <h2>业务模型</h2>
        <dl class="definition-list">
          ${definition("场景分类", scenario.kind || "未识别")}
          ${definition("支持状态", scenario.classification || scenario.support_status || "待确认")}
          ${definition("主表单", item.main_form_id || "未识别")}
          ${definition("业务字段", item.maintainable_field_count)}
          ${definition("执行步骤", item.step_count)}
          ${definition("写入锚点", item.write_anchor_count)}
          ${definition("建模时间", formatTime(item.modeled_at))}
          ${definition("规则版本", item.rule_version || "兼容模式")}
        </dl>
      </div>
      <div class="overview-section">
        <h2>执行约束</h2>
        <div class="compact-list">
          ${(readiness.issues || []).slice(0, 8).map((issue) => `
            <div><strong>${escapeHtml(issue.reason)}</strong>
            <span>${escapeHtml(issue.suggested_action)}</span></div>
          `).join("") || '<div><strong>未发现阻断项</strong><span>可以进入执行中心。</span></div>'}
        </div>
      </div>
      <div class="overview-section span-two">
        <h2>已知限制与需要确认</h2>
        <ul class="plain-list">
          ${(item.known_limitations || []).map((value) => `<li>${escapeHtml(value)}</li>`).join("")
            || "<li>暂无已知限制。</li>"}
        </ul>
      </div>
    </section>`;
}

export function renderSteps(detail) {
  return `
    <div class="section-toolbar">
      <div><strong>业务执行步骤</strong><span>${detail.steps.length} 步</span></div>
      <span class="muted">默认展示业务动作，原始请求收在展开区域</span>
    </div>
    <div class="step-list">
      ${detail.steps.map((step) => `
        <details class="step-detail" id="step-${escapeHtml(step.id)}">
          <summary>
            <span class="step-order">${step.order}</span>
            <span><strong>${escapeHtml(step.business_action)}</strong>
              <small>${escapeHtml(step.business_stage)} · ${escapeHtml(step.form_label || step.form_id || step.type)}</small>
            </span>
            <span class="step-flags">${step.optional ? "可选" : "关键"}</span>
          </summary>
          <div class="step-detail-body">
            ${detailBlock("输入字段", step.inputs)}
            ${detailBlock("前置条件", step.preconditions)}
            ${detailBlock("pageId 来源", step.page_context)}
            ${detailBlock("请求契约", step.request_contract)}
            ${detailBlock("响应契约", step.response_contract)}
            ${detailBlock("原始技术数据", step.raw)}
          </div>
        </details>
      `).join("")}
    </div>`;
}

export function renderContracts(detail) {
  const validation = detail.validation_points || [];
  return `
    <div class="contract-layout">
      <section>
        <div class="section-toolbar"><div><strong>校验点</strong><span>${validation.length} 项</span></div></div>
        <div class="validation-list">
          ${validation.map((point) => `
            <label class="validation-row">
              <input type="checkbox" data-validation-id="${escapeHtml(point.id)}"
                ${point.enabled || point.required ? "checked" : ""} ${point.required ? "disabled" : ""}>
              <span><strong>${escapeHtml(point.label || point.id)}</strong>
                <small>${escapeHtml(point.help || point.scope || point.category || "")}</small>
              </span>
              <em>${point.required ? "必需" : point.category === "system" ? "技术契约" : point.enabled ? "用户启用" : "建议"}</em>
            </label>
          `).join("") || '<div class="empty-state compact">未配置校验点</div>'}
        </div>
      </section>
      <section>
        <div class="section-toolbar"><div><strong>契约摘要</strong></div></div>
        ${detailBlock("写入锚点", detail.contracts.write_anchors)}
        ${detailBlock("请求契约", detail.contracts.request)}
        ${detailBlock("响应契约", detail.contracts.response)}
        ${detailBlock("Readback 契约", detail.contracts.readback)}
      </section>
    </div>`;
}

export function renderTechnical(detail) {
  return `
    <div class="technical-grid">
      ${detailBlock("YAML Schema", detail.technical.yaml_schema)}
      ${detailBlock("PageContextGraph", detail.technical.pageid_source_graph)}
      ${detailBlock("ExecutionPlan", detail.technical.execution_plan)}
      ${detailBlock("规则证据", detail.technical.rule_trace)}
      ${detailBlock("完整 Case Contract", detail.technical.case_contract)}
    </div>`;
}

export function renderEmptyCase() {
  return `
    <div class="empty-state workspace-empty">
      <strong>选择一个用例开始工作</strong>
      <p>变量维护、执行过程、日志和 AI 排故会在同一工作区串联。</p>
      <button class="btn btn-primary" data-action="open-import">导入 HAR</button>
    </div>`;
}

const definition = (label, value) =>
  `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;

const detailBlock = (label, value) => `
  <details class="json-detail">
    <summary>${label}</summary>
    <pre>${escapeHtml(safeJson(value))}</pre>
  </details>`;
