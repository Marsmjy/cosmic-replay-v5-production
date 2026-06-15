export function renderResult(state) {
  const result = state.result;
  if (!result) return '<div class="empty-state">执行完成后，这里只显示一个业务结论和一个主要操作。</div>';
  const evidence = result.result_evidence || result.first_success_gate || {};
  const outcome = evidence.outcome || (result.passed ? "write_unverified" : "business_failed");
  const model = {
    query: ["查询通过", "查看业务证据", "success", "show_evidence", "查询"],
    write_verified: ["业务写入已验证", "查看业务证据", "success", "show_evidence", "写入已验证"],
    write_unverified: ["执行通过，入库待确认", "人工确认", "warning", "confirm_write", "写入待确认"],
    unsupported: ["当前场景暂不支持", "查看技术原因", "danger", "show_evidence", "暂不支持"],
    business_failed: [
      "业务执行失败",
      evidence.request_success === false ? "检查环境" : "AI 修用例",
      "danger",
      evidence.request_success === false ? "check_environment" : "repair_case",
      "业务失败",
    ],
  }[outcome] || ["需要人工判断", "查看业务证据", "warning", "show_evidence", "需要确认"];
  return `
    <section class="panel">
      <div class="result-hero">
        <div>
          <span class="badge is-${model[2]}">${model[4]}</span>
          <h2>${model[0]}</h2>
          <p>${escapeHtml(result.summary || result.error || "已按请求、动作、契约和业务证据完成分层判断。")}</p>
        </div>
        <button class="btn btn-primary" data-result-action="${model[3]}">${model[1]}</button>
      </div>
      <div class="evidence-grid">
        ${evidenceItem("请求成功", evidence.request_success)}
        ${evidenceItem("业务动作成功", evidence.action_success)}
        ${evidenceItem("契约通过", evidence.contract_passed)}
        ${evidenceItem("入库验证", evidence.write_verified)}
        ${evidenceItem("业务失败", evidence.business_failed)}
        ${evidenceItem("回查命中", evidence.readback_match_count, true)}
      </div>
    </section>`;
}

function evidenceItem(label, value, numeric = false) {
  const display = numeric ? (value ?? 0) : value === true ? "是" : value === false ? "否" : "未检查";
  return `<div class="evidence-item"><span>${label}</span><strong>${display}</strong></div>`;
}

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
