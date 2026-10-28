// SolverMapp — The equation list: numbering, selection, collapse / resize, drag and drop,
// right-click menu, keyboard shortcuts, clipboard, and the list actions.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// EQUATION LIST (left)
// ================================================================
// The number of an equation is its position in the list (#1, #2, ...): the report, flowchart
// and graph number equations the same way. The article's own number (Eq. 14.5) is part of the source.
function sidebarItemHtml(eq, index, varList) {
  const ab = ARCHETYPE_BADGES[eq.archetype || "explicit"];
  const active = eq.id === activeId;
  const selected = selectedIds.has(eq.id) && selectedIds.size > 1;
  const name = eq.name || "Untitled equation";
  return `
    <li data-id="${eq.id}" draggable="true">
      <button class="eq-item${active ? " active" : ""}${selected ? " selected" : ""}" data-select="${eq.id}" title="#${index + 1} ${escapeHtml(name)}"${active ? ' aria-current="true"' : ""}>
        <span class="eq-item-head">
          <span class="eq-item-index">#${index + 1}</span>
          <span class="eq-item-title${eq.name ? "" : " placeholder"}">${escapeHtml(name)}</span>
        </span>
        <span class="eq-item-sym" aria-hidden="true">${ab.symbol}</span>
        ${eq.latex.trim() ? `<span class="eq-item-math">${renderMath(eq.latex)}</span>` : ""}
        <span class="eq-item-type">${ab.symbol} ${ab.label}${conditionText(eq) ? `<span class="eq-item-cond">if ${renderMath(conditionText(eq))}</span>` : String(eq.condition || "").trim() ? `<span class="eq-item-cond">otherwise</span>` : ""}${unitCheckBadge(eq, varList)}</span>
      </button>
      <button class="eq-item-delete" title="Delete (can be undone)" aria-label="Delete ${escapeHtml(name)}" onclick="deleteEquation('${eq.id}')">×</button>
    </li>`;
}

function renderSidebar() {
  const list = document.getElementById("equationList");
  document.getElementById("eqCountBadge").textContent = projectData.equations.length;
  const varList = buildVariableRegistry();
  list.innerHTML = projectData.equations.length
    ? projectData.equations.map((eq, i) => sidebarItemHtml(eq, i, varList)).join("")
    : `<li class="sidebar-empty">No equations yet.</li>`;
}

function updateSidebarItem(eq) {
  const index = projectData.equations.indexOf(eq);
  const old = document.querySelector(`#equationList li[data-id="${eq.id}"]`);
  if (old && index >= 0) old.outerHTML = sidebarItemHtml(eq, index, buildVariableRegistry());
}

function focusActiveItem() {
  document.querySelector(`#equationList li[data-id="${activeId}"] .eq-item`)?.focus();
}

// ---------- Collapse and resize ----------
const sidebarPrefs = (() => {
  const prefs = { width: 272, collapsed: false };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(LS_SIDEBAR))); } catch (e) { /* defaults */ }
  return prefs;
})();

function applySidebar() {
  const layout = $("layout");
  layout.classList.toggle("side-collapsed", sidebarPrefs.collapsed);
  if (sidebarPrefs.collapsed) layout.style.removeProperty("--side-w");
  else layout.style.setProperty("--side-w", sidebarPrefs.width + "px");
  $("sideResizer").style.left = sidebarPrefs.width + "px";
  const btn = $("sideToggleBtn");
  btn.title = (sidebarPrefs.collapsed ? "Expand" : "Collapse") + " the list (Ctrl+B)";
  btn.setAttribute("aria-label", (sidebarPrefs.collapsed ? "Expand" : "Collapse") + " the equation list");
  btn.setAttribute("aria-expanded", String(!sidebarPrefs.collapsed));
}

function saveSidebar() {
  try { localStorage.setItem(LS_SIDEBAR, JSON.stringify(sidebarPrefs)); } catch (e) { /* not saved */ }
}

function toggleSidebar() {
  sidebarPrefs.collapsed = !sidebarPrefs.collapsed;
  applySidebar();
  saveSidebar();
}

function bindSidebarResize() {
  const handle = $("sideResizer");
  handle.addEventListener("pointerdown", e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    const move = ev => {
      sidebarPrefs.width = Math.round(Math.max(200, Math.min(560, ev.clientX)));
      applySidebar();
    };
    const up = ev => {
      handle.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      if (ev.clientX < 150) { sidebarPrefs.width = 272; sidebarPrefs.collapsed = true; applySidebar(); } // dragged shut
      saveSidebar();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
  handle.addEventListener("dblclick", toggleSidebar);
}

// ---------- Right-click menu ----------
function closeContextMenu() {
  const menu = document.querySelector(".ctx-menu");
  if (!menu) return;
  menu.remove();
  menu._onClose?.();
}

function openContextMenu(x, y) {
  closeContextMenu();
  const list = selectedEquations();
  const eqs = projectData.equations;
  const first = eqs.indexOf(list[0]);
  const last = eqs.indexOf(list[list.length - 1]);
  const block = last - first + 1 === list.length; // a contiguous selection
  const one = list.length === 1;
  const items = [
    ["Copy", "Ctrl+C", () => copyEquations(list), false],
    ["Cut", "Ctrl+X", cutEquations, false],
    ["Paste below", "Ctrl+V", () => (eqClipboard ? pasteEquations(eqClipboard) : navigator.clipboard?.readText().then(t => pasteEquations(t)).catch(() => pasteEquations(""))), false],
    ["Duplicate", "Ctrl+D", duplicateEquation, false],
    null,
    ["Move up", "Alt+↑", () => moveEquations({ delta: -1 }), block && first === 0],
    ["Move down", "Alt+↓", () => moveEquations({ delta: 1 }), block && last === eqs.length - 1],
    ["Move to top", "", () => moveEquations({ to: 0 }), block && first === 0],
    ["Move to bottom", "", () => moveEquations({ to: eqs.length }), block && last === eqs.length - 1],
    null,
    ["Export card", "", exportCard, !one],
    ["Delete", "Del", () => removeEquations(list, `Deleted ${eqLabel(list)}`), false, "danger"]
  ];
  showMenu(items, { x, y, label: one ? `#${first + 1}` : `${list.length} equations`, count: one ? 0 : list.length, onEscape: focusActiveItem });
}

// A small popup menu (right-click menu, File menu). items: [label, keys, run, disabled, cls, note] or null for a rule.
function showMenu(items, { x, y, label, count = 0, onEscape, onClose, alignRight = false }) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  menu._onClose = onClose;
  items.forEach(item => {
    if (!item) { menu.appendChild(document.createElement("hr")); return; }
    const [text, keys, run, disabled, cls, note] = item;
    const b = document.createElement("button");
    b.setAttribute("role", "menuitem");
    b.disabled = disabled;
    if (cls) b.className = cls;
    b.innerHTML = `<span>${text}${text === "Delete" && count ? ` ${count}` : ""}${note ? `<small class="menu-note">${note}</small>` : ""}</span><kbd>${keys}</kbd>`;
    b.addEventListener("click", () => { closeContextMenu(); run(); });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  const left = alignRight ? x - r.width : x;
  menu.style.left = Math.max(8, Math.min(left, innerWidth - r.width - 8)) + "px";
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  menu.querySelector("button:not(:disabled)")?.focus();
  menu.addEventListener("keydown", e => {
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
    const k = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(k + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
    if (e.key === "Home" || e.key === "End") { e.preventDefault(); buttons[e.key === "Home" ? 0 : buttons.length - 1].focus(); }
    if (e.key === "Tab") closeContextMenu();
    if (e.key === "Escape") { closeContextMenu(); onEscape?.(); }
  });
}

// ---------- File menu (top bar) ----------
// Everything that reads or writes a file, and the two actions that replace the project.
// The replacing ones come last, set apart and marked, so they are not clicked by mistake.
function toggleFileMenu() {
  const btn = $("fileMenuBtn");
  if (btn.getAttribute("aria-expanded") === "true") { closeContextMenu(); return; }
  const r = btn.getBoundingClientRect();
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const eq = activeEq();
  showMenu([
    ["Import file…", mod + "O", openFilePicker, false, "", "A project, or a card to add"],
    ["Export project", mod + "S", exportProjectJSON, false, "", `As ${projectFileName()}`],
    ["Export open card", "", exportCard, !eq, "", eq ? `“${escapeHtml(eq.name || "Untitled equation")}” with its variables` : "No equation is open"],
    null,
    ["Open the example", "", resetToDemo, false, "danger", "Replaces this project · can be undone"],
    ["New project", "", resetProject, false, "danger", "Replaces this project · can be undone"]
  ], {
    x: r.right, y: r.bottom + 6, alignRight: true, label: "File",
    onEscape: () => btn.focus(),
    onClose: () => btn.setAttribute("aria-expanded", "false")
  });
  btn.setAttribute("aria-expanded", "true");
}

function openFilePicker() {
  $("jsonFileInput").value = ""; // so the same file can be imported twice
  $("jsonFileInput").click();
}

// ---------- Click, drag and drop ----------
let dragIds = null; // ids being dragged from this list (null: a drag from elsewhere)

function bindListEvents() {
  const list = $("equationList");
  list.addEventListener("click", e => {
    const btn = e.target.closest("[data-select]");
    if (!btn) return;
    window.getSelection()?.removeAllRanges();
    clickEquation(btn.dataset.select, e);
    focusActiveItem();
  });
  list.addEventListener("contextmenu", e => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    e.preventDefault();
    if (!selectedIds.has(li.dataset.id)) selectEquation(li.dataset.id);
    openContextMenu(e.clientX, e.clientY);
  });

  const clearMarks = () => {
    list.classList.remove("drop-copy");
    list.querySelectorAll(".drop-before, .drop-after").forEach(li => li.classList.remove("drop-before", "drop-after"));
  };
  // The gap the pointer is over: list position of the equation the drop goes before.
  const dropTarget = e => {
    const items = [...list.querySelectorAll("li[data-id]")];
    for (let k = 0; k < items.length; k++) {
      const r = items[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return { to: k, li: items[k], side: "drop-before" };
    }
    return { to: items.length, li: items[items.length - 1], side: "drop-after" };
  };
  const copying = e => e.ctrlKey || e.altKey || e.metaKey || !dragIds;

  list.addEventListener("dragstart", e => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const id = li.dataset.id;
    dragIds = selectedIds.has(id) ? selectedEquations().map(x => x.id) : [id];
    const dragged = projectData.equations.filter(x => dragIds.includes(x.id));
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", clipboardText(dragged));
    dragIds.forEach(x => list.querySelector(`li[data-id="${x}"]`)?.classList.add("dragging"));
    closeContextMenu();
  });
  list.addEventListener("dragover", e => {
    e.preventDefault();
    const copy = copying(e);
    e.dataTransfer.dropEffect = copy ? "copy" : "move";
    clearMarks();
    list.classList.toggle("drop-copy", copy);
    const t = dropTarget(e);
    t.li?.classList.add(t.side);
  });
  list.addEventListener("dragleave", e => { if (!list.contains(e.relatedTarget)) clearMarks(); });
  list.addEventListener("drop", e => {
    e.preventDefault();
    clearMarks();
    const { to } = dropTarget(e);
    if (dragIds && !copying(e)) {
      selectedIds = new Set(dragIds);
      if (!selectedIds.has(activeId)) activeId = dragIds[0];
      moveEquations({ to });
    } else {
      pasteEquations(e.dataTransfer.getData("text/plain"), to);
    }
    dragIds = null;
  });
  list.addEventListener("dragend", () => {
    clearMarks();
    list.querySelectorAll(".dragging").forEach(li => li.classList.remove("dragging"));
    dragIds = null;
  });
}

// ---------- Keyboard and clipboard ----------
// Shortcuts act on equations when no text is being edited or selected, on the Equations tab
// or with the focus in the list.
function listShortcutsOn() {
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return false;
  if (String(window.getSelection?.() || "").trim()) return false;
  if (document.querySelector(".ctx-menu")) return false;
  return activeTab === "vault" || !!el?.closest?.(".sidebar");
}

function bindShortcuts() {
  document.addEventListener("keydown", e => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === "b" && !e.shiftKey && !e.altKey) { e.preventDefault(); toggleSidebar(); return; }
    // The project is kept in the browser already; Ctrl+S exports a file, Ctrl+O imports one.
    if (ctrl && key === "s" && !e.shiftKey && !e.altKey) { e.preventDefault(); closeContextMenu(); exportProjectJSON(); return; }
    if (ctrl && key === "o" && !e.shiftKey && !e.altKey) { e.preventDefault(); closeContextMenu(); openFilePicker(); return; }
    if (!listShortcutsOn() || !projectData.equations.length) return;
    const inList = !!document.activeElement?.closest?.("#equationList");
    if (ctrl && !e.altKey && key === "c") { e.preventDefault(); copyEquations(); }
    else if (ctrl && !e.altKey && key === "x") { e.preventDefault(); cutEquations(); }
    else if (ctrl && !e.altKey && key === "d") { e.preventDefault(); duplicateEquation(); }
    else if (ctrl && key === "a" && inList) { e.preventDefault(); selectedIds = new Set(projectData.equations.map(x => x.id)); renderSidebar(); focusActiveItem(); }
    else if (e.key === "Delete" && !ctrl) { e.preventDefault(); const l = selectedEquations(); removeEquations(l, `Deleted ${eqLabel(l)}`); }
    else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); moveEquations({ delta: e.key === "ArrowUp" ? -1 : 1 }); }
    else if (inList && !ctrl && !e.altKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const k = projectData.equations.findIndex(x => x.id === activeId) + (e.key === "ArrowUp" ? -1 : 1);
      if (projectData.equations[k]) { openEquationByIndex(k); focusActiveItem(); }
    }
  });
  // Ctrl+V: the paste event gives the clipboard text without asking for permission
  document.addEventListener("paste", e => {
    if (!listShortcutsOn()) return;
    const text = e.clipboardData?.getData("text/plain") || "";
    const usable = equationsFromText(text) ? text : eqClipboard;
    if (!usable && !text) return;
    e.preventDefault();
    pasteEquations(usable || text);
  });
  document.addEventListener("pointerdown", e => { if (!e.target.closest(".ctx-menu, #fileMenuBtn")) closeContextMenu(); });
  window.addEventListener("blur", closeContextMenu);
  window.addEventListener("resize", closeContextMenu);
  document.addEventListener("scroll", closeContextMenu, true);
}


// ================================================================
// EQUATION ACTIONS
// ================================================================
// Equations selected in the list (Ctrl/Shift+click). The open equation is always one of them;
// copy, cut, move and delete act on all of them, in list order.
let selectedIds = new Set();

function selectEquation(id) {
  activeId = id;
  selectedIds = new Set([id]);
  if (activeTab !== "vault") switchTab("vault");
  renderSidebar();
  renderCard();
  renderVariableTable();
  triggerAutoSave();
}

function openEquationByIndex(i) {
  const eq = projectData.equations[i];
  if (eq) selectEquation(eq.id);
}

// Click in the list: plain opens, Ctrl/Cmd adds or removes, Shift selects the range from the open one.
function clickEquation(id, e) {
  const eqs = projectData.equations;
  if (e.shiftKey && activeId) {
    const [a, b] = [eqs.findIndex(x => x.id === activeId), eqs.findIndex(x => x.id === id)].sort((x, y) => x - y);
    selectedIds = new Set(eqs.slice(a, b + 1).map(x => x.id));
    renderSidebar();
  } else if (e.ctrlKey || e.metaKey) {
    if (selectedIds.has(id) && selectedIds.size > 1) {
      selectedIds.delete(id);
      if (activeId === id) { activeId = eqs.find(x => selectedIds.has(x.id)).id; renderCard(); renderVariableTable(); }
    } else {
      selectedIds.add(id);
      activeId = id;
      renderCard();
      renderVariableTable();
    }
    renderSidebar();
    if (activeTab !== "vault") switchTab("vault");
  } else {
    selectEquation(id);
  }
}

function selectedEquations() {
  if (activeId) selectedIds.add(activeId);
  return projectData.equations.filter(e => selectedIds.has(e.id));
}

const eqLabel = list => list.length === 1 ? `“${list[0].name || "Untitled equation"}”` : `${list.length} equations`;

function newEquation() {
  const eq = normalizeEquation({ id: newId(), ioAuto: true, typeAuto: true });
  projectData.equations.push(eq);
  selectEquation(eq.id);
  $("cardName").focus();
}

// The clipboard holds equations as JSON with their variable details, so they can be pasted
// into this or another project (also in another browser tab).
const CLIPBOARD_FORMAT = "solvermapp-cards";
let eqClipboard = "";

function clipboardText(list) {
  const meta = {};
  list.forEach(eq => [...eq.inputs, ...eq.outputs].forEach(s => { if (projectData.variableMeta[s]) meta[s] = projectData.variableMeta[s]; }));
  return JSON.stringify({ format: CLIPBOARD_FORMAT, version: 1, equations: list, variableMeta: meta, indices: projectData.indices || "" }, null, 2);
}

// Equations in clipboard text: our own format, a saved card or project, or a plain LaTeX equation.
function equationsFromText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  try {
    const data = JSON.parse(t);
    if (data && (data.format === CLIPBOARD_FORMAT || Array.isArray(data.equations))) return { equations: data.equations || [], variableMeta: data.variableMeta || {} };
    if (data && /^(solvermapp|solverblueprint)-card$/.test(data.format) && data.equation) return { equations: [data.equation], variableMeta: data.variableMeta || {} };
    return null;
  } catch (e) { /* not JSON */ }
  // LaTeX copied from a paper or another tool: one equation per line
  const lines = t.replace(/^\$+|\$+$/g, "").split(/\n+|\\\\/).map(l => l.trim().replace(/^\$+|\$+$|[,.]$/g, "")).filter(l => l.includes("="));
  if (!lines.length || lines.length > 50 || t.length > 5000) return null;
  return { latex: lines, equations: lines.map(line => {
    const eq = { ioAuto: true, typeAuto: true };
    setTypedEquation(eq, line);
    return eq;
  }), variableMeta: {} };
}

function copyEquations(list = selectedEquations(), toSystemClipboard = true) {
  if (!list.length) return "";
  eqClipboard = clipboardText(list);
  if (toSystemClipboard) navigator.clipboard?.writeText(eqClipboard).catch(() => {});
  notify(`Copied ${eqLabel(list)}. Paste with Ctrl+V, here or in another project.`);
  return eqClipboard;
}

// Inserts copies after `index` (default: after the last selected equation) and selects them.
function pasteEquations(text = eqClipboard, index) {
  const data = equationsFromText(text);
  if (!data || !data.equations.length) { notify("Nothing to paste: copy equations first (Ctrl+C in the list)."); return false; }
  const sel = selectedEquations();
  const at = index ?? (sel.length ? projectData.equations.indexOf(sel[sel.length - 1]) + 1 : projectData.equations.length);
  const copies = data.equations.map(e => normalizeEquation(Object.assign(JSON.parse(JSON.stringify(e)), { id: newId() })));
  withUndo(`Pasted ${eqLabel(copies)}`, () => {
    Object.entries(data.variableMeta).forEach(([s, m]) => { if (!projectData.variableMeta[s]) projectData.variableMeta[s] = m; });
    if (data.latex) copies.forEach(applyDetection);
    projectData.equations.splice(at, 0, ...copies);
    activeId = copies[0].id;
    selectedIds = new Set(copies.map(e => e.id));
    refreshAll();
  });
  return true;
}

function cutEquations() {
  const list = selectedEquations();
  if (!list.length) return;
  copyEquations(list);
  removeEquations(list, `Cut ${eqLabel(list)}. Paste with Ctrl+V`);
}

function duplicateEquation() {
  const list = selectedEquations();
  if (!list.length) return;
  const last = projectData.equations.indexOf(list[list.length - 1]);
  const copies = list.map(eq => Object.assign(JSON.parse(JSON.stringify(eq)), { id: newId(), name: (eq.name || "Untitled equation") + " (copy)" }));
  projectData.equations.splice(last + 1, 0, ...copies);
  activeId = copies[0].id;
  selectedIds = new Set(copies.map(e => e.id));
  if (activeTab !== "vault") switchTab("vault");
  refreshAll();
}

function deleteEquation(id) {
  const eq = projectData.equations.find(e => e.id === id);
  if (!eq) return;
  // The × of a selected equation deletes the whole selection
  const list = selectedIds.has(id) && selectedIds.size > 1 ? selectedEquations() : [eq];
  removeEquations(list, `Deleted ${eqLabel(list)}`);
}

function removeEquations(list, message) {
  const gone = new Set(list.map(e => e.id));
  const eqs = projectData.equations;
  const first = eqs.findIndex(e => gone.has(e.id));
  withUndo(message, () => {
    projectData.equations = eqs.filter(e => !gone.has(e.id));
    if (gone.has(activeId)) activeId = (projectData.equations[first] || projectData.equations[first - 1] || {}).id || null;
    selectedIds = new Set(activeId ? [activeId] : []);
    refreshAll();
  });
}

// Moves the selected equations as one block: by `delta` places, or to the gap before list position `to`.
function moveEquations({ delta, to } = {}) {
  const list = selectedEquations();
  if (!list.length) return;
  const eqs = projectData.equations;
  const moving = new Set(list.map(e => e.id));
  const rest = eqs.filter(e => !moving.has(e.id));
  let at;
  if (to !== undefined) at = eqs.slice(0, to).filter(e => !moving.has(e.id)).length;
  else {
    const first = eqs.findIndex(e => moving.has(e.id));
    at = Math.max(0, Math.min(rest.length, first + delta));
  }
  const order = [...rest.slice(0, at), ...list, ...rest.slice(at)];
  if (order.every((e, i) => e === eqs[i])) return;
  projectData.equations = order;
  refreshAll();
  document.querySelector(`#equationList li[data-id="${activeId}"] .eq-item`)?.focus();
}

// Only saves: the table cell already shows the new value, and not re-rendering keeps keyboard focus.
// The row's issue marker and the filter counts are refreshed in place.
function updateVarMeta(symbol, field, value, el) {
  ensureVarMeta(symbol)[field] = value;
  if (field === "codeName") {
    const v = value.trim();
    const bad = !!v && !isValidIdentifier(v);
    el.classList.toggle("bad", bad);
    el.title = bad ? "Use letters, digits and _ only, starting with a letter" : "Name used in exported code (empty = automatic)";
  }
  if (field === "units") {
    el.classList.toggle("bad", !!unitError(value));
    el.title = unitTitle(value);
    afterUnitChange();
  } else if (field === "size") {
    // Vectors and matrices change how equations are read (transposes) and exported.
    el.classList.toggle("bad", !!parseSize(value)?.error);
    triggerAutoSave();
    renderSidebar();
    renderUnitCheck(activeEq());
    scheduleRootPanel(activeEq());
  } else {
    triggerAutoSave();
  }
  if (field === "initVal") scheduleRootPanel(activeEq());
  // An array grid takes its shape from the Size, or from a variable used in a Size (N): redraw it
  const code = codeOf(symbol);
  if (field === "size" || (field === "initVal" && Object.values(projectData.variableMeta).some(m => parseSize(m.size)?.dims?.includes(code)))) {
    renderVariableTable();
    return;
  }
  refreshVarIssues();
}

function unitTitle(text) {
  if (!text.trim()) return "No unit yet. Type e.g. m/s, kg/m^3, W/(m·K), or 1 for dimensionless";
  const err = unitError(text);
  return err || "SI: " + Units.describe(Units.parse(text));
}
