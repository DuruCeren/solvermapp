// SolverMapp — The Variables tab and the array (grid) value editor.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// VARIABLES TABLE (right)
// ================================================================
let varRoleFilter = "all"; // all | a ROLE_UI key | issues
let varSearch = "";

function setVarRoleFilter(f) {
  varRoleFilter = f;
  renderVariableTable();
}

// Problems worth fixing before exporting code or writing the report.
// level "danger" breaks the export; "warn" makes it incomplete.
function variableIssues(v, allVars) {
  const issues = [];
  if (!v.units.trim()) issues.push({ level: "warn", text: "No unit" });
  else if (unitError(v.units)) issues.push({ level: "danger", text: "Invalid unit: " + unitError(v.units) });
  if (v.codeName.trim() && !isValidIdentifier(v.codeName.trim())) issues.push({ level: "danger", text: "Invalid code name" });
  const others = allVars.filter(o => o !== v);
  if (others.some(o => o.codeVar === v.codeVar)) issues.push({ level: "danger", text: "Another variable has the same code name" });
  else if (others.some(o => o.codeVar.toLowerCase() === v.codeVar.toLowerCase())) {
    issues.push({ level: "warn", text: "Code name differs from another only in upper/lower case: the same variable in Fortran" });
  }
  if (!v.desc.trim()) issues.push({ level: "warn", text: "No description (needed for the report)" });
  if (v.shape && v.shape.error) issues.push({ level: "danger", text: "Invalid size: " + v.shape.error });
  else if (!v.shape && v.indexedBy && looksNonScalar(v.symbol)) issues.push({ level: "danger", text: `A vector per index ${v.indexedBy.join(", ")}: give its Size, e.g. N x 3 (one row per index)` });
  else if (!v.shape && looksNonScalar(v.symbol) && !v.callable) issues.push({ level: "warn", text: "Written as a vector or matrix: give its Size (n, or n x m)" });
  return issues;
}

function varMatchesSearch(v, query) {
  if (!query) return true;
  const hay = [v.symbol, v.codeVar, v.units, v.desc, ROLE_UI[v.role].label, ...v.producedBy, ...v.usedAsInputIn].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).every(word => hay.includes(word));
}

function issueMarker(issues) {
  if (!issues.length) return "";
  const danger = issues.some(i => i.level === "danger");
  return `<span class="var-issue${danger ? " is-danger" : ""}" title="${escapeHtml(issues.map(i => i.text).join("\n"))}">!</span>`;
}

function renderVarFilters(scoped, allVars) {
  const count = key => key === "all" ? scoped.length
    : key === "issues" ? scoped.filter(v => variableIssues(v, allVars).length).length
    : scoped.filter(v => v.role === key).length;
  const chip = (key, label, swatch, title) => `
    <button class="filter${key === "issues" ? " filter-issues" : ""}" aria-pressed="${varRoleFilter === key}" title="${escapeHtml(title)}" onclick="setVarRoleFilter('${key}')">
      ${swatch ? `<i class="swatch" style="${swatch}"></i>` : ""}${label} <span class="filter-count">${count(key)}</span>
    </button>`;
  $("varFilters").innerHTML =
    chip("all", "All", "", "Every variable") +
    Object.entries(ROLE_UI).map(([key, r]) => chip(key, r.label, `background:var(${r.token})`, `${r.label}: ${r.hint}`)).join("") +
    chip("issues", "To check", "background:var(--warn)", "Missing or invalid units or sizes, code name problems, missing descriptions");
}

// Updates issue markers and filter counts without re-rendering the inputs.
function refreshVarIssues() {
  const allVars = buildVariableRegistry();
  const bySymbol = new Map(allVars.map(v => [v.symbol, v]));
  document.querySelectorAll("#variableTableBody tr[data-sym], #eqVarTableBody tr[data-sym]").forEach(tr => {
    const v = bySymbol.get(tr.dataset.sym);
    const cell = tr.querySelector(".var-issue-cell");
    if (v && cell) cell.innerHTML = issueMarker(variableIssues(v, allVars));
  });
  renderVarFilters(scopedVars(allVars), allVars);
}

// Variables that match the search of the Variables tab.
function scopedVars(allVars) {
  return allVars.filter(v => varMatchesSearch(v, varSearch));
}

// One editable row. `wide` (Variables tab): wider cells and the equations that compute and use it.
function variableRowHtml(v, allVars, wide = false) {
  const W = wide ? { start: 120, unit: 110, size: 76, code: 120 } : { start: 62, unit: 72, size: 58, code: 84 };
  const safeSym = escapeHtml(v.symbol.replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
  const needsStart = (v.role === "Global Input" || v.role === "State Var (y₀)" || !!v.guessFor) && !v.independentOf;
  const startTitle = v.independentOf ? `Independent variable of ${v.independentOf}: its range is in that card's loop settings`
    : v.callable ? `${v.symbol} is a function of ${v.args.join(", ")}${v.role === "Global Input" ? ": until it is defined by an equation (\\mu(T) = …), the exported function returns this value" : ""}`
    : v.guessFor ? `Initial guess for the Newton–Raphson iteration of ${v.guessFor} (unless its loop settings give a guess)`
    : v.role === "State Var (y₀)" && v.args.length ? "Initial value (at the start of the integration)"
    : v.shape ? "Start value: 1, 2, 3 (vector), 1, 2; 3, 4 (matrix rows), I (identity) or one value for all elements"
    : needsStart ? "Start value (a list like 1, 2, 3 for an indexed input)" : "Computed by an equation; used only as a starting guess";
  const where = [
    v.producedBy.length ? `Computed by: ${v.producedBy.join(", ")}` : "Not computed by any equation",
    v.usedAsInputIn.length ? `Used by: ${v.usedAsInputIn.join(", ")}` : ""
  ].filter(Boolean).join("\n");
  const duplicate = allVars.some(o => o !== v && o.codeVar === v.codeVar);
  const invalid = !!v.codeName.trim() && !isValidIdentifier(v.codeName.trim());
  const codeTitle = duplicate ? "Another variable has the same code name"
    : invalid ? "Use letters, digits and _ only, starting with a letter"
    : "Name used in exported code (empty = automatic)";
  return `
    <tr data-sym="${escapeHtml(v.symbol)}">
      <td title="${escapeHtml(ROLE_UI[v.role].label + " — " + ROLE_UI[v.role].hint + "\n" + where)}" style="white-space:nowrap"><span class="chip ${v.badgeStyle}">${renderMath(displaySymbol(v))}</span>${v.independentOf ? `<span class="var-tag" title="Independent variable">indep.</span>` : ""}${v.indexedBy ? `<span class="var-tag" title="Used with index notation">[${escapeHtml(v.indexedBy.join(","))}]</span>` : ""}<span class="var-issue-cell">${issueMarker(variableIssues(v, allVars))}</span></td>
      <td>${needsStart && arrayEditorHtml(v, allVars) || `<input class="cell-input mono${needsStart ? "" : " dim"}" type="text" value="${escapeHtml(v.initVal)}" placeholder="1.0" style="width:${v.shape ? W.start + 42 : W.start}px"
           title="${escapeHtml(startTitle)}"
           onchange="updateVarMeta('${safeSym}', 'initVal', this.value, this)">`}</td>
      <td><input class="cell-input mono${unitError(v.units) ? " bad" : ""}" type="text" value="${escapeHtml(v.units)}" placeholder="unit" style="width:${W.unit}px"
           list="unitSuggestions" spellcheck="false" title="${escapeHtml(unitTitle(v.units))}"
           onchange="updateVarMeta('${safeSym}', 'units', this.value, this)"></td>
      <td><input class="cell-input mono${v.shape && v.shape.error ? " bad" : ""}" type="text" value="${escapeHtml(v.size)}" placeholder="${looksNonScalar(v.symbol) ? "n" : ""}" style="width:${W.size}px"
           spellcheck="false" title="Size: empty for a scalar, n for a vector, n x m for a matrix (numbers or variables)"${v.callable ? " disabled" : ""}
           onchange="updateVarMeta('${safeSym}', 'size', this.value, this)"></td>
      <td><input class="cell-input mono${duplicate || invalid ? " bad" : ""}" type="text" value="${escapeHtml(v.codeName)}" placeholder="${escapeHtml(autoCodeName(v.symbol))}" style="width:${W.code}px"
           title="${codeTitle}" spellcheck="false"
           onchange="updateVarMeta('${safeSym}', 'codeName', this.value, this)"></td>
      <td><input class="cell-input" type="text" value="${escapeHtml(v.desc)}" placeholder="Add description"
           onchange="updateVarMeta('${safeSym}', 'desc', this.value, this)"></td>${wide ? `
      <td>${eqLinks(projectData.equations.filter(eq => eq.outputs.includes(v.symbol)))}</td>
      <td>${eqLinks(projectData.equations.filter(eq => eq.inputs.includes(v.symbol)))}</td>` : ""}
    </tr>`;
}

// #3 #5 buttons that open those equations
function eqLinks(eqs) {
  if (!eqs.length) return `<span class="small muted">–</span>`;
  return `<span class="eq-links">${eqs.map(eq => `<button class="eq-link" onclick="selectEquation('${eq.id}')" title="${escapeHtml(eq.name || "Untitled equation")}">#${projectData.equations.indexOf(eq) + 1}</button>`).join("")}</span>`;
}

function renderVariableTable() {
  const allVars = buildVariableRegistry();
  renderEqVariableTable(allVars);
  const scoped = scopedVars(allVars);
  renderVarFilters(scoped, allVars);
  const varList = scoped.filter(v => varRoleFilter === "all" ? true
    : varRoleFilter === "issues" ? variableIssues(v, allVars).length > 0
    : v.role === varRoleFilter);
  const tbody = $("variableTableBody");
  if (varList.length === 0) {
    const message = allVars.length === 0 ? "Variables will appear here." : "No variables match the filter.";
    tbody.innerHTML = `<tr><td colspan="8" class="muted small" style="text-align:center; padding:20px">${message}</td></tr>`;
    return;
  }
  tbody.innerHTML = varList.map(v => variableRowHtml(v, allVars, true)).join("");
}

// A variable that needs a value from the user: an input, the initial value of an ODE state, or the
// first guess of a Newton unknown. Everything else is computed.
const needsValue = v => (v.role === "Global Input" || v.role === "State Var (y₀)" || !!v.guessFor) && !v.independentOf;

// ---------- Array values as a grid ----------
// A vector is a numbered column, a matrix a numbered grid (rows x columns), so values are not
// typed side by side in one line. The grid writes the usual text form back: "1, 2, 3" or
// "1, 2; 3, 4". Very large arrays, sizes that can't be worked out, and arrays switched to
// "text" (for I, or pasting a whole list) keep the one-line box.
const ARRAY_GRID_MAX = 144;
const arrayTextMode = new Set(); // symbols shown as text instead of a grid

// Numeric dimensions of an array variable: sizes are numbers or variables with a number as value.
function numericDims(v, allVars) {
  if (!v.shape || v.shape.error) return null;
  const byCode = new Map(allVars.map(o => [o.codeVar, o]));
  const dims = v.shape.dims.map(d => {
    if (isNumber(d)) return Math.round(+d);
    const o = byCode.get(d);
    return o && isNumber(String(o.initVal).trim()) ? Math.round(+o.initVal) : NaN;
  });
  return dims.every(n => Number.isFinite(n) && n >= 1) ? dims : null;
}

// The value text as a rows x cols table of strings: a list ("1, 2, 3" fills row by row), rows
// ("1, 2; 3, 4" or one row per line), one value for all, or I (identity).
function arrayCells(text, rows, cols) {
  const t = String(text ?? "").trim().replace(/^\[|\]$/g, "");
  const grid = Array.from({ length: rows }, () => Array(cols).fill(""));
  if (/^I$/i.test(t)) return grid.map((r, i) => r.map((_, j) => (i === j ? "1" : "0")));
  const lines = t.split(/\s*(?:;|\n)\s*/).filter(Boolean).map(l => l.replace(/[[\]]/g, "").split(/\s*,\s*|\s+/).filter(Boolean));
  const flat = lines.flat();
  if (flat.length === 1) return grid.map(r => r.map(() => flat[0]));
  if (lines.length === 1 || cols === 1) flat.forEach((x, k) => { if (k < rows * cols) grid[Math.floor(k / cols)][k % cols] = x; });
  else lines.forEach((l, i) => l.forEach((x, j) => { if (i < rows && j < cols) grid[i][j] = x; }));
  return grid;
}

function arrayEditorHtml(v, allVars) {
  if (!v.shape || v.shape.error || arrayTextMode.has(v.symbol)) return arrayTextToggle(v, allVars);
  const dims = numericDims(v, allVars);
  if (!dims) return "";
  const [rows, cols] = dims.length === 1 ? [dims[0], 1] : dims;
  if (rows * cols > ARRAY_GRID_MAX) return "";
  const cells = arrayCells(v.initVal, rows, cols);
  const head = cols > 1 ? `<span></span>${Array.from({ length: cols }, (_, j) => `<span class="arr-num">${j + 1}</span>`).join("")}` : "";
  const body = cells.map((r, i) => `<span class="arr-num">${i + 1}</span>` + r.map((x, j) =>
    `<input class="arr-cell mono" type="text" value="${escapeHtml(x)}" placeholder="0" aria-label="${escapeHtml(v.symbol)} ${cols > 1 ? `row ${i + 1}, column ${j + 1}` : `element ${i + 1}`}" data-i="${i}" data-j="${j}">`).join("")).join("");
  return `<div class="arr-wrap"><div class="arr" data-sym="${escapeHtml(v.symbol)}" data-rows="${rows}" data-cols="${cols}" style="grid-template-columns: auto repeat(${cols}, 72px)"
            title="${rows}${cols > 1 ? ` x ${cols}` : ""}">${head}${body}</div>
          <button class="link-btn arr-mode" data-arrmode="${escapeHtml(v.symbol)}" title="Type all values in one line instead (e.g. I, or a pasted list)">text</button></div>`;
}

// An array shown as text gets a link back to the grid (when a grid is possible).
function arrayTextToggle(v, allVars) {
  if (!arrayTextMode.has(v.symbol)) return "";
  const safeSym = escapeHtml(v.symbol.replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
  return `<div class="arr-wrap"><input class="cell-input mono value-input" type="text" value="${escapeHtml(v.initVal)}" placeholder="1, 2; 3, 4"
            aria-label="Value of ${escapeHtml(v.symbol)}" onchange="updateVarMeta('${safeSym}', 'initVal', this.value, this)">
          <button class="link-btn arr-mode" data-arrmode="${escapeHtml(v.symbol)}" title="Edit one value per box">grid</button></div>`;
}

// Cell edits write the whole array back as text; "text" / "grid" switch the view.
function bindArrayEditors() {
  document.addEventListener("change", e => {
    const cell = e.target.closest(".arr-cell");
    if (!cell) return;
    const grid = cell.closest(".arr");
    const rows = +grid.dataset.rows, cols = +grid.dataset.cols;
    const vals = Array.from({ length: rows }, () => Array(cols).fill("0"));
    grid.querySelectorAll(".arr-cell").forEach(c => { vals[+c.dataset.i][+c.dataset.j] = c.value.trim() || "0"; });
    const text = cols === 1 ? vals.map(r => r[0]).join(", ") : vals.map(r => r.join(", ")).join("; ");
    updateVarMeta(grid.dataset.sym, "initVal", text, grid);
  });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-arrmode]");
    if (!b) return;
    const sym = b.dataset.arrmode;
    arrayTextMode.has(sym) ? arrayTextMode.delete(sym) : arrayTextMode.add(sym);
    renderVariableTable();
  });
  // Enter / arrow keys move between cells like a spreadsheet
  document.addEventListener("keydown", e => {
    const cell = e.target.closest?.(".arr-cell");
    if (!cell) return;
    const step = { Enter: [1, 0], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
    if (!step) return;
    const grid = cell.closest(".arr");
    const next = grid.querySelector(`.arr-cell[data-i="${+cell.dataset.i + step[0]}"][data-j="${cell.dataset.j}"]`);
    if (next) { e.preventDefault(); next.focus(); next.select(); }
  });
}

// Under the card: the variables of the open equation, the ones to fill first.
// Only Value, Unit (and Size for arrays); the rest is in the Variables tab.
function renderEqVariableTable(allVars = buildVariableRegistry()) {
  const eq = activeEq();
  $("eqVarsPanel").hidden = !eq || !eq.latex.trim();
  if (!eq) return;
  const bySymbol = new Map(allVars.map(v => [v.symbol, v]));
  const vars = [...new Set([...eq.inputs, ...eq.outputs])].map(s => bySymbol.get(s)).filter(Boolean);
  vars.sort((x, y) => needsValue(y) - needsValue(x));
  const ranges = latexSymbols(eq.latex).usesIndices && projectData.indices;
  $("eqVarsIndices").hidden = !ranges;
  if (ranges) $("eqVarsIndices").innerHTML = `Indices <code>${escapeHtml(projectData.indices)}</code> (set in Variables)`;
  const showSize = vars.some(v => v.shape || looksNonScalar(v.symbol));
  $("eqVarHead").innerHTML = `<tr><th>Variable</th><th>Value</th><th>Unit</th>${showSize ? `<th title="Empty = number; 3 = vector; 3 x 3 = matrix">Size</th>` : ""}</tr>`;
  $("eqVarTableBody").innerHTML = vars.length ? vars.map(v => valueRowHtml(v, allVars, showSize)).join("")
    : `<tr><td colspan="4" class="muted small" style="text-align:center; padding:16px">No variables found.</td></tr>`;
}

function valueRowHtml(v, allVars, showSize) {
  const safeSym = escapeHtml(v.symbol.replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
  const ui = ROLE_UI[v.role];
  const valueTitle = v.role === "State Var (y₀)" ? "Initial value" : v.guessFor ? `First guess for ${v.guessFor}` : "Value";
  const value = v.independentOf ? `<span class="computed" title="Its range is in the Settings of ${escapeHtml(v.independentOf)}">from Settings</span>`
    : needsValue(v) ? arrayEditorHtml(v, allVars) || `<input class="cell-input mono value-input" type="text" value="${escapeHtml(v.initVal)}" placeholder="value" title="${escapeHtml(valueTitle)}"
           aria-label="${escapeHtml(valueTitle)} of ${escapeHtml(v.symbol)}" onchange="updateVarMeta('${safeSym}', 'initVal', this.value, this)">`
    : `<span class="computed">computed</span>`;
  return `
    <tr data-sym="${escapeHtml(v.symbol)}" class="${needsValue(v) ? "is-input" : "is-computed"}">
      <td title="${escapeHtml(ui.label + " — " + ui.hint)}" style="white-space:nowrap"><span class="chip ${v.badgeStyle}">${renderMath(displaySymbol(v))}</span><span class="var-issue-cell">${issueMarker(variableIssues(v, allVars))}</span></td>
      <td>${value}</td>
      <td><input class="cell-input mono${unitError(v.units) ? " bad" : ""}" type="text" value="${escapeHtml(v.units)}" placeholder="unit" style="width:110px"
           list="unitSuggestions" spellcheck="false" title="${escapeHtml(unitTitle(v.units))}" aria-label="Unit of ${escapeHtml(v.symbol)}"
           onchange="updateVarMeta('${safeSym}', 'units', this.value, this)"></td>${showSize ? `
      <td>${!(v.shape || looksNonScalar(v.symbol)) ? "" : `<input class="cell-input mono${v.shape && v.shape.error ? " bad" : ""}" type="text" value="${escapeHtml(v.size)}" placeholder="${looksNonScalar(v.symbol) ? "n" : ""}" style="width:70px"
           spellcheck="false" title="Empty = number; 3 = vector; 3 x 3 = matrix"${v.callable ? " disabled" : ""} aria-label="Size of ${escapeHtml(v.symbol)}"
           onchange="updateVarMeta('${safeSym}', 'size', this.value, this)">`}</td>` : ""}
    </tr>`;
}
