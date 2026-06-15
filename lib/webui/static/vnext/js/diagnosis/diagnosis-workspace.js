import { escapeHtml, safeJson } from "../utils.js?v=20260615-2";

export function renderDiagnosis(state) {
  const diagnosis = state.diagnosis;
  if (!state.runId) {
    return '<div class="empty-state workspace-empty"><strong>选择一次失败运行</strong><p>AI 排故只基于结构化运行证据。</p></div>';
  }
  if (!diagnosis) {
    return '<div class="empty-state workspace-empty"><strong>正在整理诊断上下文</strong><p>将汇总失败步骤、resolver、pageId、契约和日志证据。</p></div>';
  }
  return `
    <div class="diagnosis-layout">
      <section class="diagnosis-main">
        <div class="diagnosis-conclusion">
          <span>失败结论</span>
          <h2>${escapeHtml(diagnosis.failure_conclusion)}</h2>
          <p>${escapeHtml(diagnosis.root_cause_category)} · 影响步骤 ${escapeHtml(diagnosis.impact_scope?.failed_step || "待确认")}</p>
        </div>
        ${section("关键证据", `
          <div class="evidence-list">${(diagnosis.evidence || []).map((item) => `
            <div><span>${escapeHtml(item.kind)}</span><strong>${escapeHtml(item.summary)}</strong>
              <small>${escapeHtml(item.ref)}</small></div>`).join("")}</div>`)}
        ${section("建议操作", `<ol class="action-list">${(diagnosis.suggested_actions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`)}
        ${section("修复后验证", `<ol class="action-list">${(diagnosis.verification_after_fix || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`)}
      </section>
      <aside class="repair-panel">
        <div class="repair-heading"><strong>修改草案</strong><span>风险 ${escapeHtml(diagnosis.repair_risk)}</span></div>
        ${(diagnosis.repair_plan || []).map((repair, index) => `
          <button class="repair-option ${state.repairPreview?.repair?.id === repair.id ? "is-selected" : ""}"
            data-preview-repair="${index}">
            <strong>${escapeHtml(repair.title)}</strong>
            <span>${escapeHtml(repair.reason)}</span>
            <small>${repair.safe_to_apply ? "可生成安全草案" : "需要人工修改"}</small>
          </button>
        `).join("") || '<p class="muted">当前证据没有形成可自动应用的安全修复。</p>'}
        ${renderRepairPreview(state.repairPreview)}
      </aside>
    </div>
    <details class="diagnosis-context">
      <summary>查看完整脱敏上下文</summary>
      <pre>${escapeHtml(safeJson(diagnosis.context))}</pre>
    </details>`;
}

function renderRepairPreview(preview) {
  if (!preview) return "";
  return `
    <div class="diff-panel">
      <strong>应用前 Diff</strong>
      ${(preview.diff || []).map((item) => `
        <div class="diff-row"><span>${escapeHtml(item.path)}</span>
          <pre class="diff-before">- ${escapeHtml(safeJson(item.before))}</pre>
          <pre class="diff-after">+ ${escapeHtml(safeJson(item.after))}</pre>
        </div>
      `).join("") || '<p class="muted">该建议没有产生可应用差异。</p>'}
      <label class="confirm-row"><input type="checkbox" id="confirm-repair">我已审查差异和风险</label>
      <button class="btn btn-primary" data-action="apply-repair"
        ${preview.applied_to_preview ? "" : "disabled"}>应用修改</button>
    </div>`;
}

const section = (title, body) => `<section class="diagnosis-section"><h3>${title}</h3>${body}</section>`;
