import { safeJson } from "../utils.js?v=20260615-2";

export function runOutcomeModel(run) {
  const evidence = run?.result_evidence || {};
  const outcome = evidence.outcome || "";
  if (run?.state === "running") {
    return { tone: "accent", title: "执行中", subtitle: run.current_phase || "runner 正在执行", action: "停止执行" };
  }
  if (run?.state === "cancelled") {
    return { tone: "warning", title: "执行已停止", subtitle: run.failure_summary || "用户请求停止执行。", action: "重新执行" };
  }
  if (run?.state === "passed") {
    if (outcome === "write_verified") {
      return { tone: "success", title: "执行通过，写入已验证", subtitle: "可在目标环境按下方最终业务值核对。", action: "重新执行" };
    }
    if (outcome === "query") {
      return { tone: "success", title: "查询执行通过", subtitle: "关键响应契约已通过。", action: "重新执行" };
    }
    return { tone: "success", title: "执行通过", subtitle: run.failure_summary || "请求、动作和契约没有发现阻断失败。", action: "重新执行" };
  }
  return {
    tone: "danger",
    title: "执行失败",
    subtitle: failureReason(run),
    action: evidence.request_success === false ? "检查环境" : "交给 AI 排查",
  };
}

export function failureReason(run) {
  if (!run) return "暂无运行信息。";
  if (run.failure_summary) return run.failure_summary;
  const failed = (run.steps || []).find((step) => step.state === "failed");
  return failed?.failure_summary || run.result?.error || "运行失败，请查看失败步骤和日志证据。";
}

export function valuePreview(run, limit = 3) {
  const fields = run?.runtime_values?.fields || [];
  const variables = run?.runtime_values?.variables || [];
  const source = fields.length
    ? fields.map((item) => [item.label || item.field_id, item.final_request_value])
    : variables.map((item) => [item.label || item.key, item.resolved_value]);
  return source
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .slice(0, limit)
    .map(([label, value]) => ({ label, value: String(value) }));
}

export function buildAiTroubleshootingPrompt(run) {
  const failedStep = (run?.steps || []).find((step) => step.state === "failed") || {};
  const errorLogs = (run?.logs || [])
    .filter((log) => log.severity === "error")
    .slice(-5);
  const runtimeValues = run?.runtime_values || {};
  return [
    "请基于以下 cosmic-replay V5 脱敏运行证据排查失败原因，并给出下一步修复建议。",
    "",
    "## 运行结论",
    `- run_id: ${run?.run_id || ""}`,
    `- case: ${run?.display_name || run?.case_name || ""}`,
    `- env_id: ${run?.env_id || ""}`,
    `- state: ${run?.state || ""}`,
    `- failure_reason: ${failureReason(run)}`,
    `- primary_action: ${run?.primary_action || ""}`,
    "",
    "## 失败步骤",
    safeJson({
      id: failedStep.id,
      business_action: failedStep.business_action,
      business_stage: failedStep.business_stage,
      failure_summary: failedStep.failure_summary,
      request_success: failedStep.request_success,
      action_success: failedStep.action_success,
      contract_passed: failedStep.contract_passed,
      write_verified: failedStep.write_verified,
    }),
    "",
    "## 运行时变量值",
    safeJson(runtimeValues.variables || []),
    "",
    "## 业务字段最终值",
    safeJson(runtimeValues.fields || []),
    "",
    "## 结果证据",
    safeJson(run?.result_evidence || {}),
    "",
    "## 最近错误日志",
    safeJson(errorLogs),
    "",
    "请判断是环境/数据前置问题、脚本契约漂移、resolver 失败、pageId 链路问题、响应契约问题，还是业务规则失败。不要假设 Cookie、Token 或静态 pageId 可复用。",
  ].join("\n");
}
