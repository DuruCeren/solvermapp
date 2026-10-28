// SolverMapp — The equation card: fields, the Found row, folded sections, unit check, root
// analysis panel, templates, and the Values table under the card.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// EQUATION CARD (middle)
// ================================================================


function renderCard() {
  const eq = activeEq();
  $("noEquation").hidden = !!eq;
  $("card").hidden = !eq;
  if (!eq) return;

  $("cardName").value = eq.name;
  $("cardAuthor").value = eq.author;
  $("cardYear").value = eq.year;
  $("cardEqNumber").value = eq.eqNumber;
  $("cardSource").value = eq.source;
  $("cardLatex").value = eq.typed ?? eq.latex;
  typedError = eq.typed ? typedToLatex(eq.typed).error : null;
  $("cardOutputs").value = eq.outputs.join(", ");
  $("cardInputs").value = eq.inputs.join(", ");
  $("cardLoopMeta").value = eq.loopMeta;
  $("cardAssumptions").value = eq.assumptions;
  $("cardCondition").value = eq.condition || "";
  $("cardUnitCheck").checked = eq.unitCheck;
  growCardFields();
  renderCardDerived(eq);
}

function growCardFields() {
  ["cardSource", "cardLatex", "cardAssumptions"].forEach(id => autoGrow($(id)));
}

// A folded section's text boxes can only be sized once it is open.
function bindCardSections() {
  document.querySelectorAll("#card details.more").forEach(d => d.addEventListener("toggle", growCardFields));
}

// Parts of the card that follow from other fields: preview, detected values, chips and hints.
// Fields the user is typing in are left alone.
function renderCardDerived(eq) {
  const latex = eq.latex.trim();
  $("cardPreview").innerHTML = latex ? renderMath(latex) : `<span class="placeholder">Your equation appears here</span>`;
  const note = $("typedNote");
  note.hidden = !eq.typed && !typedError;
  note.className = "help typed-note" + (typedError ? " edited" : "");
  note.innerHTML = typedError ? `Not readable yet: ${escapeHtml(typedError)}`
    : eq.typed ? `As LaTeX: <code>${escapeHtml(eq.latex)}</code>` : "";
  const position = projectData.equations.indexOf(eq) + 1;
  $("cardIndex").textContent = `#${position}`;
  $("cardPreviewNumber").textContent = `(${position})`;
  $("examplesRow").hidden = !!latex;

  const setIfIdle = (id, value) => { if (document.activeElement !== $(id)) $(id).value = value; };
  setIfIdle("cardOutputs", eq.outputs.join(", "));
  setIfIdle("cardInputs", eq.inputs.join(", "));
  setIfIdle("cardLoopMeta", eq.loopMeta);
  renderTypeBadge(eq);
  $("loopMetaField").hidden = eq.archetype === "explicit" || eq.archetype === "function";
  $("loopMetaHelp").hidden = eq.archetype !== "implicit";
  $("odeHelp").hidden = eq.archetype !== "ode";
  const parts = eq.archetype === "ode" ? firstOrderOdes(eq) : [];
  $("ode2Help").hidden = parts.length !== 2;
  if (parts.length === 2) {
    const [x, v] = parts.map(p => p.outputs[0]);
    $("ode2Help").innerHTML = `Second order: integrated as ${renderMath(x)} and its rate ${renderMath(v)}, with ${renderMath(parts[0].latex)}. ` +
      `Give both start values: the Values of ${renderMath(x)} and ${renderMath(v)}.`;
  }
  const hint = latex ? derivativeHint(eq) : "";
  $("derivNote").hidden = !hint;
  $("derivNote").innerHTML = hint;
  renderConditionHelp(eq);
  $("cardLoopMeta").placeholder = LOOP_META_DEFAULTS[eq.archetype] || "";
  scheduleRootPanel(eq);

  const roleOf = Object.fromEntries(buildVariableRegistry().map(v => [v.symbol, v.role]));
  $("cardOutputChips").innerHTML = eq.outputs.map(s => roleChip(s, roleOf[s] || "Final Output")).join("");
  $("cardInputChips").innerHTML = eq.inputs.map(s => roleChip(s, roleOf[s] || "Global Input")).join("");

  const help = $("ioHelp");
  if (eq.ioAuto || !latex) {
    help.className = "help";
    help.textContent = "Found automatically. Edit only if wrong.";
  } else {
    help.className = "help edited";
    help.innerHTML = `Edited by hand. <button class="link-btn" onclick="redetect()">Find again</button>`;
  }
  $("cardFoundRow").hidden = !latex;
  renderUnitCheck(eq);
  renderCardSections(eq);
}

// The folded sections of the card show their current value next to their name.
function renderCardSections(eq) {
  const cut = (t, n = 60) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  $("sumSettings").textContent = cut(eq.loopMeta.trim() || "default");
  const cond = conditionText(eq);
  $("sumCondition").innerHTML = cond ? renderMath(cond) : String(eq.condition || "").trim() ? "otherwise" : "always";
  const num = cleanEqNumber(eq);
  const source = [articleFlag(eq), num && `Eq. ${num}`].filter(Boolean).join(", ") || eq.source.trim();
  $("sumSource").textContent = cut(source || "–");
  $("sumIO").textContent = eq.ioAuto ? "auto" : "edited";
  $("sumNotes").textContent = cut(eq.assumptions.trim() || "–");
}

// The type is read from how the equation is written, so the card only shows it (with how it is solved).
const TYPE_NOTATION_HELP = [
  "The type follows from how the equation is written:",
  "= Explicit: y = …",
  "↻ Marching loop: y_{n+1} = … y_n …",
  "◎ Convergence loop: y_{new} = … y_{old} …",
  "Σ Summation: S = \\sum_{i=1}^{N} …",
  "∫ Integral: I = \\int_a^b … dx",
  "⊘ Implicit: the unknown is not alone on the left (x = \\cos x, P V = n R T, \\mathbf{K}\\mathbf{u} = \\mathbf{F})",
  "ẏ ODE: \\frac{dy}{dt} = …",
  "ẏ ODE, 2nd order: \\frac{d^2x}{dt^2} = … or m \\ddot{x} = … (rate: \\dot{x})",
  "ƒ Function: \\mu(T) = …"
].join("\n");

function renderTypeBadge(eq) {
  const ab = ARCHETYPE_BADGES[eq.archetype || "explicit"];
  let how = "";
  try {
    how = eq.archetype === "implicit" ? (eq.outputs.length && equationPlan(eq).linear ? "linear solve" : "Newton–Raphson")
      : eq.archetype === "ode" ? (odeOrder(eq) === 2 ? "2nd order · " : "") + (ODE_METHODS[(loopSettings(eq).method || "rk4").trim().toLowerCase()]?.short || "")
      : eq.archetype === "explicit" && /\\sum/.test(eq.latex) && latexSymbols(eq.latex).usesIndices ? "index sum"
      : eq.archetype === "integral" ? "trapezoidal rule"
      : eq.archetype === "convergence" ? "until converged"
      : eq.archetype === "function" ? "exported as a function" : "";
  } catch (e) { /* incomplete equation: no method yet */ }
  $("cardTypeBadge").innerHTML = `<span class="type-sym">${ab.symbol}</span>${ab.label}${how ? `<span class="type-how">· ${escapeHtml(how)}</span>` : ""}`;
  $("cardTypeBadge").title = how === "index sum"
    ? "The sum runs over a declared index (Variables › Indices), so it is part of this explicit expression. A sum over a letter that is not declared is a Σ Summation loop.\n\n" + TYPE_NOTATION_HELP
    : TYPE_NOTATION_HELP;
  $("cardTypeBadge").setAttribute("aria-label", `Equation type: ${ab.label}${how ? `, ${how}` : ""} (found from the equation)`);
}

// Under "Applies when": the cases of the switch this equation belongs to.
function renderConditionHelp(eq) {
  const help = $("conditionHelp");
  const out = eq.outputs[0];
  const cases = out ? projectData.equations.filter(e => isComplete(e) && e.outputs[0] === out) : [];
  if (!conditionText(eq) && !(cases.length > 1 && cases.some(conditionText))) {
    help.className = "help";
    help.innerHTML = `Empty = always. Same output with conditions = a switch (one may be <code>otherwise</code>).`;
    return;
  }
  const ordered = [...cases.filter(conditionText), ...cases.filter(e => !conditionText(e))];
  let code = "";
  try { code = conditionText(eq) ? langCode(conditionToCode(eq.condition), "python") : ""; } catch (e) { code = ""; }
  help.className = "help";
  help.innerHTML = `Switch for ${renderMath(out)}: ` + ordered.map(e =>
    `${e === eq ? "<strong>" : ""}${escapeHtml(e.name || "Untitled")} (${conditionText(e) ? renderMath(conditionText(e)) : "otherwise"})${e === eq ? "</strong>" : ""}`).join(" · ") +
    (ordered.some(e => !conditionText(e)) ? "" : ` · <span class="edited">no “otherwise” case: the start value is kept when no condition holds</span>`) +
    (code ? `<br>In code: <code>if ${escapeHtml(code)}</code>` : "");
}

// Unit check panel under the preview.
function renderUnitCheck(eq) {
  const panel = $("unitCheckPanel");
  $("cardUnitBadge").innerHTML = eq ? unitCheckBadge(eq) : "";
  if (!eq || !eq.unitCheck || !eq.latex.trim()) {
    panel.hidden = true;
    return;
  }
  const result = unitCheckResult(eq);
  panel.hidden = result.state === "ok"; // consistent: the ✓ in the Found row is enough
  panel.className = "unit-check unit-check-" + result.state;

  let html = `<div class="unit-check-title">${CHECK_TITLES[result.state]}</div>`;
  const known = result.sides.filter(s => s.unit);
  if (result.state === "ok" && known.length) {
    html += `<div>${result.sides.length > 1 ? "Both sides: " : "Unit: "}<span class="mono">${escapeHtml(known[0].unit)}</span></div>`;
  }
  if (result.unsupported) html += `<div>${escapeHtml(result.unsupported)}</div>`;

  result.issues.forEach(issue => {
    html += `<div class="unit-issue">
        <div class="unit-issue-msg">${escapeHtml(issue.message)}</div>
        ${issue.terms.map(t => `<div class="unit-term">${renderMath(t.latex)}<span class="unit-term-arrow" aria-hidden="true">→</span><span class="mono">${escapeHtml(t.unit)}</span></div>`).join("")}
      </div>`;
  });

  [["Add a unit for", result.missing], ["Invalid unit for", result.invalid], ["Not a variable yet", result.untracked]].forEach(([label, list]) => {
    if (!list.length) return;
    const missing = list === result.missing;
    html += `<div class="unit-list"><span class="unit-list-label">${label}:</span>${list.map(s => `
        <span class="unit-list-item">${renderMath(s)}${missing
          ? `<button class="unit-list-action" data-dimless="${escapeHtml(s)}" title="This quantity has no unit: set it to 1">dimensionless</button>` : ""}</span>`).join("")}
      </div>`;
  });
  if (result.missing.length) {
    html += `<div>Type the unit under Values, or mark pure numbers as dimensionless.</div>`;
  }
  if (result.untracked.length) {
    html += `<div>Add them under “Outputs and inputs”.</div>`;
  }
  panel.innerHTML = html;
}

// Root analysis panel of an implicit equation (under the loop settings). Rendered shortly after
// the last edit, since it runs the model and many Newton iterations.
let rootTimer = null;

function scheduleRootPanel(eq) {
  clearTimeout(rootTimer);
  if (!eq || eq.archetype !== "implicit" || !isComplete(eq)) {
    $("rootPanel").hidden = true;
    rootAnalysis = null;
    return;
  }
  rootTimer = setTimeout(() => renderRootPanel(activeEq()), 150);
}

function renderRootPanel(eq) {
  const panel = $("rootPanel");
  if (!eq || eq.archetype !== "implicit" || !isComplete(eq)) return;
  const a = analyzeRoots(eq);
  rootAnalysis = a;
  panel.hidden = false;
  panel.className = "unit-check root-check unit-check-" + a.state;
  const title = a.vector ? (a.state === "ok" ? "Solved" : "Not solved")
    : !a.R ? "Can't evaluate" : { ok: "Root found", warn: "Check the branch", error: "No root from this guess" }[a.state];
  const unit = projectData.variableMeta[eq.outputs[0]]?.units || "";
  let html = `<div class="unit-check-title">${title}</div><div>${escapeHtml(a.message)}</div>`;
  if (a.vector && a.value) html += `<div>${renderMath(eq.outputs[0])} = <span class="mono">${escapeHtml(formatValue(a.value))}</span>${unit ? ` <span class="muted">${escapeHtml(unit)}</span>` : ""}</div>`;
  if (a.R) {
    html += rootPlotSvg(a) + `<div id="rootTip" class="root-tip">Hover the plot: the residual, and the root Newton reaches from that starting point.</div>`;
    if (a.roots.length) {
      const branchCount = a.roots.filter(r => r.inBranch).length;
      html += `<div class="root-list">${a.roots.map((r, k) => {
        const current = a.root === r;
        const info = [`reached from ${Math.round(r.share * 100)} % of the plotted guesses`, !r.inBranch && "outside the branch", current && "<strong>your guess</strong>"].filter(Boolean).join(" · ");
        const pick = !(current && branchCount === 1);
        return `<div class="root-row${current ? " is-current" : ""}">
            <span class="root-badge rc-${Math.min(r.n, 5)}" aria-label="Root ${r.n}">${r.n}</span>
            <span>${renderMath(eq.outputs[0])} = <span class="mono">${fmtNum(r.x)}</span>${unit ? ` <span class="muted">${escapeHtml(unit)}</span>` : ""}</span>
            <span class="muted">${info}</span>
            ${pick ? `<button class="unit-list-action" data-branch="${k}" title="Set the guess to this root and min / max between it and its neighbours">Use this root</button>` : ""}
          </div>`;
      }).join("")}</div>`;
    } else {
      html += `<div>No sign change of the residual was found between ±10<sup>12</sup>.</div>`;
    }
    const used = eq.inputs.map(s => {
      const v = a.sim.scope[codeOf(s)];
      const text = formatValue(v);
      return `<span class="unit-list-item">${renderMath(s)} = <span class="mono">${escapeHtml(text)}</span>${a.sim.computed.has(codeOf(s)) ? ` <span class="muted">(computed)</span>` : ""}</span>`;
    });
    if (used.length) html += `<div class="unit-list"><span class="unit-list-label">Evaluated with:</span>${used.join("")}</div>`;
  }
  a.notes.forEach(n => { html += `<div class="muted">${escapeHtml(n)}</div>`; });
  panel.innerHTML = html;
}

// Rewrites some keys of the loop settings ("guess = 1, min = b"); null removes a key.
function setLoopSettings(eq, updates) {
  const keys = Object.keys(updates);
  const parts = (eq.loopMeta || "").split(/[,;]/).map(t => t.trim()).filter(Boolean)
    .filter(part => !keys.includes((/^([A-Za-z_]\w*)\s*=/.exec(part) || [])[1]?.toLowerCase()));
  keys.forEach(k => { if (updates[k] !== null) parts.push(`${k} = ${updates[k]}`); });
  eq.loopMeta = parts.join(", ");
}

// Branch selection: the guess goes to the chosen root and min / max to halfway to its
// neighbours. A limit written as an expression (min = b) is kept as a physical limit.
function useRootBranch(k) {
  const eq = activeEq();
  const a = rootAnalysis;
  if (!a || a.eq !== eq || !a.roots[k]) return;
  const s = loopSettings(eq);
  const roots = a.roots.map(r => r.x);
  const limit = (key, neighbour) => (neighbour !== undefined ? fmtNum(0.5 * (roots[k] + neighbour))
    : s[key] && !isNumber(s[key]) ? s[key].trim() : null);
  setLoopSettings(eq, { guess: fmtNum(roots[k]), min: limit("min", roots[k - 1]), max: limit("max", roots[k + 1]) });
  ["lower", "upper", "x0", "initial"].forEach(key => { if (s[key] !== undefined) setLoopSettings(eq, { [key]: null }); });
  eq.typeAuto = false;
  $("cardLoopMeta").value = eq.loopMeta;
  afterCardEdit(eq, false);
}

function bindRootPanelEvents() {
  const panel = $("rootPanel");
  panel.addEventListener("click", e => {
    const btn = e.target.closest("[data-branch]");
    if (btn) useRootBranch(+btn.dataset.branch);
  });
  panel.addEventListener("mousemove", e => {
    const a = rootAnalysis;
    const svg = e.target.closest(".root-plot");
    if (!a || !a.plot || !svg) return;
    const box = svg.getBoundingClientRect();
    const vx = (e.clientX - box.left) / box.width * a.plot.W;
    const x = a.plot.lo + (vx - 8) / (a.plot.W - 16) * (a.plot.hi - a.plot.lo);
    const cross = svg.querySelector(".rp-cross");
    cross.setAttribute("x1", vx);
    cross.setAttribute("x2", vx);
    cross.setAttribute("visibility", "visible");
    const s = newtonSolve(a.R, x, a.settings);
    const root = s.ok ? a.rootOf(s.x) : null;
    $("rootTip").textContent = `${a.p.out} = ${fmtNum(x)} · residual ${fmtNum(a.R(x))} · Newton from here: ` +
      (root ? `root ${root.n} (${fmtNum(s.x)}) in ${s.it} iterations` : s.ok ? `${fmtNum(s.x)}` : `no root (${s.why})`);
  });
  panel.addEventListener("mouseleave", () => {
    const cross = panel.querySelector(".rp-cross");
    if (cross) cross.setAttribute("visibility", "hidden");
    if ($("rootTip")) $("rootTip").textContent = "Hover the plot: the residual, and the root Newton reaches from that starting point.";
  });
}

function ensureVarMeta(symbol) {
  if (!projectData.variableMeta[symbol]) projectData.variableMeta[symbol] = { initVal: "1.0", units: "", desc: "" };
  return projectData.variableMeta[symbol];
}

// A unit changed somewhere: refresh everything that shows a unit check result.
function afterUnitChange() {
  triggerAutoSave();
  renderSidebar();
  renderUnitCheck(activeEq());
}

// The type always follows the notation. typeAuto now only says whether the loop settings are
// still the detected defaults (false once edited). Settings typed for one type are remembered,
// so a type that changes for a moment while the equation is being edited comes back with them.
const loopMetaStash = new Map(); // "id:type" -> loop settings

function applyDetection(eq) {
  const d = detectFromLatex(eq.latex.trim());
  syncType(eq, d);
  if (eq.typeAuto) eq.loopMeta = d.loopMeta;
  if (eq.ioAuto) { eq.outputs = d.outputs; eq.inputs = d.inputs; }
  if (d.archetype === "ode" && d.order === 2 && eq.ioAuto) prefillRateMeta(d.outputs[0], d.outputs[1], odeVariables(eq).independent);
}

function syncType(eq, d = detectFromLatex(eq.latex.trim())) {
  if (d.archetype === eq.archetype) return;
  if (!eq.typeAuto) loopMetaStash.set(`${eq.id}:${eq.archetype}`, eq.loopMeta);
  const kept = loopMetaStash.get(`${eq.id}:${d.archetype}`);
  eq.archetype = d.archetype;
  eq.typeAuto = kept === undefined;
  eq.loopMeta = kept ?? d.loopMeta;
}

function redetect() {
  const eq = activeEq();
  if (!eq) return;
  eq.ioAuto = true;
  eq.typeAuto = true;
  applyDetection(eq);
  afterCardEdit(eq, true);
}

function parseList(str) {
  return [...new Set(str.split(",").map(s => s.trim()).filter(Boolean))];
}

// Called after any edit on the card. `structural` = the change can affect variables or roles.
function afterCardEdit(eq, structural) {
  triggerAutoSave();
  updateSidebarItem(eq);
  renderCardDerived(eq);
  if (structural) renderVariableTable();
}

function bindCardEvents() {
  const simple = { cardName: "name", cardAuthor: "author", cardYear: "year", cardEqNumber: "eqNumber", cardSource: "source", cardAssumptions: "assumptions" };
  Object.entries(simple).forEach(([id, field]) => {
    $(id).addEventListener("input", e => {
      const eq = activeEq();
      if (!eq) return;
      eq[field] = e.target.value;
      if (e.target.tagName === "TEXTAREA") autoGrow(e.target);
      afterCardEdit(eq, field === "name");
    });
  });

  $("cardLatex").addEventListener("input", e => {
    const eq = activeEq();
    if (!eq) return;
    setTypedEquation(eq, e.target.value);
    autoGrow(e.target);
    applyDetection(eq);
    afterCardEdit(eq, true);
  });

  ["cardOutputs", "cardInputs"].forEach(id => {
    $(id).addEventListener("input", e => {
      const eq = activeEq();
      if (!eq) return;
      eq[id === "cardOutputs" ? "outputs" : "inputs"] = parseList(e.target.value);
      eq.ioAuto = false;
      afterCardEdit(eq, true);
    });
    $(id).addEventListener("blur", () => { const eq = activeEq(); if (eq) renderCardDerived(eq); });
  });

  $("cardLoopMeta").addEventListener("input", e => {
    const eq = activeEq();
    if (!eq) return;
    eq.loopMeta = e.target.value;
    eq.typeAuto = false;
    afterCardEdit(eq, false);
  });

  $("cardCondition").addEventListener("input", e => {
    const eq = activeEq();
    if (!eq) return;
    eq.condition = e.target.value;
    afterCardEdit(eq, true);
  });

  $("cardUnitCheck").addEventListener("change", e => {
    const eq = activeEq();
    if (!eq) return;
    eq.unitCheck = e.target.checked;
    afterCardEdit(eq, false);
  });

  $("unitCheckPanel").addEventListener("click", e => {
    const btn = e.target.closest("[data-dimless]");
    if (!btn) return;
    ensureVarMeta(btn.dataset.dimless).units = "1";
    renderVariableTable();
    afterUnitChange();
  });
}

// Plain math is kept as typed (eq.typed) next to its LaTeX; LaTeX input needs no copy.
function setTypedEquation(eq, text) {
  const r = typedToLatex(text);
  eq.latex = r.latex;
  if (PlainMath.isPlain(text) && r.latex !== text.trim()) eq.typed = text;
  else delete eq.typed;
  typedError = r.error;
}
let typedError = null; // why the plain math could not be read (shown under the box)

// EXAMPLE TEMPLATES (fill the current, empty card)
const TEMPLATES = {
  marching:    { name: "Discrete step update",  source: "Recurrence relation",     latex: "y_{n+1} = y_n + 1", assumptions: "Initial condition y_0 = 1" },
  convergence: { name: "Iterative root update", source: "Picard iteration",        latex: "y_{new} = 0.5 \\left( y_{old} + \\frac{2}{y_{old}} \\right)", assumptions: "Iterates until |y_new - y_old| < tol" },
  summation:   { name: "Series summation",      source: "Discrete reduction",      latex: "S = \\sum_{i=1}^{N} x_i", assumptions: "Dummy index i is local to the sum" },
  integral:    { name: "Spatial quadrature",    source: "Trapezoidal integration", latex: "I = \\int_{a}^{b} P \\, dx", assumptions: "Integrates P over x from a to b" },
  implicit:    {
    name: "Colebrook friction factor", source: "Colebrook, C. F. (1939). Turbulent flow in pipes. J. Inst. Civil Engineers, 11, 133–156.",
    latex: "\\frac{1}{\\sqrt{f}} = -2 \\log_{10}\\left(\\frac{k_s}{3.7 D} + \\frac{2.51}{R_e \\sqrt{f}}\\right)",
    assumptions: "Turbulent flow; f is found by Newton–Raphson on left side − right side = 0",
    loopMeta: "method = newton, tol = 1e-10, max_iter = 50, min = 1e-4",
    vars: {
      "f":   { initVal: "0.02",   units: "1", desc: "Darcy friction factor (start = initial guess)" },
      "k_s": { initVal: "4.5e-5", units: "m", desc: "Pipe wall roughness" },
      "D":   { initVal: "0.1",    units: "m", desc: "Pipe diameter" },
      "R_e": { initVal: "1e5",    units: "1", desc: "Reynolds number" }
    }
  },
  ode: {
    name: "Newton cooling", source: "Lumped-capacitance model",
    latex: "\\frac{dT}{dt} = -\\frac{h A}{m c_p}\\left(T - T_\\infty\\right)",
    assumptions: "Uniform temperature in the body (Biot number < 0.1)",
    loopMeta: "t = 0..600, steps = 100, method = rk4",
    vars: {
      "T":        { initVal: "373",  units: "K",         desc: "Body temperature (start = initial value)" },
      "h":        { initVal: "10",   units: "W/(m^2·K)", desc: "Heat transfer coefficient" },
      "A":        { initVal: "0.01", units: "m^2",       desc: "Surface area" },
      "m":        { initVal: "0.1",  units: "kg",        desc: "Mass" },
      "c_p":      { initVal: "900",  units: "J/(kg·K)",  desc: "Specific heat" },
      "T_\\infty": { initVal: "293", units: "K",         desc: "Ambient temperature" },
      "t":        { initVal: "0",    units: "s",         desc: "Time" }
    }
  },
  ode2: {
    name: "Damped spring", source: "Newton's second law",
    latex: "m \\frac{d^2x}{dt^2} = -k x - c \\frac{dx}{dt}",
    assumptions: "Linear spring and viscous damping",
    loopMeta: "t = 0..10, steps = 500, method = rk4",
    vars: {
      "m":        { initVal: "1",   units: "kg",    desc: "Mass" },
      "k":        { initVal: "10",  units: "N/m",   desc: "Spring stiffness" },
      "c":        { initVal: "0.5", units: "N s/m", desc: "Damping coefficient" },
      "x":        { initVal: "0.1", units: "m",     desc: "Displacement (start = initial displacement)" },
      "\\dot{x}": { initVal: "0",   units: "m/s",   desc: "Velocity (start = initial velocity)" },
      "t":        { initVal: "0",   units: "s",     desc: "Time" }
    }
  },
  function: {
    name: "Viscosity law", source: "Andrade equation",
    latex: "\\mu(T) = \\mu_0 \\exp\\left(\\frac{B}{T} - \\frac{B}{T_0}\\right)",
    assumptions: "Liquid viscosity as a function of temperature; use \\mu or \\mu(T) in other equations",
    vars: {
      "\\mu_0": { initVal: "1e-3", units: "Pa·s", desc: "Viscosity at T_0" },
      "B":      { initVal: "1800", units: "K",    desc: "Viscosity constant" },
      "T_0":    { initVal: "293",  units: "K",    desc: "Reference temperature" }
    }
  },
  matrix: {
    name: "Stiffness system", source: "Linear elasticity, discretised",
    latex: "\\mathbf{K}\\mathbf{u} = \\mathbf{F}",
    assumptions: "Linear in u: solved directly (no iteration)",
    vars: {
      "\\mathbf{K}": { initVal: "4, -1; -1, 3", units: "N/m", desc: "Stiffness matrix", size: "2x2" },
      "\\mathbf{F}": { initVal: "1, 2",         units: "N",   desc: "Load vector",      size: "2" },
      "\\mathbf{u}": { initVal: "0",            units: "m",   desc: "Displacements",    size: "2" }
    }
  }
};

// "Try:" chips on the card. Named exactly like the type badge the example produces, so the
// words learned here are the words shown in the list, the graph and the Guide.
const TEMPLATE_CHIPS = [
  ["marching", "marching"], ["convergence", "convergence"], ["summation", "summation"], ["integral", "integral"],
  ["implicit", "implicit", "Newton–Raphson"], ["matrix", "implicit", "linear solve"], ["ode", "ode"], ["ode2", "ode", "2nd order"], ["function", "function"]
];

function renderExampleChips() {
  $("examplesRow").innerHTML = `<span>Try:</span>` + TEMPLATE_CHIPS.map(([key, arch, how]) => {
    const ab = ARCHETYPE_BADGES[arch];
    const t = TEMPLATES[key];
    return `<button class="chip-btn" onclick="fillTemplate('${key}')" title="Example: ${escapeHtml(t.name)}">` +
      `<span class="type-sym" aria-hidden="true">${ab.symbol}</span> ${ab.label}${how ? `<span class="type-how"> · ${how}</span>` : ""}</button>`;
  }).join("");
}

function fillTemplate(type) {
  const eq = activeEq();
  if (!eq) return;
  let t = TEMPLATES[type];
  // In a project with declared indices, \sum_i over a declared letter is index notation (explicit),
  // so the Summation example uses a letter that is not declared and stays a summation loop.
  if (type === "summation" && indexRanges().has("i")) {
    const k = ["k", "l", "p", "q", "r", "s"].find(c => !indexRanges().has(c));
    if (k) t = { ...t, latex: `S = \\sum_{${k}=1}^{N} x_${k}`, assumptions: `Dummy index ${k} is local to the sum` };
  }
  if (!eq.name) eq.name = t.name;
  if (!eq.source) eq.source = t.source;
  if (!eq.assumptions) eq.assumptions = t.assumptions;
  Object.entries(t.vars || {}).forEach(([s, m]) => { if (!projectData.variableMeta[s]) projectData.variableMeta[s] = { ...m }; });
  eq.latex = t.latex;
  delete eq.typed;
  eq.ioAuto = true;
  eq.typeAuto = true;
  applyDetection(eq);
  if (t.loopMeta) eq.loopMeta = t.loopMeta;
  renderCard();
  afterCardEdit(eq, true);
}
