import { escapeHtml, statusTone } from "../utils.js?v=20260615-2";

export function renderReadinessPanel(state) {
  const readiness = state.caseDetail?.readiness;
  if (!readiness) {
    return `<div class="readiness-empty"><strong>执行就绪检查</strong><p>选择用例后显示安全门槛。</p></div>`;
  }
  return `
    <div class="readiness-heading">
      <span>执行就绪检查</span>
      <button class="icon-btn" data-action="refresh-readiness" title="重新检查">↻</button>
    </div>
    <div class="readiness-conclusion is-${statusTone(readiness.state)}">
      <span class="readiness-icon">${readiness.state === "ready" ? "✓" : "!"}</span>
      <div><strong>${escapeHtml(readiness.title)}</strong>
        <small>${readiness.allow_run ? "未发现阻断问题" : `${readiness.issues?.length || 0} 个问题需要处理`}</small>
      </div>
    </div>
    <div class="readiness-issues">
      <h3>阻塞与提醒 (${readiness.issues?.length || 0})</h3>
      ${(readiness.issues || []).map((issue) => `
        <button class="readiness-issue" data-issue-step="${escapeHtml(issue.affected_step || "")}">
          <strong>${escapeHtml(issue.reason)}</strong>
          <span>${escapeHtml(issue.suggested_action)}</span>
          ${issue.confirmable ? "<em>可人工确认</em>" : ""}
        </button>
      `).join("") || '<p class="muted">无</p>'}
    </div>
    <dl class="readiness-summary">
      <div><dt>必填字段</dt><dd>${readiness.summary?.required_fields ?? 0}</dd></div>
      <div><dt>Resolver 失败</dt><dd>${readiness.summary?.resolver_failures ?? 0}</dd></div>
      <div><dt>契约错误</dt><dd>${readiness.summary?.contract_errors ?? 0}</dd></div>
      <div><dt>Schema 错误</dt><dd>${readiness.summary?.schema_errors ?? 0}</dd></div>
    </dl>
    <button class="btn btn-primary readiness-action" data-action="${readiness.allow_run ? "go-execution" : "fix-readiness"}">
      ${readiness.allow_run ? "进入执行中心" : "处理主要问题"}
    </button>`;
}
