// ⭐ P2: 新手引导（3 步 overlay，localStorage 记忆，跳过/完成后不再弹出）
const GUIDE_KEY = "cosmic-replay-vnext-guide-done";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const STEPS = [
  {
    title: "欢迎使用 Cosmic Replay vNext",
    body: "围绕业务结果重建的回放工作台：从一条真实 HAR 建立可执行业务模型，用户维护的值优先生效，执行结果按证据层级解释。",
    hint: "5 步线性流程在左侧导航：导入与建模 → 维护业务值 → 执行前检查 → 执行 → 业务结果。",
  },
  {
    title: "第一步：导入 HAR 并建模",
    body: "在「导入与建模」拖入或选择一条真实录制的 HAR，系统会解析出可维护的业务字段与目标环境敏感项，录制证据保持不变。",
    hint: "解析后可在「维护业务值」中只维护你能理解的业务字段，最终请求值始终可追踪。",
  },
  {
    title: "运行并查看业务结果",
    body: "执行前会先做安全门槛检查，再按业务阶段回放用例；结果区会区分请求成功与业务入库验证（PASS≠真实入库）。",
    hint: "顶栏可随时打开「日志」回看执行历史、打开「设置」维护环境凭证、切换深浅主题。",
  },
];

export function shouldShowGuide() {
  try {
    return localStorage.getItem(GUIDE_KEY) !== "1";
  } catch (e) {
    return false;
  }
}

function markGuideDone() {
  try {
    localStorage.setItem(GUIDE_KEY, "1");
  } catch (e) {
    // 忽略隐私模式等存储失败
  }
}

export function renderOnboarding(state) {
  if (!state.showGuide) return "";
  const total = STEPS.length;
  const idx = Math.min(Math.max(state.guideStep || 1, 1), total);
  const step = STEPS[idx - 1];
  const isFirst = idx === 1;
  const isLast = idx === total;
  return `
    <div class="modal-mask" id="guide-mask">
      <div class="modal-card guide-card">
        <div class="guide-steps">
          ${STEPS.map((_, i) => `<span class="guide-dot ${i + 1 === idx ? "is-active" : ""} ${i + 1 < idx ? "is-done" : ""}"></span>`).join("")}
        </div>
        <p class="eyebrow">引导 ${idx} / ${total}</p>
        <h2>${escapeHtml(step.title)}</h2>
        <p class="guide-body">${escapeHtml(step.body)}</p>
        <p class="cell-muted guide-hint">${escapeHtml(step.hint)}</p>
        <div class="toolbar" style="margin-top:18px;justify-content:space-between">
          <button class="text-link" id="guide-skip">跳过引导</button>
          <span style="flex:1"></span>
          ${isFirst ? "" : '<button class="btn" id="guide-prev">上一步</button>'}
          <button class="btn btn-primary" id="guide-next">${isLast ? "开始使用" : "下一步"}</button>
        </div>
      </div>
    </div>`;
}

export function bindOnboarding(store) {
  if (!document.querySelector("#guide-mask")) return;
  const total = STEPS.length;
  const finish = () => {
    markGuideDone();
    store.update({ showGuide: false, guideStep: 1 });
  };
  document.querySelector("#guide-skip")?.addEventListener("click", finish);
  document.querySelector("#guide-prev")?.addEventListener("click", () => {
    store.update({ guideStep: Math.max((store.get().guideStep || 1) - 1, 1) });
  });
  document.querySelector("#guide-next")?.addEventListener("click", () => {
    const cur = store.get().guideStep || 1;
    if (cur >= total) finish();
    else store.update({ guideStep: cur + 1 });
  });
}
