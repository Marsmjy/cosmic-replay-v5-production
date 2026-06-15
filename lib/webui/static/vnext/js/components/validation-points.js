const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function pointKind(point, enabled) {
  if (point.required) return ["必需", "is-danger"];
  if (point.category === "system") return ["技术契约", "is-accent"];
  if (enabled) return ["用户启用", "is-success"];
  return ["建议", "is-warning"];
}

export function defaultValidationDrafts(points = []) {
  return Object.fromEntries(points.map((point) => [
    point.id,
    {
      enabled: point.required ? true : Boolean(point.enabled),
      kind: point.kind || "",
      target_id: point.target_id || "",
      category: point.category || "",
      scope: point.scope || "",
      assertion_type: point.assertion?.type || "",
      step_id: point.step_id || point.assertion?.step || "",
    },
  ]));
}

export function renderValidationPoints(state) {
  const points = state.preview?.validation_points || [];
  if (!points.length) return "";
  return `
    <section class="validation-section">
      <div class="field-group-title">
        <strong>业务校验点</strong>
        <span class="cell-muted">状态会写入版本化 YAML，不在生成后丢失</span>
      </div>
      <div class="validation-list">
        ${points.map((point) => {
          const enabled = point.required
            ? true
            : Boolean(state.validationDrafts[point.id]?.enabled);
          const [kind, tone] = pointKind(point, enabled);
          return `
            <label class="validation-row">
              <input type="checkbox" data-validation-id="${escapeHtml(point.id)}"
                ${enabled ? "checked" : ""} ${point.required ? "disabled" : ""}>
              <span>
                <strong>${escapeHtml(point.label || point.id)}</strong>
                <small>${escapeHtml(point.help || point.scope || "运行时验证")}</small>
              </span>
              <span class="badge ${tone}">${kind}</span>
            </label>`;
        }).join("")}
      </div>
    </section>`;
}

