import { api } from "./api-client.js";
import { createState } from "./state.js";
import { renderReadiness } from "./components/readiness-gate.js";
import { renderTechnicalDrawer } from "./components/technical-drawer.js";
import {
  bindImportWorkspace,
  renderImportWorkspace,
  renderReadinessWorkspace,
} from "./workspaces/import-workspace.js";
import {
  bindRunWorkspace,
  refreshCases,
  renderResultWorkspace,
  renderRunWorkspace,
} from "./workspaces/run-workspace.js";

const store = createState();
const stageMeta = {
  import: ["导入与建模", "从一条真实 HAR 建立可执行业务模型", "录制证据保持不变，业务规则和最终请求值可追踪。"],
  values: ["维护业务值", "只维护用户能理解的业务字段", "录制值、用户覆盖、环境解析和最终值来自同一 FieldCatalog。"],
  readiness: ["执行前检查", "先判断能不能安全执行", "环境不可用、链路不安全和暂不支持不会伪装成脚本成功。"],
  run: ["执行", "按业务阶段回放当前用例", "请求、契约和证据随执行事件更新，技术细节默认收起。"],
  result: ["业务结果", "一个结论，一个主要操作", "请求成功不等于业务写入成功，结果按证据层级解释。"],
};

store.subscribe(render);
bootstrap();

async function bootstrap() {
  render(store.get());
  try {
    const [health, envs, cases, foldersResp, foldersMeta] = await Promise.all([
      api.health(), api.envs(), api.cases(), api.folders(), api.foldersMeta(),
    ]);
    store.update({
      health,
      envs,
      envId: envs.find((item) => item.is_default)?.id || envs[0]?.id || "",
      cases,
      folders: foldersResp.folders || [],
      rootLabel: foldersMeta.root_label || "根节点",
    });
  } catch (error) {
    store.update({ error: error.message });
  }
}

function render(state) {
  const meta = stageMeta[state.stage] || stageMeta.import;
  document.querySelector("#workspace-eyebrow").textContent = meta[0];
  document.querySelector("#workspace-title").textContent = meta[1];
  document.querySelector("#workspace-subtitle").textContent = meta[2];
  document.querySelector("#notice-region").innerHTML = state.error
    ? `<div class="notice is-error">${escapeHtml(state.error)}</div>`
    : state.notice ? `<div class="notice">${escapeHtml(state.notice)}</div>` : "";

  const envSelect = document.querySelector("#environment-select");
  envSelect.innerHTML = (state.envs || []).map((env) =>
    `<option value="${escapeHtml(env.id)}" ${env.id === state.envId ? "selected" : ""}>${escapeHtml(env.name || env.id)}</option>`
  ).join("");
  envSelect.onchange = (event) => store.update({ envId: event.target.value });

  const health = document.querySelector("#api-health");
  health.textContent = state.health?.status === "healthy" ? "服务正常" : "服务待确认";
  health.classList.toggle("is-ok", state.health?.status === "healthy");

  document.querySelectorAll(".workflow-step").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.stage === state.stage);
    button.onclick = () => store.update({ stage: button.dataset.stage });
  });

  const content = document.querySelector("#workspace-content");
  content.innerHTML = state.stage === "readiness"
    ? renderReadinessWorkspace(state)
    : state.stage === "run"
      ? renderRunWorkspace(state)
      : state.stage === "result"
        ? renderResultWorkspace(state)
        : renderImportWorkspace(state);

  document.querySelector("#inspector").innerHTML = renderReadiness(state);
  document.querySelector("#technical-drawer").innerHTML = renderTechnicalDrawer(state);
  document.querySelector("#technical-drawer").classList.toggle("is-open", state.technicalOpen);
  document.querySelector("#technical-toggle").onclick = () => store.update({ technicalOpen: !state.technicalOpen });
  document.querySelectorAll("[data-primary-action]").forEach((button) => {
    button.onclick = () => primaryAction(button.dataset.primaryAction);
  });
  document.querySelectorAll("[data-result-action]").forEach((button) => {
    button.onclick = () => resultAction(button.dataset.resultAction);
  });
  bindImportWorkspace(store);
  bindRunWorkspace(store);
}

async function resultAction(code) {
  const state = store.get();
  if (code === "confirm_write" && state.selectedCase) {
    try {
      await api.confirmWrite(state.selectedCase);
      store.mutate((draft) => {
        const evidence = draft.result?.result_evidence;
        if (evidence) {
          evidence.outcome = "write_verified";
          evidence.write_verified = true;
          evidence.write_unverified = false;
        }
        draft.notice = "已记录人工业务确认。";
      });
    } catch (error) {
      store.update({ error: error.message });
    }
    return;
  }
  if (code === "check_environment") {
    store.update({ stage: state.preview ? "readiness" : "values" });
    return;
  }
  store.update({ technicalOpen: true });
}

function primaryAction(code) {
  if (code === "needs_import") {
    document.querySelector("#choose-har")?.click();
  } else if (code === "ready") {
    if (store.get().selectedCase) store.update({ stage: "run" });
    else document.querySelector("#generate-case")?.click();
  } else if (code === "needs_fields") {
    store.update({ stage: "values" });
  } else if (code === "environment_unavailable") {
    document.querySelector("#resolve-fields")?.click();
  } else {
    store.update({ technicalOpen: true });
  }
}

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
