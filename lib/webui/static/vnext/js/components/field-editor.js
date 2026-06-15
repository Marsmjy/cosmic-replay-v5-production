const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function recordedValue(field, preview) {
  const vars = new Map((preview.detected_vars || []).map((item) => [item.name, item]));
  const picks = new Map((preview.pick_fields || []).map((item) => [item.id, item]));
  const variable = (field.vars || []).map((name) => vars.get(name)).find(Boolean);
  const pick = (field.pick_fields || []).map((name) => picks.get(name)).find(Boolean);
  return variable?.value ?? variable?.recorded_value ?? pick?.value_code
    ?? pick?.value_name ?? pick?.recorded_value_name ?? pick?.value_id ?? "";
}

function resolution(field, preview, resolvedFields) {
  const pickId = (field.pick_fields || [])[0];
  const pick = (preview.pick_fields || []).find((item) => item.id === pickId) || {};
  const resolved = resolvedFields[pickId] || {};
  const status = resolved.resolve_status || pick.resolve_status || (pickId ? "pending" : "literal");
  const label = {
    resolved: "已唯一解析", pending: "待运行时解析", manual: "用户维护",
    ambiguous: "命中多条", not_found: "未找到", error: "环境不可用", literal: "无需解析",
  }[status] || status;
  return { status, label, value: resolved.resolved_value_name || resolved.value_code || "" };
}

export function groupFields(preview) {
  const groups = new Map();
  (preview.field_catalog || []).forEach((field) => {
    const structural = field.panel === "technical" || field.category === "button";
    if (structural) return;
    const key = field.group_label || field.form_label || field.form_id || "业务字段";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(field);
  });
  return [...groups.entries()].map(([label, fields]) => ({
    label,
    fields: fields.sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
  }));
}

export function renderFieldGroups(state) {
  const preview = state.preview || {};
  const groups = groupFields(preview);
  if (!groups.length) return '<div class="empty-state">当前场景没有识别到需要用户维护的业务字段。</div>';
  return groups.map((group) => `
    <section class="field-group">
      <div class="field-group-title">
        <strong>${escapeHtml(group.label)}</strong>
        <span class="cell-muted">${group.fields.length} 个字段，按 HAR 首次出现顺序</span>
      </div>
      <div class="table-wrap">
        <table class="field-table">
          <thead><tr>
            <th>业务字段</th><th>录制值</th><th>用户值</th><th>目标环境解析</th><th>最终值</th>
          </tr></thead>
          <tbody>
            ${group.fields.map((field) => renderFieldRow(field, state)).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `).join("");
}

function renderFieldRow(field, state) {
  const recorded = recordedValue(field, state.preview || {});
  const draft = state.fieldDrafts[field.field_id] ?? "";
  const env = resolution(field, state.preview || {}, state.resolvedFields);
  const finalValue = draft || env.value || recorded || "运行时产生";
  const badgeClass = ["ambiguous", "not_found", "error"].includes(env.status)
    ? "is-danger" : env.status === "resolved" ? "is-success" : "is-warning";
  return `
    <tr>
      <td class="field-name">
        <strong>${escapeHtml(field.label || field.field_key || field.field_id)}</strong>
        <small>${escapeHtml(field.category || "business")} · ${escapeHtml(field.form_id || "")}</small>
      </td>
      <td>${escapeHtml(recorded || "空")}</td>
      <td>
        <input class="input field-input" data-field-id="${escapeHtml(field.field_id)}"
          value="${escapeHtml(draft)}" placeholder="沿用录制值">
      </td>
      <td><span class="badge ${badgeClass}">${escapeHtml(env.label)}</span></td>
      <td><strong>${escapeHtml(finalValue)}</strong></td>
    </tr>
  `;
}

export function collectOverrides(state) {
  const preview = state.preview || {};
  const variableOverrides = {};
  const pickOverrides = {};
  for (const field of preview.field_catalog || []) {
    const value = state.fieldDrafts[field.field_id];
    if (value === undefined || value === "") continue;
    for (const name of field.vars || []) {
      variableOverrides[name] = { value, user_overridden: true };
    }
    for (const id of field.pick_fields || []) {
      const original = (preview.pick_fields || []).find((item) => item.id === id) || {};
      pickOverrides[id] = {
        ...original,
        value_code: value,
        value_name: value,
        resolve_by: "value_code",
        auto_resolve: true,
        user_overridden: true,
      };
    }
  }
  return { variableOverrides, pickOverrides };
}

