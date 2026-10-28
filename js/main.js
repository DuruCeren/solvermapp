// SolverMapp — Tabs, refresh, and start-up (binds every part and draws the first screen).
// Loaded last.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// TABS & REFRESH
// ================================================================
function switchTab(tab) {
  activeTab = tab;
  const views = { guide: "viewGuide", vault: "viewVault", vars: "viewVars", arch: "viewArch", flow: "viewFlow", code: "viewCode", report: "viewReport" };
  const btns = { guide: "tabBtnGuide", vault: "tabBtnVault", vars: "tabBtnVars", arch: "tabBtnArch", flow: "tabBtnFlow", code: "tabBtnCode", report: "tabBtnReport" };
  $("layout").classList.toggle("guide-mode", tab === "guide");
  Object.keys(views).forEach(k => {
    $(views[k]).hidden = (k !== tab);
    $(btns[k]).classList.toggle("active", k === tab);
    if (k === tab) $(btns[k]).setAttribute("aria-current", "page"); else $(btns[k]).removeAttribute("aria-current");
  });
  $(btns[tab]).scrollIntoView({ block: "nearest", inline: "nearest" }); // the step bar scrolls sideways on narrow screens
  // Both variable tables can be edited, so each is redrawn when it comes into view
  if (tab === "vault" || tab === "vars") renderVariableTable();
  if (tab === "vault") { growCardFields(); maybeStartTour(); }
  else if (tour) endTour();
  if (tab === "arch") renderArchitectureView();
  if (tab === "code") renderCodeExportView();
  if (tab === "report") renderReportView();
  if (tab === "flow") renderFlowView();
}

function refreshAll() {
  projectData.equations.forEach(eq => syncType(eq)); // projects saved with a type chosen by hand
  if (!projectData.equations.some(e => e.id === activeId)) activeId = projectData.equations[0]?.id || null;
  selectedIds = new Set([...selectedIds].filter(id => projectData.equations.some(e => e.id === id)));
  if (activeId) selectedIds.add(activeId);
  triggerAutoSave();
  $("indexDefs").value = projectData.indices || "";
  renderSidebar();
  renderCard();
  renderVariableTable();
  if (activeTab === "arch") renderArchitectureView();
  if (activeTab === "code") renderCodeExportView();
  if (activeTab === "report") renderReportView();
  if (activeTab === "flow") renderFlowView();
}

bindCardEvents();
bindCardSections();
bindArrayEditors();
bindTour();
bindRootPanelEvents();
bindGraphEvents();
bindReportEvents();
bindFlowEvents();
bindListEvents();
bindSidebarResize();
bindShortcuts();
applySidebar();
$("varSearch").addEventListener("input", e => { varSearch = e.target.value.trim(); renderVariableTable(); });
// Index declaration: changes how subscripts are read, so automatic detection runs again
$("indexDefs").addEventListener("change", e => {
  projectData.indices = e.target.value.trim();
  projectData.equations.forEach(eq => { if (eq.ioAuto || eq.typeAuto) applyDetection(eq); });
  refreshAll();
});
renderGraphLegend();
showMathState();
window.addEventListener("online", () => { if (!mathOk) loadMath(); }); // retry by itself when the connection returns
renderStaticMath();
renderExampleChips();
$("unitSuggestions").innerHTML = UNIT_SUGGESTIONS.map(u => `<option value="${escapeHtml(u)}">`).join("");
applyTheme();
refreshAll();
