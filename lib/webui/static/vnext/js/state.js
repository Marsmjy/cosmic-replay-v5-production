const STORAGE_KEY = "cosmic-replay-vnext-workspace";

function persistedState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function routeState() {
  const params = new URLSearchParams(location.search);
  return {
    view: params.get("view") || "",
    selectedCase: params.get("case") || "",
    caseTab: params.get("tab") || "",
    runId: params.get("run") || "",
    focusedStep: params.get("step") || "",
  };
}

export function createState() {
  const saved = persistedState();
  const route = routeState();
  const listeners = new Set();
  const state = {
    view: route.view || saved.view || "cases",
    caseTab: route.caseTab || saved.caseTab || "overview",
    envs: [],
    envId: saved.envId || "",
    webuiPrefs: {},
    webuiDraft: {},
    envDrafts: {},
    envExpanded: {},
    envShowPwd: {},
    newEnvDialog: false,
    newEnvDraft: { id: "", cloneFrom: "" },
    settingsBusy: false,
    health: null,
    cases: [],
    selectedCase: route.selectedCase || saved.selectedCase || "",
    caseDetail: null,
    caseSearch: "",
    fieldDrafts: {},
    fieldFilters: { search: "", stage: "", type: "", status: "" },
    selectedFields: new Set(),
    resolverResults: {},
    busy: false,
    error: "",
    notice: "",
    runId: route.runId || saved.runId || "",
    run: null,
    runEvents: [],
    focusedStep: route.focusedStep || "",
    runs: [],
    diagnosis: null,
    repairPreview: null,
    diagnosticCopyText: "",
    logFilters: { category: "", severity: "", stepId: "", search: "" },
    autoScroll: true,
    importMode: false,
    importFile: null,
    importPreview: null,
  };

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      view: state.view,
      caseTab: state.caseTab,
      envId: state.envId,
      selectedCase: state.selectedCase,
      runId: state.runId,
    }));
    const params = new URLSearchParams();
    if (state.view !== "cases") params.set("view", state.view);
    if (state.selectedCase) params.set("case", state.selectedCase);
    if (state.caseTab !== "overview") params.set("tab", state.caseTab);
    if (state.runId) params.set("run", state.runId);
    if (state.focusedStep) params.set("step", state.focusedStep);
    history.replaceState({}, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  }

  function notify() {
    persist();
    listeners.forEach((listener) => listener(state));
  }

  return {
    get: () => state,
    update(patch) {
      Object.assign(state, patch);
      notify();
    },
    mutate(callback) {
      callback(state);
      notify();
    },
    silent(callback) {
      callback(state);
      persist();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
