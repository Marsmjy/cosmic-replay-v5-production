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
    // ⭐ 文件夹树（左树右表）
    folders: [],            // 后端返回的子目录相对路径列表
    rootLabel: "根节点",     // 根节点别名
    currentFolder: "",      // 当前选中文件夹（空串=根）
    expandedFolders: {},    // 展开状态 { path: true }
    checkedCases: [],        // 右表勾选的用例 name 数组
    caseSearch: "",          // 右表搜索关键词
    showMoveDialog: false,   // 移动对话框开关
    moveTargetFolder: "",    // 移动目标文件夹
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

