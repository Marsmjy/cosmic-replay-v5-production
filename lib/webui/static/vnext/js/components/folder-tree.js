import { api } from "../api-client.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// 某文件夹（含所有子孙）下的用例 name 列表；folderPath 为空=全部
export function casesUnderFolder(state, folderPath) {
  if (!folderPath) return (state.cases || []).map((c) => c.name);
  const prefix = folderPath + "/";
  return (state.cases || []).filter((c) => (c.name || "").startsWith(prefix)).map((c) => c.name);
}

// 判断用例是否属于指定文件夹（含子孙；根节点返回全部）
export function caseInFolder(caseName, folderPath) {
  if (!folderPath) return true;
  return (caseName || "").startsWith(folderPath + "/");
}

// 根节点统计全部用例
export function rootCaseCount(state) {
  return (state.cases || []).length;
}

// 由 folders + cases 路径前缀合成树（caseCount 为含子孙的递归总数）
export function buildTree(state) {
  const dirSet = new Set(state.folders || []);
  for (const c of state.cases || []) {
    const idx = (c.name || "").lastIndexOf("/");
    if (idx > 0) {
      const parts = c.name.slice(0, idx).split("/");
      let acc = "";
      for (const part of parts) {
        acc = acc ? acc + "/" + part : part;
        dirSet.add(acc);
      }
    }
  }
  const allDirs = Array.from(dirSet).filter(Boolean).sort();
  const nodeMap = {};
  for (const dir of allDirs) {
    nodeMap[dir] = {
      path: dir,
      name: dir.split("/").pop(),
      children: [],
      caseCount: casesUnderFolder(state, dir).length,
    };
  }
  const roots = [];
  for (const dir of allDirs) {
    const node = nodeMap[dir];
    const pidx = dir.lastIndexOf("/");
    if (pidx > 0) {
      const parent = dir.slice(0, pidx);
      if (nodeMap[parent]) nodeMap[parent].children.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// 扁平化（含 depth），跟随 expandedFolders 决定是否展开子节点
export function flatTree(state) {
  const result = [];
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      const hasChildren = node.children && node.children.length > 0;
      const expanded = !!state.expandedFolders[node.path];
      result.push({
        path: node.path, name: node.name, depth,
        caseCount: node.caseCount, hasChildren, expanded,
      });
      if (hasChildren && expanded) walk(node.children, depth + 1);
    }
  };
  walk(buildTree(state), 0);
  return result;
}

// 左树 HTML（根节点 + 扁平文件夹节点）
export function renderFolderTree(state) {
  const nodes = flatTree(state);
  const rootActive = !state.currentFolder ? "is-active" : "";
  const rootRow = `
    <div class="tree-row ${rootActive}" data-folder-path="" title="${escapeHtml(state.rootLabel)}">
      <span class="tree-indent" style="width:0"></span>
      <span class="tree-caret tree-caret-empty"></span>
      <span class="tree-label">${escapeHtml(state.rootLabel)} (${rootCaseCount(state)})</span>
      <span class="tree-actions">
        <button class="tree-act" data-tree-act="rename-root" title="重命名根节点">✎</button>
        <button class="tree-act" data-tree-act="new-root-folder" title="新建文件夹">＋</button>
      </span>
    </div>`;
  const folderRows = nodes.map((node) => {
    const active = state.currentFolder === node.path ? "is-active" : "";
    const caret = node.hasChildren
      ? `<button class="tree-caret" data-tree-toggle="${escapeHtml(node.path)}">${node.expanded ? "▾" : "▸"}</button>`
      : `<span class="tree-caret tree-caret-empty"></span>`;
    return `
      <div class="tree-row ${active}" data-folder-path="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">
        <span class="tree-indent" style="width:${node.depth * 14}px"></span>
        ${caret}
        <span class="tree-label">${escapeHtml(node.name)} (${node.caseCount})</span>
        <span class="tree-actions">
          <button class="tree-act" data-tree-act="new-sub" data-path="${escapeHtml(node.path)}" title="新建子文件夹">＋</button>
          <button class="tree-act" data-tree-act="rename" data-path="${escapeHtml(node.path)}" title="重命名">✎</button>
          <button class="tree-act" data-tree-act="delete" data-path="${escapeHtml(node.path)}" title="删除">🗑</button>
        </span>
      </div>`;
  }).join("");
  return `
    <aside class="folder-tree">
      <div class="folder-tree-head">
        <strong>文件夹</strong>
      </div>
      <div class="folder-tree-body">
        ${rootRow}
        ${folderRows}
      </div>
    </aside>`;
}

// 绑定左树事件（选中/展开/增删改）。actions 提供 reload 回调以刷新状态。
export function bindFolderTree(store, reload) {
  document.querySelectorAll("[data-folder-path]").forEach((el) => {
    el.addEventListener("click", (event) => {
      if (event.target.closest("[data-tree-act]") || event.target.closest("[data-tree-toggle]")) return;
      store.update({ currentFolder: el.dataset.folderPath, checkedCases: [] });
    });
  });
  document.querySelectorAll("[data-tree-toggle]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      const path = el.dataset.treeToggle;
      store.mutate((draft) => { draft.expandedFolders[path] = !draft.expandedFolders[path]; });
    });
  });
  document.querySelectorAll("[data-tree-act]").forEach((el) => {
    el.addEventListener("click", async (event) => {
      event.stopPropagation();
      const act = el.dataset.treeAct;
      const path = el.dataset.path || "";
      try {
        if (act === "new-root-folder" || act === "new-sub") {
          const name = (prompt("新建文件夹名称", "新建文件夹") || "").trim();
          if (!name) return;
          if (name.includes("/")) { store.update({ error: "名称不能包含 /" }); return; }
          const full = act === "new-sub" && path ? path + "/" + name : name;
          await api.createFolder(full);
          if (act === "new-sub") store.mutate((draft) => { draft.expandedFolders[path] = true; });
        } else if (act === "rename") {
          const cur = path.split("/").pop();
          const name = (prompt("重命名文件夹", cur) || "").trim();
          if (!name || name === cur) return;
          if (name.includes("/")) { store.update({ error: "名称不能包含 /" }); return; }
          const pidx = path.lastIndexOf("/");
          const newPath = pidx > 0 ? path.slice(0, pidx) + "/" + name : name;
          await api.renameFolder(path, newPath);
        } else if (act === "delete") {
          const count = casesUnderFolder(store.get(), path).length;
          const msg = count > 0
            ? `文件夹「${path}」含 ${count} 个用例，确认连同用例一起删除？`
            : `确认删除空文件夹「${path}」？`;
          if (!confirm(msg)) return;
          await api.deleteFolder(path, count > 0);
          if (store.get().currentFolder === path) store.update({ currentFolder: "" });
        } else if (act === "rename-root") {
          const name = (prompt("根节点名称", store.get().rootLabel) || "").trim();
          if (!name) return;
          await api.updateFoldersMeta(name);
        }
        await reload();
      } catch (e) {
        store.update({ error: e.message });
      }
    });
  });
}
