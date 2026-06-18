import { api } from "../api-client.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// ============================================================
// 打开设置页：加载未掩码配置，初始化草稿
// ============================================================
export async function openSettings(store) {
  store.update({ busy: true, error: "" });
  try {
    const cfg = await api.config(false);
    const envs = Array.isArray(cfg.envs) ? cfg.envs : [];
    const drafts = {};
    envs.forEach((e) => { drafts[e.id] = cloneEnv(e); });
    store.update({
      stage: "settings",
      settingsTab: "envs",
      config: cfg,
      envs,
      envDrafts: drafts,
      busy: false,
    });
  } catch (error) {
    store.update({ busy: false, stage: "settings", error: "加载配置失败：" + error.message });
  }
}

function cloneEnv(e) {
  return {
    id: e.id,
    name: e.name || e.id,
    base_url: e.base_url || "",
    datacenter_id: e.datacenter_id || "",
    credentials: {
      username: e.credentials?.username || "",
      password: e.credentials?.password || "",
    },
    basedata: { ...(e.basedata || {}) },
    sign_required: e.sign_required !== false,
    timeout: e.timeout || 30,
    login_retries: e.login_retries || 3,
  };
}

// ============================================================
// 渲染
// ============================================================
export function renderSettings(state) {
  const envs = state.envs || [];
  const dialog = state.newEnvDialog ? renderNewEnvDialog(state) : "";
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>环境与凭证管理</h2>
        <div class="toolbar">
          <button class="btn" id="settings-refresh">刷新</button>
          <button class="btn btn-primary" id="settings-new-env">新建环境</button>
        </div>
      </div>
      <div class="panel-body">
        <p class="cell-muted" style="margin:0 0 12px">维护目标环境的地址、数据中心、登录凭证与基础资料映射；保存即写入版本化配置并热重载。</p>
        <div class="env-list">
          ${envs.map((e) => renderEnvCard(e, state)).join("") ||
            '<div class="empty-state">尚无环境配置，点击「新建环境」创建第一个目标环境。</div>'}
        </div>
      </div>
    </section>
    ${dialog}`;
}

function renderEnvCard(env, state) {
  const id = env.id;
  const expanded = Boolean(state.envExpanded?.[id]);
  const draft = state.envDrafts?.[id] || cloneEnv(env);
  const showPwd = Boolean(state.envShowPwd?.[id]);
  const isDefault = state.config?.webui?.default_env === id;
  return `
    <div class="env-card">
      <div class="env-card-head" data-env-toggle="${escapeHtml(id)}">
        <span class="env-caret">${expanded ? "▾" : "▸"}</span>
        <strong>${escapeHtml(env.name || id)}</strong>
        <code class="env-id">${escapeHtml(id)}</code>
        ${isDefault ? '<span class="badge is-accent">默认</span>' : ""}
        ${env.credentials?.configured ? '<span class="badge is-success">凭证就绪</span>' : '<span class="badge is-warning">凭证待配置</span>'}
        <span style="flex:1"></span>
        <small class="cell-muted">${escapeHtml(env.base_url || "未设置地址")}</small>
      </div>
      ${expanded ? `
      <div class="env-card-body">
        <div class="field-row">
          <label>显示名</label>
          <input class="input" data-env-field="name" data-env-id="${escapeHtml(id)}" value="${escapeHtml(draft.name)}">
        </div>
        <div class="field-row">
          <label>Base URL</label>
          <input class="input" data-env-field="base_url" data-env-id="${escapeHtml(id)}" value="${escapeHtml(draft.base_url)}" placeholder="https://example.com">
        </div>
        <div class="field-row">
          <label>数据中心 ID</label>
          <input class="input" data-env-field="datacenter_id" data-env-id="${escapeHtml(id)}" value="${escapeHtml(draft.datacenter_id)}">
        </div>
        <div class="field-row">
          <label>用户名</label>
          <input class="input" data-env-field="username" data-env-id="${escapeHtml(id)}" value="${escapeHtml(draft.credentials.username)}" autocomplete="off">
        </div>
        <div class="field-row">
          <label>密码</label>
          <div class="pwd-wrap">
            <input class="input" type="${showPwd ? "text" : "password"}" data-env-field="password" data-env-id="${escapeHtml(id)}" value="${escapeHtml(draft.credentials.password)}" autocomplete="new-password">
            <button class="btn" type="button" data-env-pwd-toggle="${escapeHtml(id)}">${showPwd ? "隐藏" : "显示"}</button>
          </div>
        </div>
        <div class="field-row">
          <label>超时(秒)</label>
          <input class="input" type="number" data-env-field="timeout" data-env-id="${escapeHtml(id)}" value="${escapeHtml(draft.timeout)}" style="width:120px">
        </div>
        <div class="field-row">
          <label>登录重试</label>
          <input class="input" type="number" data-env-field="login_retries" data-env-id="${escapeHtml(id)}" value="${escapeHtml(draft.login_retries)}" style="width:120px">
        </div>
        <div class="field-row">
          <label>需要签名</label>
          <label class="switch-label"><input type="checkbox" data-env-field="sign_required" data-env-id="${escapeHtml(id)}" ${draft.sign_required ? "checked" : ""}> 启用接口签名</label>
        </div>
        ${renderBasedata(id, draft)}
        <div class="toolbar" style="margin-top:14px;justify-content:flex-end">
          <button class="btn btn-danger" data-env-delete="${escapeHtml(id)}">删除</button>
          <button class="btn btn-primary" data-env-save="${escapeHtml(id)}" ${state.busy ? "disabled" : ""}>保存</button>
        </div>
      </div>` : ""}
    </div>`;
}

function renderBasedata(id, draft) {
  const entries = Object.entries(draft.basedata || {});
  return `
    <div class="field-group" style="margin-top:6px">
      <div class="field-group-title">
        <strong>基础资料映射</strong>
        <button class="btn" data-basedata-add="${escapeHtml(id)}">新增字段</button>
      </div>
      <div class="table-wrap">
        <table class="field-table" style="min-width:0">
          <thead><tr><th style="width:40%">key</th><th>value</th><th style="width:70px">操作</th></tr></thead>
          <tbody>
            ${entries.map(([k, v]) => `
              <tr>
                <td><input class="input" data-basedata-key="${escapeHtml(id)}" data-old-key="${escapeHtml(k)}" value="${escapeHtml(k)}"></td>
                <td><input class="input" data-basedata-val="${escapeHtml(id)}" data-key="${escapeHtml(k)}" value="${escapeHtml(v)}"></td>
                <td><button class="btn btn-danger" data-basedata-del="${escapeHtml(id)}" data-key="${escapeHtml(k)}">删除</button></td>
              </tr>`).join("") ||
              '<tr><td colspan="3" class="cell-muted">暂无基础资料映射</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderNewEnvDialog(state) {
  const envs = state.envs || [];
  return `
    <div class="modal-mask" id="new-env-mask">
      <div class="modal-card">
        <h2>新建环境</h2>
        <p class="cell-muted">环境标识用于文件名与下拉选择，建议使用英文小写（如 test、prod）。</p>
        <div class="field-row" style="margin-top:12px">
          <label>环境标识</label>
          <input class="input" id="new-env-id" value="${escapeHtml(state.newEnvId || "")}" placeholder="如 test">
        </div>
        <div class="field-row">
          <label>克隆自</label>
          <select class="select" id="new-env-clone">
            <option value="">空白模板</option>
            ${envs.map((e) => `<option value="${escapeHtml(e.id)}" ${e.id === state.newEnvClone ? "selected" : ""}>${escapeHtml(e.name || e.id)}</option>`).join("")}
          </select>
        </div>
        <div class="toolbar" style="margin-top:16px;justify-content:flex-end">
          <button class="btn" id="new-env-cancel">取消</button>
          <button class="btn btn-primary" id="new-env-confirm">创建</button>
        </div>
      </div>
    </div>`;
}

// ============================================================
// 绑定
// ============================================================
export function bindSettings(store) {
  if (store.get().stage !== "settings") return;

  document.querySelector("#settings-refresh")?.addEventListener("click", () => openSettings(store));
  document.querySelector("#settings-new-env")?.addEventListener("click", () =>
    store.update({ newEnvDialog: true, newEnvId: "", newEnvClone: store.get().envs?.[0]?.id || "" }));

  // 展开/折叠
  document.querySelectorAll("[data-env-toggle]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.envToggle;
      store.mutate((draft) => {
        draft.envExpanded = { ...draft.envExpanded, [id]: !draft.envExpanded?.[id] };
        if (draft.envExpanded[id] && !draft.envDrafts[id]) {
          const env = (draft.envs || []).find((e) => e.id === id);
          if (env) draft.envDrafts = { ...draft.envDrafts, [id]: cloneEnv(env) };
        }
      });
    });
  });

  // 字段编辑（不触发整树重渲染：直接写草稿）
  document.querySelectorAll("[data-env-field]").forEach((el) => {
    el.addEventListener("input", () => {
      const id = el.dataset.envId;
      const field = el.dataset.envField;
      const s = store.get();
      const d = s.envDrafts[id] || {};
      if (field === "username" || field === "password") {
        d.credentials = { ...d.credentials, [field]: el.value };
      } else if (field === "sign_required") {
        d.sign_required = el.checked;
      } else if (field === "timeout" || field === "login_retries") {
        d[field] = Number(el.value) || 0;
      } else {
        d[field] = el.value;
      }
      s.envDrafts[id] = d; // 原地更新草稿，避免重渲染丢失焦点
    });
  });

  // 密码显隐
  document.querySelectorAll("[data-env-pwd-toggle]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.envPwdToggle;
      store.update({ envShowPwd: { ...store.get().envShowPwd, [id]: !store.get().envShowPwd?.[id] } });
    });
  });

  // basedata 操作
  document.querySelectorAll("[data-basedata-add]").forEach((el) => {
    el.addEventListener("click", () => mutateBasedata(store, el.dataset.basedataAdd, (bd) => {
      bd["_new_" + Date.now().toString(36)] = "";
    }));
  });
  document.querySelectorAll("[data-basedata-del]").forEach((el) => {
    el.addEventListener("click", () => mutateBasedata(store, el.dataset.basedataDel, (bd) => {
      delete bd[el.dataset.key];
    }));
  });
  document.querySelectorAll("[data-basedata-key]").forEach((el) => {
    el.addEventListener("change", () => mutateBasedata(store, el.dataset.basedataKey, (bd) => {
      const oldKey = el.dataset.oldKey;
      const newKey = el.value.trim();
      if (!newKey || newKey === oldKey) return;
      bd[newKey] = bd[oldKey];
      delete bd[oldKey];
    }));
  });
  document.querySelectorAll("[data-basedata-val]").forEach((el) => {
    el.addEventListener("input", () => {
      const id = el.dataset.basedataVal;
      const s = store.get();
      const d = s.envDrafts[id];
      if (d) d.basedata[el.dataset.key] = el.value; // 原地更新
    });
  });

  // 保存 / 删除
  document.querySelectorAll("[data-env-save]").forEach((el) => {
    el.addEventListener("click", () => saveEnv(store, el.dataset.envSave));
  });
  document.querySelectorAll("[data-env-delete]").forEach((el) => {
    el.addEventListener("click", () => deleteEnv(store, el.dataset.envDelete));
  });

  // 新建环境对话框
  document.querySelector("#new-env-cancel")?.addEventListener("click", () => store.update({ newEnvDialog: false }));
  document.querySelector("#new-env-mask")?.addEventListener("click", (e) => {
    if (e.target.id === "new-env-mask") store.update({ newEnvDialog: false });
  });
  document.querySelector("#new-env-id")?.addEventListener("input", (e) =>
    store.mutate((draft) => { draft.newEnvId = e.target.value; }));
  document.querySelector("#new-env-clone")?.addEventListener("change", (e) =>
    store.mutate((draft) => { draft.newEnvClone = e.target.value; }));
  document.querySelector("#new-env-confirm")?.addEventListener("click", () => confirmNewEnv(store));
}

function mutateBasedata(store, id, fn) {
  store.mutate((draft) => {
    const d = draft.envDrafts[id];
    if (!d) return;
    const bd = { ...d.basedata };
    fn(bd);
    d.basedata = bd;
  });
}

function buildPayload(draft) {
  const basedata = {};
  for (const [k, v] of Object.entries(draft.basedata || {})) {
    if (k && k.trim() && !k.startsWith("_new_")) basedata[k.trim()] = String(v);
  }
  return {
    name: draft.name,
    base_url: draft.base_url,
    datacenter_id: draft.datacenter_id,
    credentials: {
      username: draft.credentials.username || "",
      password: draft.credentials.password || "",
    },
    basedata,
    sign_required: draft.sign_required !== false,
    timeout: Number(draft.timeout) || 30,
    login_retries: Number(draft.login_retries) || 3,
  };
}

async function saveEnv(store, id) {
  const draft = store.get().envDrafts[id];
  if (!draft) return;
  store.update({ busy: true, error: "" });
  try {
    await api.saveEnv(id, buildPayload(draft));
    // 重新拉取顶栏下拉用的掩码列表 + 设置页未掩码配置
    const [maskedEnvs, cfg] = await Promise.all([api.envs(), api.config(false)]);
    const drafts = {};
    (cfg.envs || []).forEach((e) => { drafts[e.id] = cloneEnv(e); });
    store.update({ busy: false, envs: cfg.envs || maskedEnvs, config: cfg, envDrafts: drafts, notice: `已保存环境 ${id}` });
  } catch (error) {
    store.update({ busy: false, error: "保存失败：" + error.message });
  }
}

async function deleteEnv(store, id) {
  if (!confirm(`确认删除环境 ${id}？此操作不可撤销。`)) return;
  store.update({ busy: true, error: "" });
  try {
    await api.deleteEnv(id);
    const cfg = await api.config(false);
    const drafts = {};
    (cfg.envs || []).forEach((e) => { drafts[e.id] = cloneEnv(e); });
    store.mutate((draft) => {
      draft.busy = false;
      draft.envs = cfg.envs || [];
      draft.config = cfg;
      draft.envDrafts = drafts;
      delete draft.envExpanded[id];
      if (draft.envId === id) draft.envId = (cfg.envs?.[0]?.id) || "";
      draft.notice = `已删除环境 ${id}`;
    });
  } catch (error) {
    store.update({ busy: false, error: "删除失败：" + error.message });
  }
}

async function confirmNewEnv(store) {
  const s = store.get();
  const id = (s.newEnvId || "").trim();
  if (!id) { store.update({ error: "环境标识不能为空" }); return; }
  let template = {
    name: id, base_url: "", datacenter_id: "",
    credentials: { username: "", password: "" }, basedata: {},
    sign_required: true, timeout: 30, login_retries: 3,
  };
  if (s.newEnvClone) {
    const src = (s.envs || []).find((e) => e.id === s.newEnvClone);
    if (src) {
      template = buildPayload(cloneEnv(src));
      template.name = id;
      template.credentials.password = ""; // 克隆不带密码
    }
  }
  store.update({ busy: true, error: "" });
  try {
    await api.saveEnv(id, template);
    const cfg = await api.config(false);
    const drafts = {};
    (cfg.envs || []).forEach((e) => { drafts[e.id] = cloneEnv(e); });
    store.update({
      busy: false, newEnvDialog: false, envs: cfg.envs || [], config: cfg,
      envDrafts: drafts, envExpanded: { ...s.envExpanded, [id]: true }, notice: `已创建环境 ${id}`,
    });
  } catch (error) {
    store.update({ busy: false, error: "创建失败：" + error.message });
  }
}
