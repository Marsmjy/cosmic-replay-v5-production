import { escapeHtml } from "../utils.js?v=20260615-2";

function envStatus(env) {
  if (!env.base_url) return ["is-danger", "缺少地址"];
  if (!env.datacenter_id) return ["is-warning", "缺少数据中心"];
  if (!env.credentials?.configured) return ["is-warning", "凭证待确认"];
  return ["is-success", "可用于执行"];
}

function envDraft(state, envId) {
  return state.envDrafts?.[envId] || {};
}

function credentialDraft(draft) {
  return draft.credentials || {};
}

function optionList(envs, selected) {
  return (envs || []).map((env) => `
    <option value="${escapeHtml(env.id)}" ${env.id === selected ? "selected" : ""}>
      ${escapeHtml(env.name || env.id)} (${escapeHtml(env.id)})
    </option>
  `).join("");
}

function field(label, html, help = "") {
  return `
    <label class="settings-field">
      <span>${escapeHtml(label)}</span>
      ${html}
      ${help ? `<small>${escapeHtml(help)}</small>` : ""}
    </label>`;
}

function input(attrs) {
  const {
    value = "",
    type = "text",
    envId = "",
    path = "",
    webui = "",
    extra = "",
    placeholder = "",
  } = attrs;
  const data = envId
    ? `data-env-id="${escapeHtml(envId)}" data-env-field="${escapeHtml(path)}"`
    : `data-webui-field="${escapeHtml(webui)}"`;
  return `<input class="input" type="${escapeHtml(type)}" value="${escapeHtml(value)}"
    placeholder="${escapeHtml(placeholder)}" ${data} ${extra}>`;
}

function checkbox(envId, path, checked) {
  return `<input type="checkbox" ${checked ? "checked" : ""}
    data-env-id="${escapeHtml(envId)}" data-env-field="${escapeHtml(path)}">`;
}

function textarea(envId, path, value, placeholder = "") {
  return `<textarea class="input" data-env-id="${escapeHtml(envId)}"
    data-env-field="${escapeHtml(path)}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`;
}

function renderWebuiPrefs(state) {
  const draft = state.webuiDraft || {};
  return `
    <section class="settings-panel">
      <div class="settings-panel-heading">
        <div>
          <h2>默认环境与本地路径</h2>
          <p>这些配置影响 Web UI 默认目标环境；端口和监听地址需要重启进程才会完全生效。</p>
        </div>
        <div class="toolbar-actions">
          <button class="btn" data-action="reset-webui">重置</button>
          <button class="btn btn-primary" data-action="save-webui">保存默认配置</button>
        </div>
      </div>
      <div class="settings-grid">
        ${field("默认环境", `<select data-webui-field="default_env">${optionList(state.envs, draft.default_env || state.envId)}</select>`)}
        ${field("监听地址", input({ value: draft.host || "", webui: "host", placeholder: "127.0.0.1" }))}
        ${field("端口", input({ value: draft.port ?? "", type: "number", webui: "port", extra: 'min="1" max="65535"' }))}
        ${field("启动后打开浏览器", `<label class="switch-label">
          <input type="checkbox" data-webui-field="open_browser" ${draft.open_browser ? "checked" : ""}> 打开
        </label>`)}
        ${field("用例目录", input({ value: draft.cases_dir || "", webui: "cases_dir" }))}
        ${field("HAR 上传目录", input({ value: draft.har_upload_dir || "", webui: "har_upload_dir" }))}
        ${field("日志目录", input({ value: draft.logging_dir || "", webui: "logging_dir" }))}
        ${field("日志级别", `<select data-webui-field="logging_level">
          ${["debug", "info", "warn"].map((level) =>
            `<option value="${level}" ${draft.logging_level === level ? "selected" : ""}>${level}</option>`
          ).join("")}
        </select>`)}
      </div>
    </section>`;
}

function renderCreatePanel(state) {
  if (!state.newEnvDialog) return "";
  const draft = state.newEnvDraft || {};
  return `
    <section class="settings-panel new-env-panel">
      <div class="settings-panel-heading">
        <div>
          <h2>新建环境</h2>
          <p>环境标识会作为本地 YAML 文件名，建议使用小写字母、数字、横线或下划线。</p>
        </div>
      </div>
      <div class="settings-grid compact">
        ${field("环境标识", `<input class="input" value="${escapeHtml(draft.id || "")}"
          data-new-env-field="id" placeholder="uat2">`)}
        ${field("克隆自", `<select data-new-env-field="cloneFrom">
          <option value="">空白模板</option>
          ${optionList(state.envs, draft.cloneFrom || "")}
        </select>`, "从现有环境复制 base_url、数据中心、基础资料和运行参数；密码不会被复制。")}
      </div>
      <div class="settings-actions">
        <button class="btn" data-action="cancel-new-env">取消</button>
        <button class="btn btn-primary" data-action="create-env">创建环境</button>
      </div>
    </section>`;
}

function renderEnvCard(state, env, index) {
  const draft = envDraft(state, env.id);
  const creds = credentialDraft(draft);
  const expanded = state.envExpanded?.[env.id] !== false;
  const showPassword = state.envShowPwd?.[env.id] === true;
  const [tone, label] = envStatus(env);
  const isDefault = (state.webuiDraft?.default_env || state.envId) === env.id;
  return `
    <section class="env-card ${expanded ? "is-expanded" : ""}" data-env-card="${escapeHtml(env.id)}">
      <button class="env-card-summary" data-action="toggle-env" data-env-id="${escapeHtml(env.id)}">
        <span class="env-order">${index + 1}</span>
        <span>
          <strong>${escapeHtml(env.name || env.id)}</strong>
          <small><code>${escapeHtml(env.id)}</code> · ${escapeHtml(env.base_url || "未配置 base_url")}</small>
        </span>
        <span class="status-label ${tone}">${label}</span>
        ${isDefault ? '<span class="status-label is-accent">默认</span>' : ""}
      </button>
      ${expanded ? `
        <div class="env-card-body">
          <div class="settings-grid">
            ${field("显示名", input({ value: draft.name || "", envId: env.id, path: "name" }))}
            ${field("Base URL", input({ value: draft.base_url || "", envId: env.id, path: "base_url", placeholder: "https://example.com/ierp" }))}
            ${field("数据中心 ID", input({ value: draft.datacenter_id || "", envId: env.id, path: "datacenter_id" }))}
            ${field("签名要求", `<label class="switch-label">${checkbox(env.id, "sign_required", draft.sign_required !== false)} 请求需要签名</label>`)}
            ${field("超时（秒）", input({ value: draft.timeout ?? 30, type: "number", envId: env.id, path: "timeout", extra: 'min="1"' }))}
            ${field("登录重试次数", input({ value: draft.login_retries ?? 3, type: "number", envId: env.id, path: "login_retries", extra: 'min="0"' }))}
          </div>

          <div class="settings-subsection">
            <div class="settings-subsection-heading">
              <strong>凭证</strong>
              <span>${env.credentials?.configured ? "已配置，可用于登录" : "未完整配置"}</span>
            </div>
            <div class="settings-grid">
              ${field("用户名", input({ value: creds.username || "", envId: env.id, path: "credentials.username", placeholder: "留空则可使用环境变量" }))}
              ${field("密码", `<div class="secret-input">
                <input class="input" type="${showPassword ? "text" : "password"}"
                  value="${escapeHtml(creds.password || "")}"
                  data-env-id="${escapeHtml(env.id)}" data-env-field="credentials.password"
                  placeholder="留空可清除；******** 表示保留原密码">
                <button class="text-btn" data-action="toggle-secret" data-env-id="${escapeHtml(env.id)}">
                  ${showPassword ? "隐藏" : "显示"}
                </button>
              </div>`, "保存掩码 ******** 时会保留原密码；输入新值才会更新。")}
              ${field("用户名环境变量", input({ value: creds.username_env || "", envId: env.id, path: "credentials.username_env", placeholder: "COSMIC_USERNAME" }))}
              ${field("密码环境变量", input({ value: creds.password_env || "", envId: env.id, path: "credentials.password_env", placeholder: "COSMIC_PASSWORD" }))}
            </div>
          </div>

          <div class="settings-subsection">
            <div class="settings-subsection-heading">
              <strong>基础资料 ID 映射</strong>
              <span>每行一个 key=value，用例可通过 ${"${basedata.xxx}"} 引用。</span>
            </div>
            ${textarea(env.id, "basedata_text", draft.basedata_text || "", "org=123456\\nposition=abcdef")}
          </div>

          <div class="settings-actions">
            <button class="btn btn-danger" data-action="delete-env" data-env-id="${escapeHtml(env.id)}">删除</button>
            <span class="settings-action-spacer"></span>
            <button class="btn" data-action="set-default-env" data-env-id="${escapeHtml(env.id)}">设为默认</button>
            <button class="btn" data-action="reset-env" data-env-id="${escapeHtml(env.id)}">重置</button>
            <button class="btn btn-primary" data-action="save-env" data-env-id="${escapeHtml(env.id)}">保存环境</button>
          </div>
        </div>
      ` : ""}
    </section>`;
}

export function renderEnvironmentSettings(state) {
  return `
    <div class="settings-workspace">
      <div class="section-toolbar settings-toolbar">
        <div>
          <strong>环境配置</strong>
          <span>${(state.envs || []).length} 个环境 · 当前目标 ${escapeHtml(state.envId || "未选择")}</span>
        </div>
        <div class="toolbar-actions">
          <button class="btn" data-action="reload-settings">重新加载</button>
          <button class="btn btn-primary" data-action="new-env">新建环境</button>
        </div>
      </div>
      <div class="settings-intro">
        <strong>这里维护导入 HAR、执行用例和 resolver 精确查询所需的目标环境。</strong>
        <span>技术诊断仍保留在用例和运行详情里；普通执行前只需要确认环境、业务变量和 readiness。</span>
      </div>
      ${renderWebuiPrefs(state)}
      ${renderCreatePanel(state)}
      <div class="env-list">
        ${(state.envs || []).map((env, index) => renderEnvCard(state, env, index)).join("") ||
          '<div class="empty-state">还没有环境配置。点击“新建环境”开始。</div>'}
      </div>
    </div>`;
}

export function makeEnvDraft(env) {
  return {
    id: env.id,
    name: env.name || env.id,
    base_url: env.base_url || "",
    datacenter_id: env.datacenter_id || "",
    credentials: {
      username: env.credentials?.username || "",
      password: env.credentials?.password || "",
      username_env: env.credentials?.username_env || "",
      password_env: env.credentials?.password_env || "",
    },
    basedata_text: basedataToText(env.basedata || {}),
    sign_required: env.sign_required !== false,
    timeout: env.timeout ?? 30,
    login_retries: env.login_retries ?? 3,
  };
}

export function basedataToText(basedata) {
  return Object.entries(basedata || {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function parseBasedata(text) {
  const out = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function environmentPayloadFromDraft(draft) {
  return {
    name: draft.name || draft.id,
    base_url: draft.base_url || "",
    datacenter_id: draft.datacenter_id || "",
    credentials: {
      username: draft.credentials?.username || "",
      password: draft.credentials?.password || "",
      username_env: draft.credentials?.username_env || "",
      password_env: draft.credentials?.password_env || "",
    },
    basedata: parseBasedata(draft.basedata_text),
    sign_required: draft.sign_required !== false,
    timeout: Number.parseInt(draft.timeout, 10) || 30,
    login_retries: Number.parseInt(draft.login_retries, 10) || 0,
  };
}

export function defaultEnvTemplate(id) {
  return {
    id,
    name: id,
    base_url: "",
    datacenter_id: "",
    credentials: { username: "", password: "", username_env: "", password_env: "" },
    basedata_text: "",
    sign_required: true,
    timeout: 30,
    login_retries: 3,
  };
}
