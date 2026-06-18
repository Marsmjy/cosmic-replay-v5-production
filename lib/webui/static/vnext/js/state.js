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
    // ⭐ 用例详情多 Tab
    detailTab: "result",     // result | vars | validation | yaml | steps
    currentCase: "",         // 当前打开详情的用例 name
    yamlSource: "",          // YAML 源文本
    yamlDirty: false,        // YAML 是否有未保存修改
    caseFieldCatalog: [],    // 用例字段目录（来自 GET yaml）
    detailPreview: null,     // 用例详情字段/校验点预览（复用 field-editor / validation-points）
    // ⭐ 运行态（单次诊断与修复）
    phases: [],              // 执行步骤阶段
    summary: null,           // case_done 汇总
    fixes: [],               // advisor 输出修复项
    repairPlan: [],          // 结构化修复计划
    failureAnalysis: null,   // 失败归因
    singleRunDiagnosis: null,// GET diagnosis 结果（report-like case result）
    running: false,          // 单次运行进行中
    resolvedVars: [],        // 运行期解析变量
    envFields: [],           // 环境字段解析结果
    selectedStep: "",        // 当前选中的步骤 id
    // ⭐ 批量任务系统与报告
    taskId: "",              // 当前任务 id
    taskDetail: null,        // 轮询的任务详情
    batchRunning: false,     // 批量任务进行中
    currentReport: null,     // 当前展示的报告
    showReportDialog: false, // 报告弹窗开关
    reportCurrentFolder: "", // 报告左树当前文件夹
    reportExpandedFolders: {},// 报告左树展开状态
    // ⭐ P1/P2: 主题与新手引导
    theme: "light",          // light | dark
    showGuide: false,        // 新手引导弹窗开关
    guideStep: 1,            // 引导步骤 1..3
    // ⭐ P1/P2: 用例稳定性
    stability: {},           // map: caseName -> { is_flaky, pass_rate, total_runs, passed, failed }
    // ⭐ P1/P2: 设置 / 环境管理
    settingsTab: "envs",     // envs（预留 general）
    envDrafts: {},           // map: envId -> 草稿对象
    envExpanded: {},         // map: envId -> 展开状态
    envShowPwd: {},          // map: envId -> 密码显隐
    newEnvDialog: false,     // 新建环境对话框开关
    newEnvId: "",            // 新建环境标识
    newEnvClone: "",        // 克隆源环境 id
    config: null,            // /api/config 返回
    // ⭐ P1/P2: 日志 / 执行历史
    runHistory: [],          // 执行历史列表
    selectedRunId: "",      // 当前选中的历史 run
    historyPhases: [],       // 历史详情步骤
    historyVars: [],         // 历史详情运行变量
    historyEnvFields: [],    // 历史详情环境字段
    historySummary: null,    // 历史详情摘要
    selectedHistoryStep: "",// 当前选中的历史步骤 id
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

