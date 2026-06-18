async function request(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const detail = body?.detail || body?.error || body;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return body;
}

export const api = {
  health: () => request("/api/health"),
  envs: () => request("/api/envs"),
  cases: () => request("/api/cases"),
  previewHar(file, envId) {
    const params = new URLSearchParams({ filename: file.name });
    if (envId) params.set("env_id", envId);
    return request(`/api/har/preview?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
  },
  resolveFields(payload) {
    return request("/api/env-fields/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  extractHar(payload) {
    return request("/api/har/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  runCase(name, envId) {
    return request(`/api/cases/${encodeURIComponent(name)}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env_id: envId }),
    });
  },
  confirmWrite(name) {
    return request(`/api/cases/${encodeURIComponent(name)}/write-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "vNext 工作台人工确认业务结果" }),
    });
  },
  // ⭐ 文件夹（左树右表）
  folders: () => request("/api/folders"),
  foldersMeta: () => request("/api/folders/meta"),
  updateFoldersMeta(rootLabel) {
    return request("/api/folders/meta", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root_label: rootLabel }),
    });
  },
  createFolder(path) {
    return request("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  },
  renameFolder(path, newPath) {
    return request("/api/folders/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, new_path: newPath }),
    });
  },
  deleteFolder(path, force = false) {
    const params = new URLSearchParams({ path });
    if (force) params.set("force", "true");
    return request(`/api/folders?${params}`, { method: "DELETE" });
  },
  batchMoveCases(names, targetFolder) {
    return request("/api/cases/batch_move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names, target_folder: targetFolder || "" }),
    });
  },
  batchDeleteCases(names) {
    return request("/api/cases/batch_delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    });
  },
  // ⭐ 用例详情：YAML 源
  getCaseYaml(name) {
    return request(`/api/cases/${encodeURIComponent(name)}/yaml`);
  },
  saveCaseYaml(name, yaml) {
    return request(`/api/cases/${encodeURIComponent(name)}/yaml`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml }),
    });
  },
  // ⭐ 修复：计划 + 应用
  repairPlan(name, payload) {
    return request(`/api/cases/${encodeURIComponent(name)}/repairs/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  },
  applyRepair(name, payload) {
    return request(`/api/cases/${encodeURIComponent(name)}/repairs/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  },
  // ⭐ 单次运行诊断
  runDiagnosis(runId, caseName) {
    return request(
      `/api/runs/${encodeURIComponent(runId)}/diagnosis/${encodeURIComponent(caseName)}`
    );
  },
  // ⭐ 字段 / 校验点落库
  pickFieldUpdate(payload) {
    return request("/api/pick-field-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  },
  validationPointUpdate(payload) {
    return request("/api/validation-point-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  },
  // ⭐ 用例管理：复制 / 重命名 / 描述
  copyCase(name, newName) {
    return request(`/api/cases/${encodeURIComponent(name)}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName || "" }),
    });
  },
  renameCase(name, newName) {
    return request(`/api/cases/${encodeURIComponent(name)}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName || "" }),
    });
  },
  updateCaseDescription(name, description) {
    return request(`/api/cases/${encodeURIComponent(name)}/description`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: description || "" }),
    });
  },
  // ⭐ 批量任务系统
  createTask(payload) {
    return request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  },
  startTask(taskId) {
    return request(`/api/tasks/${encodeURIComponent(taskId)}/start`, {
      method: "POST",
    });
  },
  getTask(taskId) {
    return request(`/api/tasks/${encodeURIComponent(taskId)}`);
  },
  getTaskReport(taskId) {
    return request(`/api/tasks/${encodeURIComponent(taskId)}/report`);
  },
  exportReportUrl(taskId) {
    return `/api/tasks/${encodeURIComponent(taskId)}/report/export?format=html`;
  },
  reportsTrend(days = 14) {
    return request(`/api/reports/trend?days=${encodeURIComponent(days)}`);
  },
  // ⭐ 配置 / 环境管理
  config(mask = true) {
    return request(`/api/config?mask=${mask ? "true" : "false"}`);
  },
  saveEnv(id, payload) {
    return request(`/api/envs/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  },
  deleteEnv(id) {
    return request(`/api/envs/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  // ⭐ 用例稳定性
  caseStability(name) {
    return request(`/api/cases/${encodeURIComponent(name)}/stability`);
  },
  // ⭐ 日志 / 执行历史
  runHistory(limit = 100) {
    return request(`/api/run_history?limit=${encodeURIComponent(limit)}`);
  },
  runHistoryDetail(runId) {
    return request(`/api/run_history/${encodeURIComponent(runId)}`);
  },
  clearRunLogs() {
    return request("/api/run-logs", { method: "DELETE" });
  },
  // ⭐ AI 证据包 URL（返回字符串）
  agentEvidenceUrlForRun(runId, name) {
    return `/api/runs/${encodeURIComponent(runId)}/agent-evidence/${encodeURIComponent(name)}`;
  },
  agentEvidenceUrlForTask(taskId, name) {
    return `/api/tasks/${encodeURIComponent(taskId)}/agent-evidence/${encodeURIComponent(name)}`;
  },
};
