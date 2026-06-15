export function renderTechnicalDrawer(state) {
  const payload = {
    scenario: state.preview?.scenario,
    generation_gate: state.preview?.generation_gate,
    ir: state.preview?.ir_preview,
    pageid: state.preview?.pageid_source_graph,
    execution_plan: state.preview?.execution_plan,
    run_id: state.runId,
    result: state.result,
    recent_events: state.runEvents.slice(-20),
  };
  return `
    <button class="drawer-toggle" id="technical-toggle">
      <strong>技术诊断</strong>
      <span>${state.technicalOpen ? "收起" : "展开"} · YAML / pageId / IR / 证据包</span>
    </button>
    <div class="drawer-body"><pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre></div>
  `;
}

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

