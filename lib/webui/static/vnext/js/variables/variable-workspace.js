import { escapeHtml, statusTone } from "../utils.js?v=20260615-2";

const RESOLVER_TYPES = new Set(["basedata", "f7", "select", "dropdown", "multi_select"]);

export function renderVariables(state) {
  const fields = filteredFields(state);
  const filters = state.fieldFilters;
  const all = state.caseDetail?.field_catalog || [];
  const stages = [...new Set(all.map((item) => item.group_label || item.form_label || item.form_id).filter(Boolean))];
  const types = [...new Set(all.map((item) => item.field_type || item.category).filter(Boolean))];
  return `
    <div class="section-toolbar variable-toolbar">
      <div class="filter-row">
        <input class="input" id="field-search" value="${escapeHtml(filters.search)}" placeholder="搜索业务字段">
        ${select("field-stage-filter", "阶段/表单", filters.stage, stages)}
        ${select("field-type-filter", "字段类型", filters.type, types)}
        ${select("field-status-filter", "解析状态", filters.status, ["resolved", "pending", "ambiguous", "not_found", "error", "literal"])}
      </div>
      <div class="toolbar-actions">
        <button class="btn" data-action="restore-selected">恢复录制值</button>
        <button class="btn" data-action="clear-selected">清除覆盖值</button>
        <button class="btn btn-primary" data-action="save-variables">保存并重新检查</button>
      </div>
    </div>
    <div class="field-table-wrap">
      <table class="field-table variable-table">
        <thead><tr>
          <th class="check-cell"><input type="checkbox" id="select-all-fields"></th>
          <th>业务字段</th><th>阶段 / 表单</th><th>类型 / 必填</th>
          <th>录制值</th><th>用户覆盖</th><th>目标环境解析</th>
          <th>最终生效值</th><th>来源 / 风险</th>
        </tr></thead>
        <tbody>
          ${fields.map((field) => renderField(field, state)).join("")
            || '<tr><td colspan="9" class="empty-state compact">没有匹配字段</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="value-lineage-help">
      recorded_value → user_override → environment_resolved_value → final_request_value
    </div>`;
}

function renderField(field, state) {
  const fieldId = field.field_id;
  const draft = state.fieldDrafts[fieldId] ?? field.user_override ?? "";
  const status = state.resolverResults[fieldId]?.resolve_status || field.resolver_status || "literal";
  const resolved = state.resolverResults[fieldId]?.resolved_value_name
    || state.resolverResults[fieldId]?.resolved_value_code
    || field.environment_resolved_value || "";
  const finalValue = draft || resolved || field.final_request_value || field.recorded_value || "";
  const canResolve = field.resolver_contract && (
    RESOLVER_TYPES.has(String(field.field_type || field.category || "").toLowerCase())
    || field.resolver_contract.auto_resolve
  );
  const candidates = state.resolverResults[fieldId]?.candidates || [];
  return `
    <tr data-field-row="${escapeHtml(fieldId)}">
      <td class="check-cell"><input type="checkbox" data-select-field="${escapeHtml(fieldId)}"
        ${state.selectedFields.has(fieldId) ? "checked" : ""}></td>
      <td data-label="业务字段"><strong>${escapeHtml(field.label || field.field_key || fieldId)}</strong>
        <small>${escapeHtml(field.field_key || "")}</small></td>
      <td data-label="阶段 / 表单">${escapeHtml(field.group_label || field.form_label || "业务阶段")}
        <small>${escapeHtml(field.form_id || "")}</small></td>
      <td data-label="类型 / 必填">${escapeHtml(field.field_type || field.category || "text")}
        <small>${field.required ? "必填" : "可选"}</small></td>
      <td data-label="录制值" class="value-cell">${escapeHtml(field.recorded_value || "空")}</td>
      <td data-label="用户覆盖">${renderEditor(field, draft)}</td>
      <td data-label="目标环境解析">
        <div class="resolver-cell">
          <span class="status-label is-${statusTone(status)}">${resolverLabel(status)}</span>
          ${resolved ? `<small>${escapeHtml(resolved)}</small>` : ""}
          ${canResolve ? `<button class="text-btn" data-resolve-field="${escapeHtml(fieldId)}">精确查询</button>` : ""}
          ${candidates.length ? candidateSelect(fieldId, candidates) : ""}
        </div>
      </td>
      <td data-label="最终生效值" class="value-cell final-value">${escapeHtml(finalValue || "运行时产生")}</td>
      <td data-label="来源 / 风险"><span>${escapeHtml(field.source_step_id || `request ${field.source_request_index ?? "-"}`)}</span>
        <small class="risk-${escapeHtml(field.risk)}">${escapeHtml(field.risk || "low")} risk</small></td>
    </tr>`;
}

function renderEditor(field, value) {
  const type = String(field.field_type || field.category || "text").toLowerCase();
  const common = `data-field-input="${escapeHtml(field.field_id)}"`;
  if (type === "boolean") {
    return `<select class="input field-editor" ${common}>
      <option value="" ${value === "" ? "selected" : ""}>沿用录制值</option>
      <option value="true" ${String(value) === "true" ? "selected" : ""}>是</option>
      <option value="false" ${String(value) === "false" ? "selected" : ""}>否</option>
    </select>`;
  }
  if (["textarea", "long_text", "multilang", "multi_lang_text"].includes(type)) {
    return `<textarea class="input field-editor" ${common} placeholder="沿用录制值">${escapeHtml(value)}</textarea>`;
  }
  const inputType = type === "date" ? "date" : type === "datetime" ? "datetime-local" : "text";
  return `<input class="input field-editor" type="${inputType}" ${common}
    value="${escapeHtml(value)}" placeholder="沿用录制值">`;
}

function candidateSelect(fieldId, candidates) {
  return `<select class="input candidate-select" data-candidate-field="${escapeHtml(fieldId)}">
    <option value="">选择唯一结果</option>
    ${candidates.map((item, index) => `
      <option value="${index}">${escapeHtml(item.number || item.code || item.name || item.id || `候选 ${index + 1}`)}</option>
    `).join("")}
  </select>`;
}

export function bindVariables(store, actions) {
  const bindFilter = (id, key) => document.querySelector(id)?.addEventListener("input", (event) => {
    store.mutate((state) => { state.fieldFilters[key] = event.target.value; });
  });
  bindFilter("#field-search", "search");
  bindFilter("#field-stage-filter", "stage");
  bindFilter("#field-type-filter", "type");
  bindFilter("#field-status-filter", "status");
  document.querySelectorAll("[data-field-input]").forEach((input) => {
    input.addEventListener("input", (event) => {
      store.silent((state) => { state.fieldDrafts[event.target.dataset.fieldInput] = event.target.value; });
      const row = event.target.closest("tr");
      const final = row?.querySelector(".final-value");
      if (final) final.textContent = event.target.value || "沿用录制值";
    });
  });
  document.querySelectorAll("[data-select-field]").forEach((input) => {
    input.addEventListener("change", (event) => {
      store.silent((state) => {
        const id = event.target.dataset.selectField;
        if (event.target.checked) state.selectedFields.add(id);
        else state.selectedFields.delete(id);
      });
    });
  });
  document.querySelector("#select-all-fields")?.addEventListener("change", (event) => {
    store.mutate((state) => {
      state.selectedFields = event.target.checked
        ? new Set(filteredFields(state).map((item) => item.field_id))
        : new Set();
    });
  });
  document.querySelectorAll("[data-resolve-field]").forEach((button) => {
    button.addEventListener("click", () => actions.resolveField(button.dataset.resolveField));
  });
  document.querySelectorAll("[data-candidate-field]").forEach((selectElement) => {
    selectElement.addEventListener("change", () => {
      if (selectElement.value !== "") {
        actions.applyCandidate(selectElement.dataset.candidateField, Number(selectElement.value));
      }
    });
  });
}

function filteredFields(state) {
  const filters = state.fieldFilters;
  return (state.caseDetail?.field_catalog || []).filter((field) => {
    const blob = `${field.label || ""} ${field.field_key || ""}`.toLowerCase();
    const stage = field.group_label || field.form_label || field.form_id || "";
    const type = field.field_type || field.category || "";
    const status = state.resolverResults[field.field_id]?.resolve_status || field.resolver_status || "";
    return (!filters.search || blob.includes(filters.search.toLowerCase()))
      && (!filters.stage || stage === filters.stage)
      && (!filters.type || type === filters.type)
      && (!filters.status || status === filters.status);
  });
}

const select = (id, label, selected, values) => `
  <select class="input" id="${id}">
    <option value="">${label}：全部</option>
    ${values.map((value) => `<option value="${escapeHtml(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
  </select>`;

const resolverLabel = (status) => ({
  resolved: "已唯一解析", pending: "待解析", ambiguous: "命中多条",
  not_found: "零条结果", error: "环境错误", literal: "无需解析", manual: "人工维护",
})[status] || status;
