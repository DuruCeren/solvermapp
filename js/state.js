// SolverMapp — App state: storage keys, theme, project defaults and normalisation, loading,
// auto-save and undo.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

const LS_PROJECT = "solverMapp_v06";
const LS_ACTIVE = "solverMapp_active";
const LS_THEME = "solverMapp_theme";
const LS_SIDEBAR = "solverMapp_sidebar"; // { width, collapsed }: a preference of this browser, not of the project
// The app was called SolverBlueprint: carry its saved project and settings over once.
[[LS_PROJECT, "solverBlueprint_v06"], [LS_ACTIVE, "solverBlueprint_active"], [LS_THEME, "solverBlueprint_theme"]].forEach(([key, old]) => {
  try { if (localStorage.getItem(key) === null && localStorage.getItem(old) !== null) localStorage.setItem(key, localStorage.getItem(old)); } catch (e) { /* storage blocked */ }
});

let activeTab = "guide"; // the app opens on the Guide (cheatsheet)
let currentExportLang = "python";
let autoSaveTimer = null;

// ================================================================
// THEME
// ================================================================
let isDarkMode = (() => {
  const saved = localStorage.getItem(LS_THEME);
  if (saved) return saved === "dark";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
})();

// The graph and all chips are coloured with CSS variables, so nothing needs re-rendering.
function applyTheme() {
  document.documentElement.dataset.theme = isDarkMode ? "dark" : "light";
  document.getElementById("themeToggleBtn").textContent = isDarkMode ? "Light" : "Dark";
}

function toggleTheme() {
  isDarkMode = !isDarkMode;
  localStorage.setItem(LS_THEME, isDarkMode ? "dark" : "light");
  applyTheme();
}



function newId() {
  return "eq_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Report tab settings, saved with the project.
const REPORT_DEFAULTS = {
  title: "", author: "",
  nomenclature: true, equations: true, algorithm: true, flowchart: true, references: true,
  values: true, grouping: "role", mode: "standalone"
};

// Flowchart tab settings, saved with the project.
const FLOW_DEFAULTS = { numbers: true, titles: true };

// Fills in fields added after v0.6 so older saved projects keep working.
function normalizeEquation(eq) {
  const e = Object.assign({
    id: newId(), name: "", author: "", year: "", eqNumber: "", source: "",
    archetype: "explicit", latex: "", outputs: [], inputs: [], loopMeta: "", assumptions: "",
    ioAuto: false, typeAuto: false, unitCheck: true,
    condition: "" // "Applies when": LaTeX condition, e.g. R_e < 2300; empty = always
  }, eq);
  if (e.source === "No citation") e.source = "";
  if (e.assumptions === "None specified") e.assumptions = "";
  if (/^untitled equation$/i.test(e.name)) e.name = "";
  return e;
}

function normalizeProject(p) {
  return {
    equations: (p.equations || []).map(normalizeEquation),
    variableMeta: p.variableMeta || {},
    report: Object.assign({}, REPORT_DEFAULTS, p.report),
    flowchart: Object.assign({}, FLOW_DEFAULTS, p.flowchart),
    indices: p.indices || "" // index notation: "i, j = 1..N; k = 1..M"
  };
}

function loadProject() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_PROJECT));
    if (saved && Array.isArray(saved.equations)) return normalizeProject(saved);
  } catch (e) { /* fall through to demo */ }
  return normalizeProject(JSON.parse(JSON.stringify(defaultData)));
}

let projectData = loadProject();
let activeId = localStorage.getItem(LS_ACTIVE);
if (!projectData.equations.some(e => e.id === activeId)) activeId = projectData.equations[0]?.id || null;

function activeEq() {
  return projectData.equations.find(e => e.id === activeId) || null;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function triggerAutoSave() {
  const badge = document.getElementById("saveStatusBadge");
  badge.classList.add("saving");
  badge.lastElementChild.textContent = "Saving…";
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    localStorage.setItem(LS_PROJECT, JSON.stringify(projectData));
    localStorage.setItem(LS_ACTIVE, activeId || "");
    badge.classList.remove("saving");
    badge.lastElementChild.textContent = "Saved in this browser";
    autoSaveTimer = null;
  }, 400);
}

// ================================================================
// UNDO (delete, reset, open)
// ================================================================
let undoSnapshot = null;
let toastTimer = null;

function withUndo(message, action) {
  const before = JSON.stringify({ projectData, activeId });
  action();
  undoSnapshot = before;
  document.getElementById("toastMsg").textContent = message;
  document.getElementById("toastUndo").hidden = false;
  document.getElementById("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 20000);
}

function notify(message) {
  undoSnapshot = null;
  document.getElementById("toastMsg").textContent = message;
  document.getElementById("toastUndo").hidden = true;
  document.getElementById("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4000);
}

function hideToast() {
  document.getElementById("toast").hidden = true;
  undoSnapshot = null;
}

function undo() {
  if (!undoSnapshot) return;
  const s = JSON.parse(undoSnapshot);
  hideToast();
  projectData = s.projectData;
  activeId = s.activeId;
  refreshAll();
}
