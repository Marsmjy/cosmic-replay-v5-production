export function createState() {
  const listeners = new Set();
  const state = {
    stage: "import",
    envs: [],
    envId: "",
    health: null,
    file: null,
    busy: false,
    error: "",
    notice: "",
    preview: null,
    harFile: "",
    caseName: "",
    fieldDrafts: {},
    validationDrafts: {},
    resolvedFields: {},
    cases: [],
    selectedCase: "",
    runId: "",
    runEvents: [],
    result: null,
    technicalOpen: false,
  };
  return {
    get: () => state,
    update(patch) {
      Object.assign(state, patch);
      listeners.forEach((listener) => listener(state));
    },
    mutate(callback) {
      callback(state);
      listeners.forEach((listener) => listener(state));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

