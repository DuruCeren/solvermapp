// SolverMapp — The Plan tab: order of solution and the dependency graph.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// SOLVER PLAN (tab 2)
// ================================================================
function renderArchitectureView() {
  const plan = analyzeSolverArchitecture();
  const varList = buildVariableRegistry();

  const stat = (label, token, n, syms, role) => `
    <div class="panel stat">
      <span class="label">${token ? `<i class="swatch" style="background:var(${token})"></i>` : ""}${label}</span>
      <div class="value">${n}</div>
      <div class="chips">${syms ? (syms.map(s => roleChip(s, role)).join("") || `<span class="small muted">None</span>`) : `<span class="small muted">${plan.coupledSteps.length ? `${plan.coupledSteps.length} coupled` : "run in order"}</span>`}</div>
    </div>`;

  $("solverDiagnosticsBar").innerHTML =
    stat("Inputs", "--input", plan.globalInputs.length, plan.globalInputs, "Global Input") +
    stat("State variables", "--state", plan.stateVars.length, plan.stateVars, "State Var (y₀)") +
    stat("Steps", "", plan.steps.length, null) +
    stat("Outputs", "--output", plan.finalOutputs.length, plan.finalOutputs, "Final Output");

  const initVars = varList.filter(isGiven);
  const eqLink = eq => `<button class="link-btn" onclick="selectEquation('${eq.id}')" title="Open this equation">${escapeHtml(eq.name || "Untitled equation")}</button>`;

  let html = `
    <li class="step">
      <span class="step-num">0</span>
      <div>
        <div class="step-title">Set starting values</div>
        <div style="display:flex; flex-wrap:wrap; gap:4px">
          ${initVars.map(v => roleChip(v.symbol, v.role, ` <span class="mono">= ${escapeHtml(v.initVal)}</span>`)).join("") || `<span class="small muted">Nothing to set</span>`}
        </div>
      </div>
    </li>`;

  const eqBox = (eq, cond) => `
            <div class="step-eq">
              <div class="step-eq-top">${eqLink(eq)}${typeChip(eq.archetype)}</div>
              ${cond !== undefined ? `<div class="step-case">${cond ? `if ${renderMath(cond)}` : "otherwise"}</div>` : ""}
              <div class="step-eq-math">${renderMath(eq.latex)}</div>
              ${eq.loopMeta ? `<div class="chip-meta">${escapeHtml(eq.loopMeta)}</div>` : ""}
            </div>`;
  const unitHtml = unit => {
    if (unit.kind === "eq") return eqBox(unit.eq);
    if (unit.kind === "switch") {
      return `<div class="step-group"><div class="step-group-title">Switch for ${renderMath(unit.group.symbol)}: the first case that holds</div>
        ${unit.group.eqs.map(eq => eqBox(eq, conditionText(eq))).join("")}
        ${unit.group.otherwise ? "" : `<div class="step-case">otherwise: start value</div>`}</div>`;
    }
    const sys = unit.system, s = sys.settings;
    return `<div class="step-group"><div class="step-group-title">ODE system: ${sys.states.map(renderMath).join(", ")} over ${renderMath(`${s.independent} = ${s.from} \\dots ${s.to}`)}: ${ODE_METHODS[s.method].short}, ${escapeHtml(s.steps)} steps</div>
      ${sys.cards.map(eq => eqBox(eq)).join("")}
      ${sys.algebraic.length ? `<div class="step-case">evaluated at every stage:</div>${sys.algebraic.map(unitHtml).join("")}` : ""}</div>`;
  };

  plan.steps.forEach((step, sIdx) => {
    const ode = step.units.some(u => u.kind === "ode");
    const title = step.coupled ? `<span class="step-tag">Coupled</span>Solve together (${step.eqs.length} equations)`
      : ode ? "Integrate" + (step.units.length > 1 ? ` and solve (${step.units.length} independent parts)` : "")
      : step.units.length > 1 ? `Solve (${step.units.length} independent parts)` : "Solve";
    html += `
      <li class="step${step.coupled ? " step-coupled" : ""}">
        <span class="step-num">${sIdx + 1}</span>
        <div>
          <div class="step-title">${title}</div>
          ${step.coupled ? `<p class="step-note">These equations depend on each other in a cycle. Iterate them until ${step.computes.map(renderMath).join(", ")} stop changing (fixed-point or Newton); start values are the first guess.</p>` : ""}
          ${step.units.map(unitHtml).join("")}
        </div>
      </li>`;
  });

  if (plan.incomplete.length > 0) {
    html += `<li class="note">Skipped (no equation or no output yet): ${plan.incomplete.map(eqLink).join(", ")}</li>`;
  }
  if (projectData.equations.length === 0) {
    html = `<li class="note">Add equations in step 1 to see the plan.</li>`;
  }
  $("executionPlanContainer").innerHTML = html;

  $("planWarnings").innerHTML = plan.warnings.map(w =>
    `<li>${renderMath(w.symbol)} is computed by ${w.eqs.map(eqLink).join(" and ")}. Keep one defining equation, make it an input in the others, or give them conditions (Applies when) to switch between them.</li>`
  ).join("") + plan.notes.map(n => `<li>${escapeHtml(n)}</li>`).join("");
  $("planWarnings").hidden = plan.warnings.length + plan.notes.length === 0;

  renderDependencyGraph(varList);
}

// ================================================================
// DEPENDENCY GRAPH (ported from example_project/js/graph-view.js, made vertical)
// Layered top-to-bottom layout without libraries: equations sit in layers by dependency level,
// each variable sits just below the equation that computes it (inputs just above first use).
// Node order inside a layer is refined with barycenter sweeps to reduce edge crossings.
// Nodes are HTML (so KaTeX renders inside them); edges are an SVG layer underneath.
// ================================================================
const GRAPH_LAYER_GAP = 64;  // vertical space between layers
const GRAPH_NODE_GAP = 56;   // horizontal space between nodes of a layer (room for loop arrows)
const GRAPH_PAD = 28;
const GRAPH_LANE_GAP = 12;   // distance between parallel loop arrows
const GRAPH_WAYPOINT_GAP = 20; // horizontal space next to a long edge passing through a layer
const GRAPH_ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

let graphZoom = 1;
let graphSelected = null;
let graph = { nodes: new Map(), edges: [] };
let graphSize = { width: 0, height: 0 };

function buildGraphModel(varList) {
  const eqs = projectData.equations;
  const dep = planDependencies(eqs);
  const coupled = dep.sccCoupled;
  const eqLayer = eq => 2 * dep.levelOf.get(eq.id) + 1;
  const nodes = new Map();
  const edges = [];

  eqs.forEach((eq, index) => {
    const id = "e:" + eq.id;
    nodes.set(id, { id, type: "eq", eq, index, layer: eqLayer(eq), coupled: coupled.has(eq.id) });
  });

  varList.forEach((v, k) => {
    const definedIn = eqs.filter(eq => eq.outputs.includes(v.symbol));
    const rangeSymbol = indexRangeSymbols().includes(v.symbol);
    const usedIn = eqs.filter(eq => eq.inputs.includes(v.symbol) || conditionSymbols(eq).includes(v.symbol) || (rangeSymbol && latexSymbols(eq.latex).usesIndices));
    const layer = definedIn.length
      ? Math.max(...definedIn.map(eqLayer)) + 1
      : usedIn.length ? Math.max(0, Math.min(...usedIn.map(eqLayer)) - 1) : 0;
    const id = "v:" + k;
    nodes.set(id, { id, type: "var", v, layer });
    definedIn.forEach(eq => edges.push({ from: "e:" + eq.id, to: id, kind: "define" }));
    usedIn.forEach(eq => edges.push({ from: id, to: "e:" + eq.id, kind: "use" }));
  });
  return { nodes, edges };
}

function graphNodeHtml(node, varList, nameCount) {
  if (node.type === "eq") {
    const { eq, index } = node;
    const num = cleanEqNumber(eq);
    const ab = ARCHETYPE_BADGES[eq.archetype || "explicit"];
    const tags = (eq.archetype !== "explicit" ? `<span class="g-tag">${ab.symbol} ${ab.label}</span>` : "") +
      (conditionText(eq) ? `<span class="g-tag">if ${renderMath(conditionText(eq))}</span>` : String(eq.condition || "").trim() ? `<span class="g-tag">otherwise</span>` : "") +
      (node.coupled ? `<span class="g-tag g-tag-coupled">${eq.archetype === "ode" ? "ODE system" : "coupled"}</span>` : "");
    return `
      <div class="g-node g-eq" data-node="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="${escapeHtml(eq.name || "Untitled equation")}">
        <div class="g-eq-head">
          <span class="g-eq-index">#${index + 1}</span>
          <span class="g-eq-title${eq.name ? "" : " placeholder"}">${escapeHtml(eq.name || "Untitled equation")}</span>
          ${num ? `<span class="g-eq-num">(${escapeHtml(num)})</span>` : ""}
        </div>
        <span class="g-eq-math">${eq.latex.trim() ? renderMath(eq.latex) : `<span class="small muted">no equation yet</span>`}</span>
        ${tags ? `<div class="g-eq-tags">${tags}</div>` : ""}
        <div class="g-eq-foot">${unitCheckBadge(eq, varList)}<button class="g-open" data-open="${escapeHtml(eq.id)}">Open</button></div>
      </div>`;
  }
  const v = node.v;
  const ui = ROLE_UI[v.role];
  const problems = [
    unitError(v.units) && "invalid unit",
    nameCount[v.codeVar] > 1 && "code name used by another variable",
    v.codeName.trim() && !isValidIdentifier(v.codeName.trim()) && "invalid code name"
  ].filter(Boolean);
  const details = [v.codeVar, v.units ? `[${v.units}]` : "[no unit]", v.role === "State Var (y₀)" && `start = ${v.initVal}`, v.desc].filter(Boolean).join("  ");
  return `
    <div class="g-node g-var ${ui.cls}" data-node="${node.id}" tabindex="0" role="button"
         title="${escapeHtml(`${ui.label}: ${details}`)}" aria-label="${escapeHtml(`${ui.label} ${v.codeVar}`)}">
      <span class="g-var-math">${renderMath(displaySymbol(v))}</span>
      <span class="g-var-meta">
        ${v.codeVar !== v.symbol ? `<span class="g-var-code mono">${escapeHtml(v.codeVar)}</span>` : ""}
        ${v.units ? `<span class="g-var-unit mono">${escapeHtml(v.units)}</span>` : ""}
      </span>
      ${problems.length ? `<span class="g-var-alert" title="${escapeHtml(problems.join(", "))}">!</span>` : ""}
    </div>`;
}

// Layers top to bottom. A forward edge that skips layers gets a waypoint in every layer it
// crosses, so it is routed between nodes instead of through them. Back edges (loops) run
// from a lower layer up to a higher one and are routed separately in routeGraphEdges.
function layoutGraph() {
  const { nodes, edges } = graph;
  const maxLayer = Math.max(0, ...[...nodes.values()].map(n => n.layer));
  const layers = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes.values()) layers[n.layer].push(n);

  const links = []; // pairs of nodes in adjacent layers, used to order the layers
  edges.forEach((e, i) => {
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    e.back = b.layer < a.layer;
    e.via = [];
    if (e.back) {
      if (a.layer - b.layer === 1) links.push([a, b]);
      return;
    }
    let prev = a;
    for (let l = a.layer + 1; l < b.layer; l++) {
      const d = { id: `d:${i}:${l}`, dummy: true, layer: l, w: 12, h: 0 };
      layers[l].push(d);
      e.via.push(d);
      links.push([prev, d]);
      prev = d;
    }
    links.push([prev, b]);
  });

  const neighbors = new Map();
  const near = n => neighbors.get(n) || neighbors.set(n, []).get(n);
  links.forEach(([a, b]) => { near(a).push(b); near(b).push(a); });
  layers.forEach(row => row.forEach((n, i) => { n.rank = (i + 0.5) / row.length; }));

  // Barycenter sweeps: order each layer by the mean position of its neighbours in adjacent layers.
  const sweep = (l, side) => {
    const row = layers[l];
    for (const n of row) {
      const ref = (neighbors.get(n) || []).filter(m => (side < 0 ? m.layer < l : m.layer > l));
      n.key = ref.length ? ref.reduce((s, m) => s + m.rank, 0) / ref.length : n.rank;
    }
    row.sort((a, b) => a.key - b.key);
    row.forEach((n, i) => { n.rank = (i + 0.5) / row.length; });
  };
  for (let iter = 0; iter < 6; iter++) {
    for (let l = 1; l <= maxLayer; l++) sweep(l, -1);
    for (let l = maxLayer - 1; l >= 0; l--) sweep(l, +1);
  }

  // The nodes of a layer side by side, centred; waypoints need less room than nodes.
  const gap = (a, b) => (a.dummy || b.dummy ? GRAPH_WAYPOINT_GAP : GRAPH_NODE_GAP);
  const rowWidth = row => row.reduce((s, n, i) => s + n.w + (i ? gap(row[i - 1], n) : 0), 0);
  const widest = Math.max(0, ...layers.map(rowWidth));
  const rows = [];
  let y = GRAPH_PAD;
  layers.forEach((row, l) => {
    if (!row.length) return;
    const height = Math.max(...row.map(n => n.h));
    let x = GRAPH_PAD + (widest - rowWidth(row)) / 2;
    row.forEach((n, i) => {
      if (i) x += gap(row[i - 1], n);
      n.x = x;
      n.y = y + (height - n.h) / 2;
      x += n.w;
    });
    rows[l] = { top: y, bottom: y + height, right: Math.max(...row.map(n => n.x + n.w)) };
    y += height + GRAPH_LAYER_GAP;
  });
  graph.rows = rows;
  graphSize = { width: widest + 2 * GRAPH_PAD, height: y - GRAPH_LAYER_GAP + GRAPH_PAD };
}

// Polyline with rounded corners.
function roundedPath(pts, r = 8) {
  const toward = (from, to, dist) => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: from.x + (to.x - from.x) * dist / len, y: from.y + (to.y - from.y) * dist / len };
  };
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const k = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const p = toward(b, a, k);
    const q = toward(b, c, k);
    d += ` L${p.x},${p.y} Q${b.x},${b.y} ${q.x},${q.y}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x},${last.y}`;
}

// Forward edges leave a node at the bottom and enter the next one at the top, curving through
// their waypoints. A loop (a state variable fed back into its equation, coupled equations)
// leaves its variable at the top and enters the equation at the bottom; a loop that spans
// several layers goes up a lane on the right of everything it passes. Every node side spreads its edges over separate
// ports, ordered by the position of the other end, so edges don't overlap at the node.
function routeGraphEdges() {
  const { nodes, edges, rows } = graph;
  const cx = n => n.x + n.w / 2;

  const ports = new Map();
  const addPort = (node, side, e, end, other) => {
    const key = node.id + "|" + side;
    if (!ports.has(key)) ports.set(key, { node, side, items: [] });
    ports.get(key).items.push({ e, end, other });
  };
  edges.forEach(e => {
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    addPort(a, e.back ? "top" : "bottom", e, "p1", e.via[0] || b);
    addPort(b, e.back ? "bottom" : "top", e, "p2", e.via[e.via.length - 1] || a);
  });
  for (const { node, side, items } of ports.values()) {
    // Forward edges in the order of their other end; loops at the right end of the side.
    items.sort((a, b) => a.e.back - b.e.back || cx(a.other) - cx(b.other));
    items.forEach((it, i) => {
      it.e[it.end] = {
        x: node.x + node.w * (0.15 + 0.7 * (i + 1) / (items.length + 1)),
        y: side === "top" ? node.y : node.y + node.h
      };
    });
  }

  edges.filter(e => !e.back).forEach(e => {
    let cur = e.p1;
    let d = `M${cur.x},${cur.y}`;
    const curveTo = to => {
      const dy = Math.max(20, (to.y - cur.y) / 2);
      d += ` C${cur.x},${cur.y + dy} ${to.x},${to.y - dy} ${to.x},${to.y}`;
      cur = to;
    };
    e.via.forEach(w => {
      const x = cx(w);
      curveTo({ x, y: rows[w.layer].top });
      if (rows[w.layer].bottom > cur.y) {
        d += ` L${x},${rows[w.layer].bottom}`;
        cur = { x, y: rows[w.layer].bottom };
      }
    });
    curveTo(e.p2);
    e.d = d;
  });

  // Middle of the gap above layer l (between it and the nearest non-empty layer above).
  const above = l => {
    let k = l - 1;
    while (!rows[k]) k--;
    return { key: k + ">" + l, y: (rows[k].bottom + rows[l].top) / 2 };
  };
  const below = l => {
    let k = l + 1;
    while (!rows[k]) k++;
    return above(k);
  };

  // A loop one layer up is a curve; its ports lie right of the forward edges between the same
  // two nodes, so they never cross. A longer loop runs through the gap above its variable,
  // up a lane, and through the gap below its equation, at its own height in each gap.
  const loops = edges.filter(e => e.back);
  loops.filter(e => nodes.get(e.from).layer - nodes.get(e.to).layer === 1).forEach(e => {
    const dy = Math.max(20, (e.p1.y - e.p2.y) / 2);
    e.d = `M${e.p1.x},${e.p1.y} C${e.p1.x},${e.p1.y - dy} ${e.p2.x},${e.p2.y + dy} ${e.p2.x},${e.p2.y}`;
  });

  const longLoops = loops.filter(e => !e.d);
  const channels = new Map();
  const useChannel = (ch, e) => {
    if (!channels.has(ch.key)) channels.set(ch.key, { y: ch.y, users: [] });
    channels.get(ch.key).users.push(e);
    return ch.key;
  };
  longLoops.forEach(e => {
    e.chOut = useChannel(above(nodes.get(e.from).layer), e);
    e.chIn = useChannel(below(nodes.get(e.to).layer), e);
  });
  const channelY = (key, e) => {
    const ch = channels.get(key);
    const users = ch.users.sort((p, q) => p.p1.x - q.p1.x);
    const step = Math.min(10, (GRAPH_LAYER_GAP - 16) / Math.max(1, users.length - 1));
    return ch.y + (users.indexOf(e) - (users.length - 1) / 2) * step;
  };

  // Lanes for long loops: right of every row they pass, outwards past overlapping lanes.
  const lanes = [];
  longLoops
    .sort((p, q) => (nodes.get(p.from).layer - nodes.get(p.to).layer) - (nodes.get(q.from).layer - nodes.get(q.to).layer))
    .forEach(e => {
      const lo = nodes.get(e.to).layer;
      const hi = nodes.get(e.from).layer;
      let x = Math.max(...rows.slice(lo, hi + 1).filter(Boolean).map(r => r.right)) + 20;
      while (lanes.some(l => l.lo <= hi && lo <= l.hi && Math.abs(l.x - x) < GRAPH_LANE_GAP)) x += GRAPH_LANE_GAP;
      lanes.push({ lo, hi, x });
      e.laneX = x;
    });
  graphSize.width = Math.max(graphSize.width, ...lanes.map(l => l.x + GRAPH_PAD));

  longLoops.forEach(e => {
    const yOut = channelY(e.chOut, e);
    const yIn = channelY(e.chIn, e);
    e.d = roundedPath([e.p1, { x: e.p1.x, y: yOut }, { x: e.laneX, y: yOut },
      { x: e.laneX, y: yIn }, { x: e.p2.x, y: yIn }, e.p2]);
  });
}

function drawGraphEdges(layer) {
  layer.setAttribute("width", graphSize.width);
  layer.setAttribute("height", graphSize.height);
  const markers = ["define", "use", "back"].map(kind => `
    <marker id="g-arrow-${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="g-arrow-${kind}"/>
    </marker>`).join("");
  const paths = graph.edges.map(e => {
    const marker = e.back ? "back" : e.kind;
    return `<path d="${e.d}" class="g-edge g-edge-${e.kind}${e.back ? " g-edge-back" : ""}" marker-end="url(#g-arrow-${marker})" data-from="${e.from}" data-to="${e.to}"/>`;
  }).join("");
  layer.innerHTML = `<defs>${markers}</defs>${paths}`;
}

// Nodes reachable from start, following edges forward (affects) or backward (depends on).
function graphReach(start, forward) {
  const out = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    for (const e of graph.edges) {
      const [from, to] = forward ? [e.from, e.to] : [e.to, e.from];
      if (from === id && !out.has(to)) {
        out.add(to);
        queue.push(to);
      }
    }
  }
  return out;
}

function applyGraphHighlight() {
  const canvas = $("graphCanvas");
  const trace = $("graphTrace");
  const active = graphSelected && graph.nodes.has(graphSelected);
  canvas.classList.toggle("has-selection", !!active);
  if (!active) {
    canvas.querySelectorAll(".is-lineage, .is-selected").forEach(el => el.classList.remove("is-lineage", "is-selected"));
    trace.hidden = true;
    return;
  }
  const up = graphReach(graphSelected, false);
  const down = graphReach(graphSelected, true);
  canvas.querySelectorAll(".g-node").forEach(el => {
    const id = el.dataset.node;
    el.classList.toggle("is-lineage", up.has(id) || down.has(id));
    el.classList.toggle("is-selected", id === graphSelected);
  });
  canvas.querySelectorAll(".g-edge").forEach(el => {
    const { from, to } = el.dataset;
    el.classList.toggle("is-lineage", (up.has(from) && up.has(to)) || (down.has(from) && down.has(to)));
  });
  const count = (set, type) => [...set].filter(id => id !== graphSelected && graph.nodes.get(id).type === type).length;
  trace.hidden = false;
  trace.textContent =
    `Depends on ${count(up, "eq")} equation(s) and ${count(up, "var")} variable(s); ` +
    `affects ${count(down, "eq")} equation(s) and ${count(down, "var")} variable(s). Click empty space to clear.`;
}

function renderDependencyGraph(varList = buildVariableRegistry()) {
  const canvas = $("graphCanvas");
  graph = buildGraphModel(varList);

  const connected = projectData.equations.some(eq => eq.inputs.length || eq.outputs.length);
  $("graphEmpty").hidden = connected;
  $("graphViewport").hidden = !connected;
  if (!connected) {
    graphSelected = null;
    applyGraphHighlight();
    return;
  }

  // Render nodes first, measure them, then position.
  const nameCount = {};
  varList.forEach(v => nameCount[v.codeVar] = (nameCount[v.codeVar] || 0) + 1);
  canvas.innerHTML = `<svg id="graphEdges" class="graph-edges" aria-hidden="true"></svg>` +
    [...graph.nodes.values()].map(n => graphNodeHtml(n, varList, nameCount)).join("");
  for (const node of graph.nodes.values()) {
    node.el = canvas.querySelector(`[data-node="${CSS.escape(node.id)}"]`);
    node.w = node.el.offsetWidth;
    node.h = node.el.offsetHeight;
  }
  layoutGraph();
  routeGraphEdges();
  for (const node of graph.nodes.values()) {
    node.el.style.left = node.x + "px";
    node.el.style.top = node.y + "px";
  }
  canvas.style.width = graphSize.width + "px";
  canvas.style.height = graphSize.height + "px";
  drawGraphEdges($("graphEdges"));
  applyGraphZoom();
  applyGraphHighlight();
}

function renderGraphLegend() {
  $("graphLegend").innerHTML =
    Object.values(ROLE_UI).map(r => `<span title="${r.hint}"><i class="swatch" style="background:var(${r.token})"></i>${r.label}</span>`).join("") +
    `<span><i class="lg-eq"></i>Equation</span>
     <span><i class="lg-line lg-use"></i>used by</span>
     <span><i class="lg-line lg-define"></i>computes</span>
     <span><i class="lg-line lg-back"></i>loop (feedback / coupled)</span>`;
}

function applyGraphZoom() {
  $("graphCanvas").style.transform = `scale(${graphZoom})`;
  $("graphStage").style.width = graphSize.width * graphZoom + "px";
  $("graphStage").style.height = graphSize.height * graphZoom + "px";
  $("zoomResetBtn").textContent = Math.round(graphZoom * 100) + "%";
}

function setGraphZoom(next) {
  graphZoom = Math.min(1.5, Math.max(0.3, next));
  applyGraphZoom();
}

function graphZoomStep(direction) {
  const next = direction > 0
    ? GRAPH_ZOOM_STEPS.find(z => z > graphZoom + 0.001)
    : [...GRAPH_ZOOM_STEPS].reverse().find(z => z < graphZoom - 0.001);
  setGraphZoom(next || graphZoom);
}

function graphZoomFit() {
  const vp = $("graphViewport");
  setGraphZoom(Math.min(1, (vp.clientWidth - 4) / graphSize.width, (vp.clientHeight - 4) / graphSize.height));
}

function bindGraphEvents() {
  const toggle = id => {
    graphSelected = id && id !== graphSelected ? id : null;
    applyGraphHighlight();
  };
  $("graphViewport").addEventListener("click", e => {
    const open = e.target.closest("[data-open]");
    if (open) { selectEquation(open.dataset.open); return; }
    const node = e.target.closest(".g-node");
    toggle(node && node.dataset.node);
  });
  $("graphViewport").addEventListener("dblclick", e => {
    const node = e.target.closest(".g-eq");
    if (node) selectEquation(node.dataset.node.slice(2));
  });
  $("graphViewport").addEventListener("keydown", e => {
    const node = e.target.closest(".g-node");
    if (node && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      toggle(node.dataset.node);
    }
  });
}
