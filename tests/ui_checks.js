// Interaction checks for test_ui.py, run inside the real app in headless Chrome.
// The two placeholders (TOUR and NBODY, in double underscores) are replaced by
// examples/equation_types_tour.json and examples/n_body_index_notation.json. Each check: L(name, passed, info shown on failure).
window.__log = [];
const L = (name, ok, info) => __log.push([name, !!ok, info === undefined ? "" : String(info)]);
const names = () => projectData.equations.map(e => e.name.replace(/ .*/, "")).join(",");
const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o }));
const paste = text => { const dt = new DataTransfer(); dt.setData("text/plain", text); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); };
const item = i => document.querySelectorAll("#equationList li[data-id]")[i];
const click = (i, o = {}) => item(i).querySelector(".eq-item").dispatchEvent(new MouseEvent("click", { bubbles: true, ...o }));
try {
  // Start-up, before any check changes the page: the demo is loaded and drawn (fresh browser profile)
  L("start-up draws the demo", document.querySelectorAll("#equationList li[data-id]").length === defaultData.equations.length
    && $("eqCountBadge").textContent === String(defaultData.equations.length) && !$("viewGuide").hidden,
    document.querySelectorAll("#equationList li[data-id]").length + " items, badge " + $("eqCountBadge").textContent);
  projectData = normalizeProject(__TOUR__);
  activeId = projectData.equations[0].id; selectedIds = new Set([activeId]);
  refreshAll();
  L("opens on Guide", !$("viewGuide").hidden && $("viewVault").hidden && $("tabBtnGuide").classList.contains("active"));
  L("guide math rendered", document.querySelectorAll("#viewGuide .katex").length > 30 && !document.querySelector("#viewGuide .katex-error"), document.querySelectorAll("#viewGuide .katex").length);
  // The list is hidden and the welcome card is centred on the whole page (with the list showing it
  // would sit ~136 px right of centre). Measured against the page width, so scrollbar width
  // (Windows: 15 px, Linux CI: 0) does not matter.
  { const card = document.querySelector(".guide-start").getBoundingClientRect();
    const offCentre = card.left - (document.documentElement.clientWidth - card.width) / 2;
    L("no list on Guide", document.querySelector(".sidebar").getBoundingClientRect().width === 0 && Math.abs(offCentre) < 2, `card ${card.left}px from the left, ${offCentre}px off centre`); }
  switchTab("vault");
  L("list back on Equations", document.querySelector(".sidebar").getBoundingClientRect().width > 200);
  const tb = $("sideToggleBtn").getBoundingClientRect(), tt = document.querySelector(".sidebar .section-title").getBoundingClientRect();
  L("hamburger left of title", tb.right <= tt.left + 1 && Math.abs((tb.top + tb.bottom) / 2 - (tt.top + tt.bottom) / 2) < 6, tb.right + " " + tt.left);
  switchTab("vault");
  L("start order", names() === "State,Total,Boundary,Non-linear,Van", names());
  L("list numbers #1..#5", [...document.querySelectorAll(".eq-item-index")].map(e => e.textContent).join(" ") === "#1 #2 #3 #4 #5");
  L("card shows #1", $("cardIndex").textContent === "#1" && $("cardPreviewNumber").textContent === "(1)");
  L("type badge, no select", !$("cardArchetype") && /Marching loop/.test($("cardTypeBadge").textContent), $("cardTypeBadge").textContent);
  L("article eq in Source summary", (switchTab("vault"), selectEquation(projectData.equations[4].id), /Eq\. 5/.test($("sumSource").textContent)), $("sumSource").textContent); selectEquation(projectData.equations[0].id);

  // Alt+Down moves the open equation; numbering follows
  document.body.focus(); key("ArrowDown", { altKey: true });
  L("Alt+Down", names() === "Total,State,Boundary,Non-linear,Van" && $("cardIndex").textContent === "#2", names());
  key("ArrowUp", { altKey: true });
  L("Alt+Up", names() === "State,Total,Boundary,Non-linear,Van", names());

  // Ctrl+C / Ctrl+V: paste after the selection, with variable details
  click(4); key("c", { ctrlKey: true });
  L("Ctrl+C fills clipboard", JSON.parse(eqClipboard).equations.length === 1);
  click(1); paste(eqClipboard);
  L("Ctrl+V after #2", names() === "State,Total,Van,Boundary,Non-linear,Van" && $("cardIndex").textContent === "#3", names());
  L("pasted keeps type", projectData.equations[2].archetype === "implicit" && /min = b/.test(projectData.equations[2].loopMeta), projectData.equations[2].loopMeta);
  undo();
  L("undo paste", names() === "State,Total,Boundary,Non-linear,Van", names());

  // Shift+click range, Ctrl+X, paste at end
  click(0); click(2, { shiftKey: true });
  L("shift range selects 3", selectedEquations().length === 3 && document.querySelectorAll(".eq-item.selected").length === 3);
  key("x", { ctrlKey: true });
  L("Ctrl+X removes 3", names() === "Non-linear,Van", names());
  click(1); paste(eqClipboard);
  L("paste 3 at end", names() === "Non-linear,Van,State,Total,Boundary", names());
  // Ctrl+click toggling and Delete
  click(0); click(1, { ctrlKey: true });
  L("ctrl+click adds", selectedEquations().length === 2);
  click(1, { ctrlKey: true });
  L("ctrl+click removes", selectedEquations().length === 1);
  key("Delete");
  L("Delete", names() === "Van,State,Total,Boundary", names());
  undo();
  L("undo delete", names() === "Non-linear,Van,State,Total,Boundary", names());

  // Ctrl+D duplicate
  click(1); key("d", { ctrlKey: true });
  L("Ctrl+D", names() === "Non-linear,Van,Van,State,Total,Boundary" && /\(copy\)$/.test(projectData.equations[2].name), names());
  undo === undo; projectData.equations.splice(2, 1); refreshAll();

  // Plain LaTeX paste creates equations, typed by detection
  click(4); paste("P V = n R T\n\\frac{dx}{dt} = -k x");
  const p1 = projectData.equations[5], p2 = projectData.equations[6];
  L("LaTeX paste -> 2 eqs", p1 && p2 && p1.archetype === "implicit" && p2.archetype === "ode", [p1?.archetype, p2?.archetype, names()].join(" "));
  undo();

  // Shortcuts are off while typing in a field
  $("cardName").focus(); key("Delete");
  L("no delete while editing", projectData.equations.length === 5);
  $("cardName").blur();

  // Drag and drop: move #1 to the end; Ctrl-drop copies
  const drag = (from, to, o = {}) => {
    const dt = new DataTransfer();
    item(from).dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    const r = item(to).getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: r.bottom - 2, ...o };
    $("equationList").dispatchEvent(new DragEvent("dragover", at));
    const marked = !!document.querySelector(".drop-after, .drop-before");
    $("equationList").dispatchEvent(new DragEvent("drop", at));
    item(0)?.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    return marked;
  };
  const before = names();
  const marked = drag(0, 4);
  L("drag #1 to end", names() === "Van,State,Total,Boundary,Non-linear" && marked, before + " -> " + names());
  drag(0, 1, { ctrlKey: true });
  L("ctrl-drag copies", names() === "Van,State,Van,Total,Boundary,Non-linear", names());
  undo();

  // Context menu
  item(2).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 200 }));
  const menu = document.querySelector(".ctx-menu");
  L("context menu", menu && /Move up/.test(menu.textContent) && /Paste below/.test(menu.textContent), menu && [...menu.querySelectorAll("button")].map(b => b.textContent.replace(/\s+/g, " ")).join(" | "));
  [...menu.querySelectorAll("button")].find(b => /Move to top/.test(b.textContent)).click();
  L("menu: move to top", names() === "Total,Van,State,Boundary,Non-linear" && !document.querySelector(".ctx-menu"), names());

  // Arrow keys in the list open the next equation
  focusActiveItem(); key("ArrowDown");
  L("ArrowDown opens next", activeEq().name.startsWith("Van") && document.activeElement.closest("#equationList"), activeEq().name);

  // Sidebar collapse and Ctrl+B
  toggleSidebar();
  const w1 = document.querySelector(".sidebar").getBoundingClientRect().width;
  key("b", { ctrlKey: true });
  const w2 = document.querySelector(".sidebar").getBoundingClientRect().width;
  L("collapse/expand", w1 < 70 && w2 > 200, w1 + " / " + w2);

  // Type follows the notation; settings remembered across a flip
  const eq = activeEq();
  eq.loopMeta = "method = newton, guess = 0.03, min = b"; eq.typeAuto = false;
  const latex = eq.latex;
  eq.latex = "v = 1"; applyDetection(eq);
  const flipped = eq.archetype;
  eq.latex = latex; applyDetection(eq);
  L("type flip keeps settings", flipped === "explicit" && eq.archetype === "implicit" && eq.loopMeta === "method = newton, guess = 0.03, min = b", flipped + " " + eq.loopMeta);

  // Tabs: order and views
  const navText = () => [...document.querySelectorAll(".tabs .tab")].filter(b => b.offsetParent).map(b => b.textContent.replace(/\s+/g, "")).join(",");
  switchTab("guide");
  L("tab order", navText() === "Guide,1Equations,2Variables,3Plan,4Flowchart,5Code,6Report", navText());
  switchTab("vars");
  L("variables tab", !$("viewVars").hidden && document.querySelectorAll("#variableTableBody tr[data-sym]").length > 10 && document.querySelectorAll("#variableTableBody .eq-link").length > 0, document.querySelectorAll("#variableTableBody tr[data-sym]").length);
  switchTab("arch");
  const g = document.querySelector(".grid-arch").children;
  const r1 = g[0].getBoundingClientRect(), r2 = g[1].getBoundingClientRect();
  L("graph | order side by side", Math.abs(r1.top - r2.top) < 2 && r2.left > r1.right, `${r1.left},${r1.width} | ${r2.left},${r2.width}`);
  switchTab("vault");
  L("card variables", document.querySelectorAll("#eqVarTableBody tr[data-sym]").length === activeEq().inputs.length + activeEq().outputs.length, document.querySelectorAll("#eqVarTableBody tr[data-sym]").length);
  resetProject();
  L("reset -> one empty card", projectData.equations.length === 1 && !projectData.equations[0].latex && !Object.keys(projectData.variableMeta).length && !$("viewVault").hidden, projectData.equations.length);
  undo();
  L("undo reset", projectData.equations.length === 5);
  resetToDemo();
  L("demo = N-body (N = 3), on Equations", projectData.equations.length === 3 && projectData.indices === "i, j = 1..N" && projectData.variableMeta.N.initVal === "3" && /three-body/i.test(projectData.equations[0].source + projectData.equations[0].name + JSON.stringify(projectData.equations)) && activeTab === "vault", projectData.equations.map(e => e.name).join(","));
  L("demo card boxes sized", ["cardSource", "cardLatex"].every(id => $(id).getBoundingClientRect().height > 30));
  L("logo svg", document.querySelectorAll(".brand-mark svg circle").length === 5 && !!document.querySelector("link[rel=icon]"));
  // Simplified card: folded sections, Found row, Values table
  projectData = normalizeProject(__TOUR__); refreshAll();
  selectEquation(projectData.equations.find(e => e.archetype === "implicit").id);
  L("sections folded", [...document.querySelectorAll("#card details.more")].every(d => !d.open) && !$("loopMetaField").hidden && /newton/.test($("sumSettings").textContent), $("sumSettings").textContent);
  L("found row", $("cardOutputChips").children.length === 1 && $("cardInputChips").children.length > 2 && /units/.test($("cardUnitBadge").textContent), $("cardUnitBadge").textContent);
  L("unit panel hidden when ok", $("unitCheckPanel").hidden === (unitCheckResult(activeEq()).state === "ok"));
  selectEquation(projectData.equations.find(e => e.archetype === "integral").id);
  const vrows = [...document.querySelectorAll("#eqVarTableBody tr")];
  L("values: inputs first, computed read-only", vrows[0].classList.contains("is-input") && vrows.some(r => r.classList.contains("is-computed") && !r.querySelector(".value-input")) && document.querySelectorAll("#eqVarHead th").length <= 4, vrows.map(r => r.className).join(" "));
  selectEquation(projectData.equations.find(e => e.archetype === "implicit").id);
  $("secSource").open = true; $("secSource").dispatchEvent(new Event("toggle"));
  L("open section sizes textarea", $("cardSource").getBoundingClientRect().height > 30, $("cardSource").getBoundingClientRect().height);
  // Array grid (n-body: r is N x 2 with N = 3)
  projectData = normalizeProject(__NBODY__); refreshAll(); switchTab("vars");
  const R = "\\mathbf{r}"; const rgrid = () => [...document.querySelectorAll("#variableTableBody .arr")].find(a => a.dataset.sym === R);
  L("matrix as grid", rgrid() && rgrid().querySelectorAll(".arr-cell").length === 6 && rgrid().dataset.rows === "3", rgrid() && rgrid().dataset.rows);
  const c = rgrid().querySelector('.arr-cell[data-i="1"][data-j="0"]'); c.value = "7"; c.dispatchEvent(new Event("change", { bubbles: true }));
  L("cell edit writes rows", /^[^;]+; 7, [^;]+; [^;]+$/.test(projectData.variableMeta[R].initVal), projectData.variableMeta[R].initVal);
  const mgrid = [...document.querySelectorAll("#variableTableBody .arr")].find(a => a.dataset.sym === "m");
  L("vector as column", mgrid && mgrid.dataset.cols === "1" && mgrid.querySelectorAll(".arr-cell").length === 3, mgrid && mgrid.outerHTML.slice(0, 80));
  updateVarMeta("N", "initVal", "4", document.createElement("input"));
  L("grid follows N", rgrid().dataset.rows === "4" && rgrid().querySelectorAll(".arr-cell").length === 8, rgrid().dataset.rows);
  rgrid().parentElement.querySelector("[data-arrmode]").click();
  L("text toggle", !rgrid() && [...document.querySelectorAll("#variableTableBody [data-arrmode]")].some(b => b.dataset.arrmode === R));
  // Plain math in the card
  projectData = normalizeProject(__TOUR__); refreshAll(); newEquation();
  $("cardLatex").value = "Re = rho*u*D/mu"; $("cardLatex").dispatchEvent(new Event("input", { bubbles: true }));
  L("plain math -> LaTeX", activeEq().latex.startsWith("R_e = ") && activeEq().latex.includes("frac") && activeEq().typed === "Re = rho*u*D/mu" && /As LaTeX/.test($("typedNote").textContent) && activeEq().outputs[0] === "R_e", activeEq().latex);
  selectEquation(projectData.equations[0].id); selectEquation(projectData.equations[5].id);
  L("box keeps what was typed", $("cardLatex").value === "Re = rho*u*D/mu");
  $("cardLatex").value = "f = (a + b"; $("cardLatex").dispatchEvent(new Event("input", { bubbles: true }));
  L("unreadable plain math explained", /not closed/.test($("typedNote").textContent) && !$("typedNote").hidden, $("typedNote").textContent);
  $("cardLatex").value = "y_{n+1} = y_n + 1"; $("cardLatex").dispatchEvent(new Event("input", { bubbles: true }));
  L("LaTeX stays LaTeX", activeEq().latex === "y_{n+1} = y_n + 1" && activeEq().typed === undefined && $("typedNote").hidden && activeEq().archetype === "marching");

  // Tour
  selectEquation(projectData.equations[3].id);
  startTour();
  L("tour starts at the list", /Your equations/.test($("tourTip").textContent) && Math.abs($("tourSpot").getBoundingClientRect().left - ($("equationList").getBoundingClientRect().left - 6)) < 2, $("tourTip").textContent.slice(0, 40));
  tourGo("next");
  L("tour step 2: the box", /Type the equation/.test($("tourTip").textContent) && /2 \/ 5/.test($("tourTip").textContent), $("tourTip").textContent.slice(0, 60));
  tourGo("back"); L("tour back", /Your equations/.test($("tourTip").textContent));
  ["next", "next", "next", "next"].forEach(tourGo);
  L("tour last: Get menu", /Get the results/.test($("tourTip").textContent) && /Done/.test($("tourTip").textContent));
  tourGo("next");
  L("tour done, remembered", !$("tourTip") && localStorage.getItem("solverMapp_tourDone") === "1");
  newEquation(); startTour();
  L("tour skips hidden steps", /1 \/ 3/.test($("tourTip").textContent), $("tourTip").textContent.slice(0, 30));
  endTour();
  L("brand", document.title === "SolverMapp" && document.querySelector(".brand-name").textContent === "SolverMapp");
} catch (err) { L("THREW", false, err.stack); }
