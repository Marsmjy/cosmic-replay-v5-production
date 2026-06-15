import { api } from "../api-client.js";
import { collectOverrides, renderFieldGroups } from "../components/field-editor.js";
import { renderReadiness } from "../components/readiness-gate.js";
import {
  defaultValidationDrafts,
  renderValidationPoints,
} from "../components/validation-points.js";

export function renderImportWorkspace(state) {
  if (!state.preview) {
    return `
      <section class="panel panel-body">
        <div class="dropzone" id="har-dropzone">
          <strong>拖入一条真实 HAR</strong>
          <p>先识别业务场景和用户可维护字段，不直接展示 YAML。</p>
          <button class="btn btn-primary" id="choose-har">选择 HAR 文件</button>
          <input class="hidden-input" id="har-file-input" type="file" accept=".har,application/json">
        </div>
      </section>`;
  }
  const preview = state.preview;
  const gate = preview.generation_gate || {};
  return `
    <div class="toolbar">
      <button class="btn" id="replace-har">更换 HAR</button>
      <button class="btn" id="resolve-fields" ${(preview.pick_fields || []).length ? "" : "disabled"}>解析目标环境字段</button>
      <input class="input" id="case-name" value="${escapeHtml(state.caseName)}" aria-label="用例名称">
      <button class="btn btn-primary" id="generate-case" ${gate.allow_generate === false ? "disabled" : ""}>生成用例</button>
    </div>
    <div class="model-strip">
      ${metric("场景", preview.scenario?.kind || "unknown")}
      ${metric("支持状态", preview.scenario?.classification || preview.capability?.status || "pending")}
      ${metric("业务字段", preview.field_catalog?.length || 0)}
      ${metric("IR 覆盖", `${preview.ir_generation_bridge?.coverage_score ?? 0}%`)}
    </div>
    ${renderFieldGroups(state)}
    ${renderValidationPoints(state)}
  `;
}

export function renderReadinessWorkspace(state) {
  return renderReadiness(state, true);
}

export function bindImportWorkspace(store) {
  const state = store.get();
  const input = document.querySelector("#har-file-input");
  const choose = document.querySelector("#choose-har");
  const dropzone = document.querySelector("#har-dropzone");
  choose?.addEventListener("click", () => input.click());
  input?.addEventListener("change", () => input.files[0] && importFile(input.files[0], store));
  dropzone?.addEventListener("dragover", (event) => {
    event.preventDefault(); dropzone.classList.add("is-dragging");
  });
  dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
  dropzone?.addEventListener("drop", (event) => {
    event.preventDefault(); dropzone.classList.remove("is-dragging");
    if (event.dataTransfer.files[0]) importFile(event.dataTransfer.files[0], store);
  });
  document.querySelector("#replace-har")?.addEventListener("click", () => {
    store.update({
      preview: null,
      file: null,
      harFile: "",
      fieldDrafts: {},
      validationDrafts: {},
      resolvedFields: {},
      stage: "import",
    });
  });
  document.querySelectorAll("[data-field-id]").forEach((element) => {
    element.addEventListener("input", (event) => {
      store.mutate((draft) => { draft.fieldDrafts[event.target.dataset.fieldId] = event.target.value; });
    });
  });
  document.querySelectorAll("[data-validation-id]").forEach((element) => {
    element.addEventListener("change", (event) => {
      store.mutate((draft) => {
        draft.validationDrafts[event.target.dataset.validationId].enabled = event.target.checked;
      });
    });
  });
  document.querySelector("#case-name")?.addEventListener("input", (event) => {
    state.caseName = event.target.value;
  });
  document.querySelector("#resolve-fields")?.addEventListener("click", () => resolveFields(store));
  document.querySelector("#generate-case")?.addEventListener("click", () => generateCase(store));
}

async function importFile(file, store) {
  store.update({ busy: true, error: "", notice: `正在解析 ${file.name}` });
  try {
    const data = await api.previewHar(file, store.get().envId);
    store.update({
      busy: false,
      file,
      preview: data.preview,
      harFile: data.har_file,
      caseName: file.name.replace(/\.har$/i, ""),
      validationDrafts: defaultValidationDrafts(data.preview.validation_points || []),
      notice: "HAR 已完成建模。请确认业务字段和 readiness。",
      stage: "values",
    });
  } catch (error) {
    store.update({ busy: false, error: error.message, notice: "" });
  }
}

async function resolveFields(store) {
  const state = store.get();
  store.update({ busy: true, error: "", notice: "正在目标环境按业务编码精确解析" });
  try {
    const data = await api.resolveFields({
      env_id: state.envId,
      har_file: state.harFile,
      fields: state.preview.pick_fields || [],
    });
    const resolvedFields = Object.fromEntries((data.fields || []).map((item) => [item.step_id, item]));
    store.update({ busy: false, resolvedFields, notice: "环境字段解析完成。", stage: "readiness" });
  } catch (error) {
    store.update({ busy: false, error: error.message, notice: "" });
  }
}

async function generateCase(store) {
  const state = store.get();
  const { variableOverrides, pickOverrides } = collectOverrides(state);
  store.update({ busy: true, error: "", notice: "正在从 ExecutionPlan 渲染 YAML" });
  try {
    const data = await api.extractHar({
      har_file: state.harFile,
      case_name: state.caseName || "untitled",
      env_id: state.envId,
      var_overrides: variableOverrides,
      pick_field_overrides: pickOverrides,
      validation_point_overrides: state.validationDrafts,
    });
    const cases = await api.cases();
    store.update({
      busy: false,
      notice: `已生成 ${data.name}`,
      cases,
      selectedCase: data.name,
      stage: "run",
    });
  } catch (error) {
    store.update({ busy: false, error: error.message, notice: "" });
  }
}

const metric = (label, value) => `<div class="metric"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
