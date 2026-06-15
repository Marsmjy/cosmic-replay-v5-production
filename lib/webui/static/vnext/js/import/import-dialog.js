import { escapeHtml } from "../utils.js?v=20260615-2";

export function renderImportDialog(state) {
  if (!state.importMode) return "";
  const preview = state.importPreview?.preview;
  return `
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-label="导入 HAR">
        <header><div><h2>导入与建模</h2><p>录制证据保持不变，生成后进入业务变量工作区。</p></div>
          <button class="icon-btn" data-action="close-import">×</button></header>
        <div class="modal-body">
          ${preview ? `
            <dl class="definition-list import-summary">
              <div><dt>场景</dt><dd>${escapeHtml(preview.scenario?.kind || "未识别")}</dd></div>
              <div><dt>字段</dt><dd>${preview.field_catalog?.length || 0}</dd></div>
              <div><dt>支持状态</dt><dd>${escapeHtml(preview.scenario?.classification || preview.capability?.status || "待确认")}</dd></div>
              <div><dt>生成门槛</dt><dd>${preview.generation_gate?.allow_generate === false ? "阻断" : "通过"}</dd></div>
            </dl>
            <label class="form-field"><span>用例名称</span><input class="input" id="import-case-name"
              value="${escapeHtml(state.importFile?.name?.replace(/\\.har$/i, "") || "")}"></label>
          ` : `
            <label class="import-drop">
              <strong>选择一条真实 HAR</strong>
              <span>先解析场景、FieldCatalog 和执行契约。</span>
              <input id="import-har-input" type="file" accept=".har,application/json">
            </label>
          `}
        </div>
        <footer>
          <button class="btn" data-action="close-import">取消</button>
          ${preview ? `<button class="btn btn-primary" data-action="generate-import"
            ${preview.generation_gate?.allow_generate === false ? "disabled" : ""}>生成用例</button>` : ""}
        </footer>
      </section>
    </div>`;
}
