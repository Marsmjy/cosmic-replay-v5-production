export function readinessModel(state) {
  const gate = state.preview?.generation_gate || state.preview?.preflight?.generation_gate || {};
  const issues = gate.issues || [];
  const resolvedFailures = Object.values(state.resolvedFields || {})
    .filter((item) => ["ambiguous", "not_found", "error"].includes(item.resolve_status));
  if (!state.preview) {
    return { code: "needs_import", title: "等待导入 HAR", detail: "先建立场景与字段模型。", action: "选择 HAR", tone: "warning", issues: [] };
  }
  if (gate.decision === "unsupported" || state.preview.scenario?.kind === "unsupported") {
    return { code: "unsupported", title: "当前场景暂不支持", detail: "没有形成可信业务场景锚点。", action: "暂不支持", tone: "danger", issues };
  }
  if (!gate.allow_generate || !gate.allow_run) {
    return { code: "unsafe_chain", title: "链路不安全", detail: "pageId、写入锚点或契约存在阻断项。", action: "AI 修用例", tone: "danger", issues };
  }
  if (resolvedFailures.length) {
    return { code: "environment_unavailable", title: "目标环境字段无法唯一解析", detail: "零条、多条或环境查询失败都必须先处理。", action: "检查环境", tone: "danger", issues: resolvedFailures };
  }
  const missingDrafts = (state.preview.field_catalog || []).filter((field) =>
    field.need_confirm && !state.fieldDrafts[field.field_id]
  );
  if (missingDrafts.length) {
    return { code: "needs_fields", title: "需要确认业务字段", detail: `${missingDrafts.length} 个字段需要用户确认。`, action: "修改字段", tone: "warning", issues: missingDrafts };
  }
  return { code: "ready", title: "可以执行", detail: "生成门槛、字段绑定和目标环境解析已满足当前要求。", action: "生成并执行", tone: "success", issues };
}

export function renderReadiness(state, full = false) {
  const model = readinessModel(state);
  const tone = `is-${model.tone}`;
  const statusLabel = {
    needs_import: "等待导入",
    unsupported: "暂不支持",
    unsafe_chain: "链路不安全",
    environment_unavailable: "环境不可用",
    needs_fields: "需要修改字段",
    ready: "可执行",
  }[model.code] || model.code;
  if (!full) {
    return `
      <div class="inspector-card">
        <span class="badge ${tone}">${statusLabel}</span>
        <h2>${model.title}</h2>
        <p>${model.detail}</p>
        <ul class="inspector-list">
          <li><span>场景</span><strong>${state.preview?.scenario?.kind || "未识别"}</strong></li>
          <li><span>业务字段</span><strong>${state.preview?.field_catalog?.length || 0}</strong></li>
          <li><span>阻断项</span><strong>${(model.issues || []).length}</strong></li>
        </ul>
        <button class="btn btn-primary" data-primary-action="${model.code}">${model.action}</button>
      </div>`;
  }
  return `
    <section class="panel readiness-block">
      <span class="badge ${tone}">${statusLabel}</span>
      <h2>${model.title}</h2>
      <p>${model.detail}</p>
      <ul class="issue-list">
        ${(model.issues || []).slice(0, 12).map((issue) => `
          <li><strong>${issue.code || issue.label || issue.field_id || "检查项"}</strong>
          <span>${issue.message || issue.action || issue.form_id || "需要确认"}</span></li>
        `).join("") || "<li><strong>未发现阻断项</strong><span>可以进入执行阶段。</span></li>"}
      </ul>
    </section>`;
}
