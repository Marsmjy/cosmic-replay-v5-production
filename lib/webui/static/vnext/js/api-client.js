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
};
