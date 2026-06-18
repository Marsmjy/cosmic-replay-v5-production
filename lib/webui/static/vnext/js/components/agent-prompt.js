import { api } from "../api-client.js";

// ⭐ P2: AI 修复指令生成（移植 legacy 协议模板，含项目核心目标 0~12 步）
const PROTOCOL = [
  "请按项目内 skills/cosmic-replay-troubleshooter/SKILL.md 的协议执行：",
  "0. 永远围绕项目核心目标：HAR 解析出可维护字段、用户维护值必须生效、F7/下拉/基础资料按目标环境接口解析、跨环境动态适配、执行必须校验保存/提交和入库证据、经验沉淀为通用规则和知识库、批量 HAR 要比较优化前后并输出报告。",
  "1. 先读取证据包、YAML、运行事件、run_artifacts.ir_summary、run_artifacts.dynamic_value_flow、pageid_trace 和失败/入库证据；若 failure_analysis.diagnosis_priority 存在，按该优先级排查。",
  "2. 优先查看 run_artifacts.ir_summary 与 run_artifacts.dynamic_value_flow：确认 case_shape、写入步骤、steps.role、variables.value_shape、environment_fields.value_shape、assertions、response_anchor_candidates、warnings，以及 pageId/billno/确认回调/上传 URL/待办任务行是否仍在消费 HAR 录制旧值。",
  "3. 不论失败分类是什么，先比对 HAR 原始 pageId 链路与回放 pageId 是否一致：menuItemClick/loadData/treeNodeClick/addnew 等列表/树/工具栏步骤应保留 L2，真实编辑/保存/提交步骤才切到 L3。",
  "4. 如本地有原始 HAR，可先运行 scripts/har_ir_tool.py build --har <har> 和 scripts/har_ir_tool.py dry-run --flow <normalized_flow.json> 生成脱敏 IR；原始 HAR 不得提交 Git。",
  "5. 若出现 createorg/ctrlstrategy/默认组织/控制策略等默认上下文缺失，先从 HAR 的 loadData、showForm 元数据、列表 dataindex/rows 提取环境字段和内部 id；不要硬补 save.post_data。",
  "6. 若存在子弹窗/明细补录链路，必须检查 newentry → F7/entryRowClick 选择 → 明细弹窗字段维护 → 确定 → 主保存是否完整；不能只看最终 PASS，需确认保存响应或前置确认响应包含明细字段回填。",
  "7. 先查看证据包 experience_matches；若命中已闭环样本，优先复用相似样本的 pageId、lookup、F7、子弹窗和入库回查经验。",
  "8. 若执行 PASS 但入库未验证，先读取证据包里的 write_verification.readback_plan，或运行 scripts/deep_chain_pipeline.py readback-plan --case <yaml>，按业务键做只读回查；不要直接把 PASS 当作成功。",
  "9. 在 pageId 链路确认后，再判断是 HAR 解析变量遗漏、环境字段覆盖、异步流程未等待、断言盲区，还是执行器问题；不要一上来硬补 save 字段。",
  "10. 只做最小补丁，不要删除 menuItemClick、target_forms、pick_fields、no_save_failure 断言来绕过问题。",
  "11. 修复后运行相关单测和 HAR 回归：pytest + scripts/har_regression_report.py compare --fail-on-diff。",
  "12. 输出根因、修改文件、测试结果、回滚方案；如果需要人工确认环境字段，请明确列出来。",
];

const USER_SUPPLEMENT = [
  "用户补充信息（发送给 AI 前可填写；没有可留空）：",
  "- 我在业务环境看到的现象：",
  "- 我刚维护过的变量/环境字段：",
  "- 我希望 AI 优先确认的问题：",
];

// 报告内某条用例的修复指令（基于批量任务 task_id）
export function buildReportPrompt(report, caseResult) {
  const caseName = caseResult?.name || "";
  const taskId = report?.task_id || "";
  const evidenceUrl = `${location.origin}${api.agentEvidenceUrlForTask(taskId, caseName)}`;
  const reason = caseResult?.ai_reason || caseResult?.error || caseResult?.error_category
    || "执行 PASS 但缺少明确入库证据，可能存在 pageId 链路或断言盲区问题。";
  return [
    "请作为 cosmic-replay AI 修复 Agent 介入处理下面这个用例。",
    "",
    `用例：${caseName}`,
    `任务：${taskId}`,
    `环境：${report?.env || ""}`,
    `问题：${reason}`,
    `技术证据包：${evidenceUrl}`,
    "",
    ...PROTOCOL,
    "",
    ...USER_SUPPLEMENT,
  ].join("\n");
}

// 单次运行（详情页）修复指令，基于 run_id
export function buildSingleRunPrompt(state, caseName) {
  const name = caseName || state.currentCase || "";
  const runId = state.runId || "";
  const diag = state.singleRunDiagnosis || {};
  const summary = state.summary || {};
  const failed = (state.phases || []).find((p) => p.status === "fail");
  const reason = diag.ai_reason || state.failureAnalysis?.root_cause
    || (failed?.errors || []).join("; ") || failed?.error || summary.error
    || "单次执行失败，需结合运行事件、YAML 和失败响应定位根因。";
  const evidenceUrl = `${location.origin}${api.agentEvidenceUrlForRun(runId, name)}`;
  const intro = summary.passed
    ? "请作为 cosmic-replay AI 修复 Agent 介入处理下面这个单次执行入库证据未验证用例。"
    : "请作为 cosmic-replay AI 修复 Agent 介入处理下面这个单次执行失败用例。";
  return [
    intro,
    "",
    `用例：${name}`,
    `run_id：${runId}`,
    `环境：${state.envId || ""}`,
    `失败位置：${failed?.label || (summary.passed ? "入库证据验证" : "未知")}`,
    `入库状态：${diag.write_status || "not_checked"}`,
    `问题：${reason}`,
    `技术证据包：${evidenceUrl}`,
    "",
    ...PROTOCOL,
    "",
    ...USER_SUPPLEMENT,
  ].join("\n");
}

// 复制到剪贴板，失败兜底提示
export async function copyPrompt(text, store) {
  try {
    await navigator.clipboard.writeText(text);
    store.update({ notice: "已复制 AI 修复指令，发给 Codex/AI Agent 即可" });
  } catch (e) {
    store.update({ error: "复制失败，请打开证据包后手动复制" });
  }
}
