// SolverMapp — Files: open and save projects (.json) and single cards (.card.json).
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// FILES: whole project (.json) and single card (.card.json)
// ================================================================
function fileSlug(text, fallback) {
  return String(text || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || fallback;
}

// The project file is named after the report title when there is one.
function projectFileName() {
  return fileSlug(projectData.report?.title, "solvermapp") + ".json";
}

function exportProjectJSON() {
  const name = projectFileName();
  downloadText(name, JSON.stringify(projectData, null, 2));
  notify(`Exported ${name}`);
}

function exportCard() {
  const eq = activeEq();
  if (!eq) return;
  const meta = {};
  [...eq.inputs, ...eq.outputs].forEach(s => { if (projectData.variableMeta[s]) meta[s] = projectData.variableMeta[s]; });
  const name = `${fileSlug(eq.name, "equation")}.card.json`;
  downloadText(name, JSON.stringify({ format: "solvermapp-card", version: 1, equation: eq, variableMeta: meta }, null, 2));
  notify(`Exported ${name}`);
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const loaded = JSON.parse(e.target.result);
      if (loaded && loaded.format === CLIPBOARD_FORMAT) {
        pasteEquations(e.target.result, projectData.equations.length); // copied equations saved to a file
      } else if (loaded && /^(solvermapp|solverblueprint)-card$/.test(loaded.format) && loaded.equation) {
        // Single card: add it to the project, keeping existing variable details.
        const eq = normalizeEquation(Object.assign({}, loaded.equation, { id: newId() }));
        withUndo(`Added “${eq.name || "Untitled equation"}”`, () => {
          projectData.equations.push(eq);
          Object.entries(loaded.variableMeta || {}).forEach(([s, m]) => {
            if (!projectData.variableMeta[s]) projectData.variableMeta[s] = m;
          });
          activeId = eq.id;
          refreshAll();
        });
      } else if (loaded && Array.isArray(loaded.equations)) {
        withUndo(`Imported ${file.name}`, () => {
          projectData = normalizeProject(loaded);
          activeId = projectData.equations[0]?.id || null;
          selectedIds = new Set(activeId ? [activeId] : []);
          refreshAll();
          switchTab("vault");
        });
      } else {
        notify("This file is not a SolverMapp project or card.");
      }
    } catch (err) { notify("Could not read this file (invalid JSON)."); }
  };
  reader.readAsText(file);
  event.target.value = "";
}

// Reset: a new, empty project with one empty card (the demo stays available from the Guide).
function resetProject() {
  withUndo("Started a new, empty project", () => {
    projectData = normalizeProject({ equations: [{ id: newId(), ioAuto: true, typeAuto: true }] });
    activeId = projectData.equations[0].id;
    selectedIds = new Set([activeId]);
    if (activeTab !== "vault") switchTab("vault");
    refreshAll();
    $("cardName").focus();
  });
}

// Opens the demo on the Equations tab with its first card, so a new user sees a filled-in example.
function resetToDemo() {
  withUndo(`Demo opened: the N-body problem (N = 3) in ${defaultData.equations.length} equations. Click one in the list to see its card.`, () => {
    projectData = normalizeProject(JSON.parse(JSON.stringify(defaultData)));
    activeId = projectData.equations[0].id;
    selectedIds = new Set([activeId]);
    refreshAll();
    switchTab("vault");
  });
}
