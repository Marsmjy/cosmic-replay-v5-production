async function request(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const detail = body?.detail || body;
    const message = detail?.message || detail?.error || detail;
    const error = new Error(typeof message === "string" ? message : JSON.stringify(message));
    error.code = detail?.error_code || `http_${response.status}`;
    error.evidence = detail?.evidence || [];
    error.suggestedAction = detail?.suggested_action || "";
    throw error;
  }
  return body;
}

const jsonRequest = (url, method, payload) => request(url, {
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const caseUrl = (name, suffix) =>
  `/api/vnext/cases/${encodeURIComponent(name)}/${suffix}`;

export const api = {
  health: () => request("/api/health"),
  envs: () => request("/api/envs"),
  cases: () => request("/api/cases"),
  caseDetail: (name, envId) =>
    request(`${caseUrl(name, "detail")}?env_id=${encodeURIComponent(envId || "")}`),
  saveVariables: (name, payload) =>
    jsonRequest(caseUrl(name, "variables"), "PUT", payload),
  readiness: (name, envId) =>
    request(`${caseUrl(name, "readiness")}?env_id=${encodeURIComponent(envId || "")}`),
  resolveFields: (payload) =>
    jsonRequest("/api/env-fields/resolve", "POST", payload),
  applyResolution: (name, payload) =>
    jsonRequest(caseUrl(name, "resolver/apply"), "POST", payload),
  runCase: (name, envId) =>
    jsonRequest(`/api/cases/${encodeURIComponent(name)}/run`, "POST", { env_id: envId }),
  runSnapshot: (runId) => request(`/api/vnext/runs/${encodeURIComponent(runId)}`),
  runs: (limit = 50) => request(`/api/vnext/runs?limit=${limit}`),
  cancelRun: (runId) =>
    jsonRequest(`/api/vnext/runs/${encodeURIComponent(runId)}/cancel`, "POST", {}),
  diagnosis: (runId) =>
    request(`/api/vnext/runs/${encodeURIComponent(runId)}/diagnosis`),
  previewRepair: (name, repair) =>
    jsonRequest(caseUrl(name, "repairs/preview"), "POST", { repair }),
  applyRepair: (name, repair) =>
    jsonRequest(caseUrl(name, "repairs/apply"), "POST", { repair, confirmed: true }),
  diagnosticBundleUrl: (runId) =>
    `/api/vnext/runs/${encodeURIComponent(runId)}/diagnostic-bundle`,
  previewHar(file, envId) {
    const params = new URLSearchParams({ filename: file.name });
    if (envId) params.set("env_id", envId);
    return request(`/api/har/preview?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
  },
  extractHar: (payload) => jsonRequest("/api/har/extract", "POST", payload),
};
