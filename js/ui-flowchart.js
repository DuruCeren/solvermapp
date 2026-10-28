// SolverMapp — The Flowchart tab: layout, SVG / PNG, TikZ and Mermaid.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// FLOWCHART (tab 5)
// The solution procedure as a classic flowchart: start, read inputs, set start values, the
// calculations in the order of solution, loops as decisions with loop-back arrows, write
// results, end. Built from the report's algorithm model, so both always agree.
//
// Node labels are lines of parts: { text }, { math: LaTeX } or { ref: equation entry }.
// Writers: SVG (screen, .svg, .png; math drawn as italic text with sub/superscripts),
// TikZ (real LaTeX math, for the report and a standalone .tex) and Mermaid (plain text).
// ================================================================
let flowView = "diagram";
let flowOutput = null; // { svg, tikz, tikzStandalone, mermaid, width, height }

const FLOW_FONT = "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const FLOW_GAP = 30;   // vertical space between nodes
const FLOW_PAD = 28;
const FLOW_LANE = 16;  // distance between nested loop-back arrows
const FLOW_COLORS = {  // used in exported files; the screen uses theme tokens
  term: ["#e8edf3", "#435a75"], io: ["#e6f0ea", "#46715c"], proc: ["#ffffff", "#5f6870"], dec: ["#f7f0de", "#85672a"],
  text: "#2b3138", muted: "#646d75", edge: "#5f6870"
};

const MATH_SYMBOLS = {};
("alpha:α beta:β gamma:γ delta:δ epsilon:ε varepsilon:ε zeta:ζ eta:η theta:θ vartheta:ϑ iota:ι kappa:κ lambda:λ " +
 "mu:μ nu:ν xi:ξ pi:π rho:ρ varrho:ϱ sigma:σ tau:τ upsilon:υ phi:ϕ varphi:φ chi:χ psi:ψ omega:ω Gamma:Γ Delta:Δ " +
 "Theta:Θ Lambda:Λ Xi:Ξ Pi:Π Sigma:Σ Upsilon:Υ Phi:Φ Psi:Ψ Omega:Ω infty:∞ cdot:· times:× dots:… ldots:… cdots:⋯ " +
 "leq:≤ geq:≥ le:≤ ge:≥ neq:≠ approx:≈ pm:± partial:∂ nabla:∇ leftarrow:←")
  .split(" ").forEach(pair => { const [k, v] = pair.split(":"); MATH_SYMBOLS[k] = v; });

// Simple LaTeX math -> styled text runs: letters italic, sub/superscripts, Greek and symbols.
// Enough for symbols (F_{total}, T_{\infty}, \rho) and short conditions (n < 10, 10^{-6}).
const MATH_ACCENTS = { dot: "\u0307", ddot: "\u0308", hat: "\u0302", bar: "\u0304", tilde: "\u0303", vec: "\u20D7" };

function mathToRuns(tex, style = "i", spaced = true) {
  const runs = [];
  const push = (t, s) => {
    const last = runs[runs.length - 1];
    if (last && last.s === s) last.t += t; else runs.push({ t, s });
  };
  let i = 0;
  const readGroup = () => {
    if (tex[i] === "{") {
      let depth = 0, j = i;
      for (; j < tex.length; j++) {
        if (tex[j] === "{") depth++;
        else if (tex[j] === "}" && --depth === 0) break;
      }
      const inner = tex.slice(i + 1, j);
      i = j + 1;
      return inner;
    }
    const cmd = /^\\[A-Za-z]+/.exec(tex.slice(i));
    if (cmd) { i += cmd[0].length; return cmd[0]; }
    return tex[i++] || "";
  };
  while (i < tex.length) {
    const c = tex[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
      i += m[0].length;
      const name = m[1];
      if (MATH_SYMBOLS[name]) push(MATH_SYMBOLS[name], GREEK_LETTERS.includes(name) ? style : "n");
      else if (MATH_ACCENTS[name]) {
        // \dot{x} -> ẋ: the letters, then a combining accent on the last one
        const inner = mathToRuns(readGroup(), style, spaced);
        inner.forEach(r => push(r.t, r.s));
        if (inner.length) push(MATH_ACCENTS[name], inner[inner.length - 1].s);
      } else if (/^(mathrm|text|textrm|operatorname|mathbf|boldsymbol|mathit|mathsf|overline)$/.test(name)) {
        mathToRuns(readGroup(), name === "mathit" ? "i" : name === "mathrm" || name.startsWith("text") || name === "operatorname" ? "n" : style, spaced)
          .forEach(r => push(r.t, r.s));
      } else if (name === "," || name === ";" || name === " " || name === "quad") push(" ", "n");
    } else if (c === "_" || c === "^") {
      i++;
      const s = c === "_" ? "sub" : "sup";
      mathToRuns(readGroup(), "n", false).forEach(r => push(r.t, s));
    } else if (c === "{" || c === "}") {
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (/[A-Za-z]/.test(c)) {
      push(c, style);
      i++;
    } else if (/[=<>+-]/.test(c)) {
      const op = c === "-" ? "−" : c;
      push(spaced && (c !== "-" || runs.length) ? ` ${op} ` : op, "n");
      i++;
    } else {
      push(c, "n");
      i++;
    }
  }
  return runs;
}

// Plain text of a math expression, for Mermaid: F_{total} -> F_total
function mathPlain(tex) {
  return mathToRuns(tex).map(r => (r.s === "sub" ? "_" : r.s === "sup" ? "^" : "") + r.t).join("");
}

// Small numbers for display in math: 1e-6 -> 10^{-6}
function sciMath(v) {
  const t = String(v).trim();
  let m = /^1(?:\.0*)?[eE]([-+]?\d+)$/.exec(t);
  if (m) return `10^{${+m[1]}}`;
  m = /^([\d.]+)[eE]([-+]?\d+)$/.exec(t);
  return m ? `${m[1]} \\cdot 10^{${+m[2]}}` : t;
}

function buildFlowchart(opts, model) {
  model = model || buildReportModel({ ...REPORT_DEFAULTS, ...projectData.report, equations: true, values: true });
  const varList = buildVariableRegistry();
  const T = text => ({ text });
  const M = math => ({ math });
  const syms = list => list.flatMap((s, i) => (i ? [T(", "), M(s)] : [M(s)]));
  const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, k) => items.slice(k * size, k * size + size));

  const nodes = [];
  const edges = [];
  const loops = [];
  const jumps = []; // forward arrows on the left: "no" to the next case of a switch, case ends to after the switch
  let prev = null;
  let pendingLabel = "";
  let pendingJumps = [];
  const add = (shape, lines) => {
    const node = { id: "n" + (nodes.length + 1), shape, lines: lines.map(l => (Array.isArray(l) ? { parts: l } : l)) };
    nodes.push(node);
    if (prev) edges.push({ from: prev, to: node, label: pendingLabel });
    pendingJumps.forEach(j => jumps.push({ ...j, to: node }));
    pendingJumps = [];
    pendingLabel = "";
    prev = node;
    return node;
  };
  const refLine = e => (opts.numbers || opts.titles ? [{ parts: [{ ref: e }], small: true }] : []);
  const symbolLines = (title, list, perLine = 4) => [[T(title)], ...chunk(list, perLine).map(syms)];

  add("term", [[T("Start")]]);
  const sets = model.algorithm.filter(n => n.type === "set");
  sets.forEach(node => {
    if (!node.values) {
      add("io", symbolLines("Read inputs", node.rows.map(r => r.symbol)));
    } else {
      const items = node.rows.map(r => (r.value ? [M(r.symbol), T(` = ${r.value}`)] : [M(r.symbol)]));
      add("proc", [[T("Set start values")], ...chunk(items, 3).map(row => row.flatMap((it, k) => (k ? [T(", "), ...it] : it)))]);
    }
  });

  // Returns the highest loop lane used inside the list (-1 when it has no loops).
  // depth: nesting of switches, so their jump lanes on the left do not overlap.
  const walk = (list, depth = 0) => {
    let lane = -1;
    list.forEach(node => {
      const e = node.entry;
      if (node.type === "define") {
        add("proc", [[T("Define "), M(`${e.outputs[0]}(${e.settings.args.join(", ")})`)], ...refLine(e)]);
      } else if (node.type === "switch") {
        const exits = [];
        let noFrom = null;
        node.cases.forEach((c, k) => {
          if (k) prev = null;
          if (noFrom) pendingJumps.push({ from: noFrom, label: "no", lane: 2 * depth });
          noFrom = null;
          if (c.cond) {
            noFrom = add("dec", [[M(c.cond), T(" ?")]]);
            pendingLabel = "yes";
          }
          lane = Math.max(lane, walk(c.body, depth + 1));
          exits.push(prev);
        });
        if (noFrom) {
          prev = null;
          pendingJumps.push({ from: noFrom, label: "no", lane: 2 * depth });
          add("proc", [[T("Keep the start value of "), M(node.symbol)]]);
          exits.push(prev);
        }
        prev = exits.pop();
        exits.forEach(x => pendingJumps.push({ from: x, label: "", lane: 2 * depth + 1 }));
      } else if (node.type === "ode") {
        const o = node.settings;
        const dt = `\\Delta ${o.independent}`;
        add("proc", [[M(`${o.independent} = ${o.from}`), T(", "), M(`${dt} = (${o.to} - ${o.from}) / ${o.steps}`)]]);
        const first = nodes.length;
        const inner = walk(node.algebraic, depth);
        add("proc", [[T(`${ODE_METHODS[o.method].short} step: `), ...syms(node.states), T(", "), M(`${o.independent} = ${o.independent} + ${dt}`)],
          ...node.odes.flatMap(refLine), ...(node.algebraic.length && o.method === "rk4" ? [{ parts: [T("the boxes above run at every stage")], small: true }] : [])]);
        const dec = add("dec", [[M(`${o.independent} < ${o.to}`), T(" ?")]]);
        loops.push({ from: dec, to: nodes[first], label: "yes", lane: inner + 1 });
        pendingLabel = "no";
        lane = Math.max(lane, inner + 1);
      } else if (node.type === "compute") {
        const how = e.type === "summation" ? " by summation" : e.type === "integral" ? " by integration" : e.type === "implicit" ? " (linear solve)" : "";
        const every = (e.settings.free || []).length ? [T(" for every "), ...syms(e.settings.free)] : [];
        add("proc", [[T("Compute "), ...syms(e.outputs), T(how), ...every], ...refLine(e)]);
      } else if (node.type === "for") {
        add("proc", [[M("n = 0")]]);
        const body = add("proc", [[T("Update "), ...syms(e.outputs), T(", "), M("n = n + 1")], ...refLine(e)]);
        const dec = add("dec", [[M(`n < ${e.settings.steps}`), T(" ?")]]);
        loops.push({ from: dec, to: body, label: "yes", lane: 0 });
        pendingLabel = "no";
        lane = Math.max(lane, 0);
      } else if (node.type === "until") {
        const body = add("proc", [[T("Update "), ...syms(e.outputs)], ...refLine(e)]);
        const dec = add("dec", [[T("Change in "), ...syms(e.outputs), T(" < "), M(sciMath(e.settings.tol)), T(" ?")],
          { parts: [T(`or ${e.settings.maxIter} iterations`)], small: true }]);
        loops.push({ from: dec, to: body, label: "no", lane: 0 });
        pendingLabel = "yes";
        lane = Math.max(lane, 0);
      } else if (node.type === "root") {
        const s = e.settings;
        const guess = s.guess ? [M(`${e.outputs[0]} = ${isNumber(s.guess) ? sciMath(s.guess) : s.guess}`)] : [T("Initial guess for "), ...syms(e.outputs)];
        add("proc", [guess, ...(s.min || s.max ? [{ parts: [T("branch "), M(branchRange(e, { math: t => t }))], small: true }] : [])]);
        const body = add("proc", [[T("Newton step: "), M(rootStepMath(e))], ...refLine(e)]);
        const dec = add("dec", [[T("Step < "), M(sciMath(s.rootTol)), T(" ?")],
          { parts: [T(`or ${s.rootMaxIter} iterations`)], small: true }]);
        loops.push({ from: dec, to: body, label: "no", lane: 0 });
        pendingLabel = "yes";
        lane = Math.max(lane, 0);
      } else if (node.type === "coupled") {
        add("proc", [[T("Initial guesses for "), ...syms(node.outputs)]]);
        const first = nodes.length;
        const inner = walk(node.body);
        const dec = add("dec", [[...syms(node.outputs), T(" converged?")], { parts: [T("coupled block")], small: true }]);
        loops.push({ from: dec, to: nodes[first], label: "no", lane: inner + 1 });
        pendingLabel = "yes";
        lane = Math.max(lane, inner + 1);
      }
    });
    return lane;
  };
  walk(model.algorithm.filter(n => n.type !== "set"));

  const outputs = varList.filter(v => v.role === "Final Output");
  const results = (outputs.length ? outputs : varList.filter(v => v.role !== "Global Input")).filter(v => !v.callable).map(v => v.symbol);
  if (results.length) add("io", symbolLines("Write results", results));
  add("term", [[T("End")]]);
  return { nodes, edges, loops, jumps, empty: model.algorithm.filter(n => n.type !== "set").length === 0 };
}

// ---------- Layout (one column, loop-back arrows on the right) ----------
let flowMeasureCtx = null;

function flowRuns(part, opts, refFormat) {
  if (part.text !== undefined) return [{ t: part.text, s: "n" }];
  if (part.math !== undefined) return mathToRuns(part.math);
  return [{ t: refFormat(part.ref, opts), s: "n" }];
}

// "Eq. (3) · Boundary work integral", following the Equation numbers / titles options.
function flowRefText(e, opts, number = `Eq. (${e.number})`) {
  return [opts.numbers && number, opts.titles && e.title].filter(Boolean).join(" · ");
}

function runFont(run, small) {
  const size = (small ? 12 : 14) * (run.s === "sub" || run.s === "sup" ? 0.72 : 1);
  return { size, css: `${run.s === "i" ? "italic " : ""}${size}px ${FLOW_FONT}` };
}

function layoutFlowchart(fc, opts) {
  if (!flowMeasureCtx) flowMeasureCtx = document.createElement("canvas").getContext("2d");
  const ctx = flowMeasureCtx;
  fc.nodes.forEach(node => {
    node.textLines = node.lines.map(line => {
      const runs = line.parts.flatMap(p => flowRuns(p, opts, flowRefText)).filter(r => r.t);
      const width = runs.reduce((w, r) => { ctx.font = runFont(r, line.small).css; return w + ctx.measureText(r.t).width; }, 0);
      return { runs, width, small: line.small };
    }).filter(l => l.runs.length);
    const textW = Math.max(0, ...node.textLines.map(l => l.width));
    const textH = node.textLines.reduce((h, l) => h + (l.small ? 16 : 19), 0);
    node.textH = textH;
    if (node.shape === "dec") {
      const a = textW / 2 + textH / 2 + 22;
      node.w = 2 * a;
      node.h = 2 * Math.max(30, (textH / 2 + 6) * a / (a - textW / 2));
    } else if (node.shape === "term") {
      node.w = Math.max(96, textW + 44);
      node.h = textH + 16;
    } else {
      node.w = Math.max(150, textW + 30 + (node.shape === "io" ? 24 : 0));
      node.h = textH + 20;
    }
  });

  const widest = Math.max(...fc.nodes.map(n => n.w));
  let cx = FLOW_PAD + widest / 2;
  let y = FLOW_PAD;
  fc.nodes.forEach((n, i) => {
    n.index = i;
    n.x = cx - n.w / 2;
    n.y = y;
    y += n.h + FLOW_GAP;
  });
  // Each loop runs right of every node it spans; nested loops lie inside the outer ones.
  let right = cx + widest / 2;
  fc.loops.forEach(l => {
    const span = fc.nodes.slice(l.to.index, l.from.index + 1);
    l.x = Math.max(...span.map(n => n.x + n.w)) + 26 + l.lane * FLOW_LANE;
    right = Math.max(right, l.x + 24);
  });
  // Forward jumps (switch cases) run left of every node they span; shift right to make room.
  let left = cx - widest / 2;
  (fc.jumps || []).forEach(j => {
    const span = fc.nodes.slice(j.from.index, j.to.index + 1);
    j.x = Math.min(...span.map(n => n.x)) - 26 - j.lane * FLOW_LANE;
    left = Math.min(left, j.x - (j.label ? 28 : 8));
  });
  const shift = Math.max(0, FLOW_PAD - left);
  if (shift) {
    fc.nodes.forEach(n => { n.x += shift; });
    fc.loops.forEach(l => { l.x += shift; });
    fc.jumps.forEach(j => { j.x += shift; });
    cx += shift;
    right += shift;
  }
  return { width: Math.ceil(Math.max(right, cx + widest / 2) + FLOW_PAD), height: Math.ceil(y - FLOW_GAP + FLOW_PAD), cx };
}

// ---------- SVG ----------
function flowSvg(fc, size, opts, { exportMode = false, idPrefix = "fc" } = {}) {
  const paint = (cls, fill, stroke) => (exportMode ? `fill="${fill}" stroke="${stroke}"` : `class="${cls}"`);
  const textAttr = small => (exportMode ? `fill="${small ? FLOW_COLORS.muted : FLOW_COLORS.text}"` : `class="${small ? "fc-text-small" : "fc-text"}"`);
  const edgeAttr = exportMode ? `stroke="${FLOW_COLORS.edge}" fill="none" stroke-width="1.5"` : `class="fc-edge"`;
  const labelAttr = exportMode ? `fill="${FLOW_COLORS.muted}"` : `class="fc-label"`;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}" font-family="${FLOW_FONT.replace(/"/g, "'")}">`);
  out.push(`<defs><marker id="${idPrefix}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" ${exportMode ? `fill="${FLOW_COLORS.edge}"` : `class="fc-arrow"`}/></marker></defs>`);
  if (exportMode) out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  const arrow = `marker-end="url(#${idPrefix}-arrow)"`;
  const cx = size.cx;
  fc.edges.forEach(e => {
    const y1 = e.from.y + e.from.h, y2 = e.to.y;
    out.push(`<path d="M${cx},${y1} V${y2}" ${edgeAttr} ${arrow}/>`);
    if (e.label) out.push(`<text x="${cx + 8}" y="${y1 + 15}" font-size="12" ${labelAttr}>${e.label}</text>`);
  });
  fc.loops.forEach(l => {
    const y1 = l.from.y + l.from.h / 2, y2 = l.to.y + l.to.h / 2;
    const x1 = l.from.x + l.from.w, x2 = l.to.x + l.to.w;
    out.push(`<path d="${roundedPath([{ x: x1, y: y1 }, { x: l.x, y: y1 }, { x: l.x, y: y2 }, { x: x2, y: y2 }])}" ${edgeAttr} ${arrow}/>`);
    out.push(`<text x="${x1 + 6}" y="${y1 - 6}" font-size="12" ${labelAttr}>${l.label}</text>`);
  });
  (fc.jumps || []).forEach(j => {
    const y1 = j.from.y + j.from.h / 2, y2 = j.to.y + j.to.h / 2;
    out.push(`<path d="${roundedPath([{ x: j.from.x, y: y1 }, { x: j.x, y: y1 }, { x: j.x, y: y2 }, { x: j.to.x, y: y2 }])}" ${edgeAttr} ${arrow}/>`);
    if (j.label) out.push(`<text x="${j.from.x - 6}" y="${y1 - 6}" font-size="12" text-anchor="end" ${labelAttr}>${j.label}</text>`);
  });

  fc.nodes.forEach(n => {
    const [fill, stroke] = FLOW_COLORS[n.shape];
    const attr = paint("fc-" + n.shape, fill, stroke);
    if (n.shape === "term") out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2}" ${attr} stroke-width="1.5"/>`);
    else if (n.shape === "proc") out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="3" ${attr} stroke-width="1.5"/>`);
    else if (n.shape === "io") {
      const s = 12;
      out.push(`<polygon points="${n.x + s},${n.y} ${n.x + n.w},${n.y} ${n.x + n.w - s},${n.y + n.h} ${n.x},${n.y + n.h}" ${attr} stroke-width="1.5"/>`);
    } else {
      const mx = n.x + n.w / 2, my = n.y + n.h / 2;
      out.push(`<polygon points="${mx},${n.y} ${n.x + n.w},${my} ${mx},${n.y + n.h} ${n.x},${my}" ${attr} stroke-width="1.5"/>`);
    }
    // Text lines, vertically centred; sub/superscripts shift with dy
    let ty = n.y + (n.h - n.textH) / 2;
    n.textLines.forEach(line => {
      const lh = line.small ? 16 : 19;
      ty += lh;
      let shift = 0;
      const spans = line.runs.map(r => {
        const target = r.s === "sub" ? 4 : r.s === "sup" ? -6 : 0;
        const f = runFont(r, line.small);
        const span = `<tspan dy="${target - shift}" font-size="${f.size}"${r.s === "i" ? ` font-style="italic"` : ""}>${escapeHtml(r.t)}</tspan>`;
        shift = target;
        return span;
      }).join("");
      out.push(`<text x="${n.x + n.w / 2}" y="${ty - (line.small ? 4 : 5)}" text-anchor="middle" xml:space="preserve" ${textAttr(line.small)}>${spans}</text>`);
    });
  });
  out.push(`</svg>`);
  return out.join("\n");
}

// ---------- TikZ ----------
const TIKZ_LIBRARIES = "\\usetikzlibrary{positioning,shapes.geometric,shapes.misc,arrows.meta}";

// refTex(e) gives the equation reference, e.g. Eq.~\eqref{eq:x} in the report.
function flowTikz(fc, opts, refTex = e => `Eq.~(${e.number})`) {
  const partTex = p => (p.text !== undefined ? texText(p.text)
    : p.math !== undefined ? `$${p.math}$`
    : [opts.numbers && refTex(p.ref), opts.titles && texText(p.ref.title)].filter(Boolean).join(" \\textperiodcentered{} "));
  const label = n => n.lines.map(l => {
    const t = l.parts.map(partTex).join("");
    return l.small ? `{\\footnotesize ${t}}` : t;
  }).filter(Boolean).join(" \\\\ ");
  const out = [
    `\\begin{tikzpicture}[`,
    `  node distance=6mm, >={Stealth[length=2.2mm]}, font=\\small,`,
    `  every node/.style={align=center},`,
    `  term/.style={draw, rounded rectangle, minimum height=7mm, inner xsep=5mm, fill=blue!6},`,
    `  io/.style={draw, trapezium, trapezium left angle=72, trapezium right angle=108, trapezium stretches body, minimum height=8mm, inner xsep=2mm, fill=green!6},`,
    `  proc/.style={draw, rectangle, minimum height=8mm, minimum width=30mm, inner xsep=3mm},`,
    `  dec/.style={draw, diamond, aspect=2.4, inner sep=1pt, fill=orange!8},`,
    `  lbl/.style={font=\\footnotesize, inner sep=2pt}]`
  ];
  fc.nodes.forEach((n, i) => {
    const pos = i ? `, below=of ${fc.nodes[i - 1].id}` : "";
    out.push(`  \\node[${n.shape}${pos}] (${n.id}) {${label(n)}};`);
  });
  if (fc.loops.length) {
    out.push(`  \\coordinate (E) at (current bounding box.east);`);
    [...new Set(fc.loops.map(l => l.lane))].sort().forEach(lane => out.push(`  \\coordinate (L${lane}) at ([xshift=${6 + 4 * lane}mm]E);`));
  }
  fc.edges.forEach(e => out.push(`  \\draw[->] (${e.from.id}) -- ${e.label ? `node[lbl, right] {${e.label}} ` : ""}(${e.to.id});`));
  fc.loops.forEach(l => out.push(`  \\draw[->] (${l.from.id}.east) -- node[lbl, above] {${l.label}} (${l.from.id}.east -| L${l.lane}) |- (${l.to.id}.east);`));
  if (fc.jumps && fc.jumps.length) {
    out.push(`  \\coordinate (W) at (current bounding box.west);`);
    [...new Set(fc.jumps.map(j => j.lane))].sort().forEach(lane => out.push(`  \\coordinate (J${lane}) at ([xshift=-${6 + 4 * lane}mm]W);`));
    fc.jumps.forEach(j => out.push(`  \\draw[->] (${j.from.id}.west) -- ${j.label ? `node[lbl, above] {${j.label}} ` : ""}(${j.from.id}.west -| J${j.lane}) |- (${j.to.id}.west);`));
  }
  out.push(`\\end{tikzpicture}`);
  return out.join("\n");
}

function flowTikzStandalone(tikz) {
  return [
    `% Flowchart generated by SolverMapp. Compile with pdflatex.`,
    `\\documentclass[tikz, border=4mm]{standalone}`,
    `\\usepackage[T1]{fontenc}`,
    `\\usepackage[utf8]{inputenc}`,
    `\\usepackage{lmodern}`,
    `\\usepackage{amsmath}`,
    TIKZ_LIBRARIES,
    `\\begin{document}`,
    tikz,
    `\\end{document}`
  ].join("\n");
}

// ---------- Mermaid ----------
function flowMermaid(fc, opts) {
  const partText = p => (p.text !== undefined ? p.text : p.math !== undefined ? mathPlain(p.math) : flowRefText(p.ref, opts));
  const label = n => n.lines.map(l => l.parts.map(partText).join("")).filter(Boolean).join("<br>").replace(/"/g, "#quot;");
  const shape = { term: ['(["', '"])'], io: ['[/"', '"/]'], proc: ['["', '"]'], dec: ['{"', '"}'] };
  const out = [`flowchart TD`];
  fc.nodes.forEach(n => out.push(`  ${n.id}${shape[n.shape][0]}${label(n)}${shape[n.shape][1]}`));
  fc.edges.forEach(e => out.push(`  ${e.from.id} -->${e.label ? `|${e.label}|` : ""} ${e.to.id}`));
  fc.loops.forEach(l => out.push(`  ${l.from.id} -->|${l.label}| ${l.to.id}`));
  (fc.jumps || []).forEach(j => out.push(`  ${j.from.id} -->${j.label ? `|${j.label}|` : ""} ${j.to.id}`));
  return out.join("\n");
}

// ---------- Flowchart view ----------
function renderFlowchart(opts = projectData.flowchart, model) {
  const fc = buildFlowchart(opts, model);
  const size = layoutFlowchart(fc, opts);
  return { fc, size };
}

function renderFlowView() {
  const opts = projectData.flowchart;
  const { fc, size } = renderFlowchart(opts);
  const tikz = flowTikz(fc, opts);
  flowOutput = {
    svg: flowSvg(fc, size, opts, { exportMode: true }),
    tikz, tikzStandalone: flowTikzStandalone(tikz), mermaid: flowMermaid(fc, opts),
    width: size.width, height: size.height
  };
  document.querySelectorAll("[data-flow]").forEach(el => { el.checked = !!opts[el.dataset.flow]; });
  ["diagram", "tikz", "mermaid"].forEach(v => $("flowView_" + v).classList.toggle("active", flowView === v));
  $("flowDiagram").hidden = flowView !== "diagram";
  $("flowSource").hidden = flowView === "diagram";
  $("flowCopyBtn").textContent = flowView === "mermaid" ? "Copy Mermaid" : flowView === "tikz" ? "Copy TikZ" : "Copy SVG";
  $("flowEmpty").hidden = !fc.empty;
  if (flowView === "diagram") $("flowDiagram").innerHTML = flowSvg(fc, size, opts, { idPrefix: "fcv" });
  else $("flowSource").textContent = flowView === "tikz" ? flowOutput.tikz : flowOutput.mermaid;
}

function setFlowView(view) {
  flowView = view;
  renderFlowView();
}

function copyFlow() {
  const text = flowView === "tikz" ? flowOutput.tikz : flowView === "mermaid" ? flowOutput.mermaid : flowOutput.svg;
  const btn = $("flowCopyBtn");
  const label = btn.textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = "Copied ✓";
    setTimeout(() => btn.textContent = label, 1500);
  });
}

function downloadFlow(kind) {
  if (kind === "svg") downloadText("flowchart.svg", flowOutput.svg);
  else if (kind === "tex") downloadText("flowchart.tex", flowOutput.tikzStandalone);
  else if (kind === "mmd") downloadText("flowchart.mmd", flowOutput.mermaid);
  else if (kind === "png") {
    // The exported SVG has no external fonts or images, so it can be drawn on a canvas.
    const scale = 2;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = flowOutput.width * scale;
      canvas.height = flowOutput.height * scale;
      const c = canvas.getContext("2d");
      c.scale(scale, scale);
      c.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "flowchart.png";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(flowOutput.svg);
  }
}

function bindFlowEvents() {
  document.querySelectorAll("[data-flow]").forEach(el => {
    el.addEventListener("change", () => {
      projectData.flowchart[el.dataset.flow] = el.checked;
      triggerAutoSave();
      renderFlowView();
    });
  });
}
