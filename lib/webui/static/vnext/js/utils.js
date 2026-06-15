export const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

export const formatTime = (value) => {
  if (!value) return "未记录";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

export const formatDuration = (seconds) => {
  const value = Number(seconds || 0);
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  return `${value.toFixed(value < 10 ? 2 : 1)} s`;
};

export const statusTone = (status) => ({
  ready: "success", passed: "success", resolved: "success", write_verified: "success",
  running: "accent", sending: "accent", validating: "accent", resolving: "accent",
  pending: "muted", literal: "muted", skipped: "muted",
  needs_fields: "warning", warning: "warning", write_unverified: "warning",
  environment_unavailable: "danger", unsafe_chain: "danger", unsupported: "danger",
  failed: "danger", business_failed: "danger", ambiguous: "danger",
  not_found: "danger", error: "danger", cancelled: "warning",
})[status] || "muted";

export function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}
