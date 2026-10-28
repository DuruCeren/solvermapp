// SolverMapp — Reading an equation: symbols, step suffixes, sums, integrals, ODEs, functions,
// implicit unknowns; the equation type, outputs and inputs (`detectFromLatex`).
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// SMART ARCHETYPE & SYMBOL PARSER (HANDLES y1/y0, \sum, \int)
// ================================================================
const IGNORED_LATEX_COMMANDS = new Set([
  "\\frac", "\\dfrac", "\\tfrac", "\\sqrt", "\\left", "\\right",
  "\\sin", "\\cos", "\\tan", "\\exp", "\\ln", "\\log", "\\partial",
  "\\Delta", "\\nabla", "\\sum", "\\int", "\\prod", "\\cdot", "\\times",
  "\\text", "\\mathrm", "\\mathbf", "\\mathcal", "\\bigg", "\\Big", "\\big"
]);

// Step suffixes that mark the same state variable at different steps: y_{n+1}, y_n, y_1, y_0, y_{new}, y_{old}
const RECURRENCE_SUFFIX = "_(?:\\{n\\+1\\}|\\{n-1\\}|\\{new\\}|\\{old\\}|\\{k\\+1\\}|\\{k\\}|n|0|1)";
const SUM_REGEX = /\\sum_\{?([a-zA-Z0-9]+)=([^}^]+)\}?\^\{?([^}\s]+)\}?/;
const INT_REGEX = /\\int_\{?([^}^]+)\}?\^\{?([^}\s]+)\}?/;


function normalizeRecurrenceSymbol(sym) {
  return sym.replace(new RegExp(RECURRENCE_SUFFIX + "$", "i"), "");
}

function extractSymbolsFromLatexSegment(segment, dummySet = new Set()) {
  return latexSymbols(segment).symbols.map(preferredSpelling).filter(s => !dummySet.has(s));
}

// A symbol as the project already spells it (T_\infty or T_{\infty}), so detection keeps the
// link to its unit, start value and description.
function preferredSpelling(name) {
  const known = [...Object.keys(projectData.variableMeta), ...projectData.equations.flatMap(e => [...e.inputs, ...e.outputs])];
  return known.find(k => k === name) || known.find(k => Latex.canonical(k) === name) || name;
}

// Symbols of a piece of LaTeX in order of appearance, read with the Latex module: \dot{m},
// \mathbf{x}, \mathrm{Re}, T^{n+1} and \Delta x are one symbol each; the d of dx is not one.
// calls: symbols written in function notation, \mu(T) or u(x, t), with their argument symbols.
const latexSymbolCache = new Map();
const SKIPPED_ARG_COMMANDS = new Set(["text", "textrm", "textit", "mbox", "label", "tag", "operatorname", "begin", "end"]);

// ---------- Index notation ----------
// The project declares its indices once: "i, j = 1..N; k = 1..M". On a symbol, a subscript made
// of declared indices (m_i, k_{ij}, \mathbf{r}_j, x_{i+1}) is an element (or row) of the array m,
// k, r, x; the index letters themselves are not variables. Without a declaration nothing changes.
let indexCache = { text: null, map: new Map() };

function indexRanges() {
  const text = (projectData && projectData.indices) || "";
  if (indexCache.text === text) return indexCache.map;
  const map = new Map();
  text.split(";").forEach(part => {
    const m = /^\s*([A-Za-z](?:\s*,\s*[A-Za-z])*)\s*=\s*(.+?)\s*\.\.\s*(.+?)\s*$/.exec(part);
    if (m) m[1].split(",").map(x => x.trim()).forEach(letter => map.set(letter, { from: m[2], to: m[3] }));
  });
  indexCache = { text, map };
  return map;
}

// "i", "ij", "i,j", "i+1, j", "j1" (j and column 1), "i,10" -> [{ letter, offset } | { value }],
// or null unless every letter is a declared index and there is at least one (x_1 stays a name).
function parseIndexList(content) {
  const ranges = indexRanges();
  const t = String(content).replace(/\s+/g, "");
  if (!t || !ranges.size) return null;
  const items = [];
  if (t.includes(",")) {
    for (const part of t.split(",")) {
      const m = /^(?:([A-Za-z])([+-]\d+)?|(\d+))$/.exec(part);
      if (!m) return null;
      items.push(m[3] !== undefined ? { value: +m[3] } : { letter: m[1], offset: m[2] ? +m[2] : 0 });
    }
  } else {
    const re = /([A-Za-z])([+-]\d+)?|(\d)/y;
    let m;
    while (re.lastIndex < t.length && (m = re.exec(t))) items.push(m[3] !== undefined ? { value: +m[3] } : { letter: m[1], offset: m[2] ? +m[2] : 0 });
    if (re.lastIndex !== t.length) return null;
  }
  const letters = items.filter(x => x.letter);
  if (!letters.length || items.length > 2 || !letters.every(x => ranges.has(x.letter))) return null;
  return items;
}

// x_{ij} -> { base: "x", indices: [...] } when the subscript is index notation.
function splitIndexed(name) {
  const m = /^(.+?)_(?:\{([^{}]*)\}|([A-Za-z]))$/.exec(name);
  if (!m) return null;
  const indices = parseIndexList(m[2] !== undefined ? m[2] : m[3]);
  return indices ? { base: Latex.canonical(m[1]), indices } : null;
}

function latexSymbols(segment) {
  const src = String(segment || "");
  const ranges = indexRanges();
  const key = src + "\u0000" + Object.keys(projectData.variableMeta).filter(k => projectData.variableMeta[k].size).join(",") + "\u0000" + (projectData.indices || "");
  if (latexSymbolCache.has(key)) return latexSymbolCache.get(key);
  const ctx = Latex.analyze(src);
  const T = ctx.tokens;
  const symbols = [];
  const calls = new Map();
  const indexed = new Map(); // base -> index letters used on it (m_i -> ["i"])
  let usesIndices = false;
  const add = s => { if (!symbols.includes(s)) symbols.push(s); };
  const inIntegral = /\\i+nt/.test(src);
  let i = 0;
  while (i < T.length) {
    const tok = T[i];
    if (tok.type === "cmd" && SKIPPED_ARG_COMMANDS.has(tok.value)) {
      const arg = Latex.readArg(T, i + 1, T.length);
      i = arg ? arg.next : i + 1;
      continue;
    }
    // Differentials: \frac{dy}{dt}, \,dx, and "dx" written together inside an integral
    const glued = inIntegral && tok.type === "letter" && tok.value === "d" && T[i + 1] && T[i + 1].type === "letter" && T[i + 1].start === tok.end;
    if (Latex.isDifferential(ctx, i) || glued) {
      const s = Latex.readSymbol(ctx, i + 1, T.length);
      i = s ? s.next : i + 1;
      continue;
    }
    const s = (Latex.isSymbolStart(tok) || (Latex.isChar(tok, "{") && !ctx.openers.has(i))) && Latex.readSymbol(ctx, i, T.length);
    if (!s) { i++; continue; }
    let next = s.next;
    if (s.name && ranges.has(s.name)) { usesIndices = true; i = next; continue; } // an index letter: a number, not a variable
    if (s.name) {
      let name = Latex.canonical(s.name);
      const ix = splitIndexed(name);
      if (ix) {
        name = ix.base;
        usesIndices = true;
        const letters = ix.indices.map(x => x.letter || String(x.value));
        if (!indexed.has(name) || indexed.get(name).length < letters.length) indexed.set(name, letters);
      }
      add(name);
      const args = callArguments(ctx, s.next);
      if (args && !calls.has(name)) calls.set(name, args);
      // A^T on a vector or matrix is a transpose: T is not a symbol there
      const sup = Latex.isChar(T[next], "^") && Latex.readArg(T, next + 1, T.length);
      if (sup) {
        const t = Latex.sliceSrc(T, src, sup.innerFrom, sup.innerTo).replace(/\s+/g, "");
        if (/^\\(?:top|intercal)$|^\\math(?:sf|rm)\{T\}$/.test(t) || (t === "T" && (looksNonScalar(name) || isNonScalarSymbol(name)))) next = sup.next;
      }
    }
    i = next;
  }
  const result = { symbols, calls, indexed, usesIndices };
  latexSymbolCache.set(key, result);
  return result;
}

// "(T)" or "\left(x, t\right)" after a symbol: the argument symbols, or null when it is not
// an argument list of plain symbols (p(v - b) is a product).
function callArguments(ctx, i) {
  const T = ctx.tokens;
  let j = i;
  if (T[j] && T[j].type === "cmd" && T[j].value === "left") j++;
  if (!Latex.isChar(T[j], "(")) return null;
  j++;
  const args = [];
  while (j < T.length) {
    const s = Latex.readSymbol(ctx, j, T.length);
    if (!s || !s.name) return null;
    args.push(Latex.canonical(s.name));
    j = s.next;
    if (T[j] && T[j].type === "cmd" && T[j].value === "right") j++;
    if (Latex.isChar(T[j], ")")) return args;
    if (!Latex.isChar(T[j], ",")) return null;
    j++;
  }
  return null;
}

// ---------- Derivatives (ODE cards) ----------
// A brace group {…} (balanced), a command \alpha or one character, starting at s[i] (spaces skipped).
function readTexArg(s, i) {
  while (s[i] === " ") i++;
  if (s[i] === "{") {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) return { inner: s.slice(i + 1, j), raw: s.slice(i, j + 1), end: j + 1 };
    }
    return null;
  }
  const m = /^\\[A-Za-z]+|^[^\s{}\\]/.exec(s.slice(i));
  return m ? { inner: m[0], raw: m[0], end: i + m[0].length } : null;
}

const D_TEX = String.raw`(?:\\mathrm\s*\{\s*d\s*\}|d)`;
const DERIV_NUM = new RegExp(String.raw`^\s*${D_TEX}\s*(?:\^\s*(?:\{\s*(\d+)\s*\}|(\d)))?\s*(\S[\s\S]*?)\s*$`);
const DERIV_DEN = new RegExp(String.raw`^\s*${D_TEX}\s*([\s\S]+?)\s*(?:\^\s*(?:\{\s*(\d+)\s*\}|(\d)))?\s*$`);

// A derivative starting at s[i] (a backslash): \frac{d^n y}{dt^n} (also \dfrac, \tfrac, \mathrm{d}) or
// \ddot{y}_i (time derivative, order 2; \dot{y} stays a name: \dot{m} is a mass flow).
// { start, end, order, depTex (y with its subscript), indTex (t, or null for \ddot) } or null.
function derivativeAt(s, i) {
  const rest = s.slice(i);
  if (/^\\[dt]?frac(?![A-Za-z])/.test(rest)) {
    const a = readTexArg(s, i + rest.match(/^\\[dt]?frac/)[0].length);
    const b = a && readTexArg(s, a.end);
    const num = a && DERIV_NUM.exec(a.inner), den = b && DERIV_DEN.exec(b.inner);
    if (!num || !den || a.raw[0] !== "{" || b.raw[0] !== "{") return null;
    const order = +(num[1] || num[2] || 1), denOrder = +(den[2] || den[3] || 1);
    return { start: i, end: b.end, order: order === denOrder ? order : -1, depTex: num[3], indTex: den[1] };
  }
  const dots = /^\\(d{2,3})ot(?![A-Za-z])/.exec(rest);
  if (dots) {
    const g = readTexArg(s, i + dots[0].length);
    if (!g) return null;
    let end = g.end, sub = "";
    let k = end;
    while (s[k] === " ") k++;
    if (s[k] === "_") { const a = readTexArg(s, k + 1); if (a) { sub = "_" + a.raw; end = a.end; } }
    return { start: i, end, order: dots[1].length, depTex: g.inner + sub, indTex: null };
  }
  return null;
}

// Derivatives outside braces (so the coefficient \frac{1}{2} or a subscript is not searched).
function topLevelDerivatives(s) {
  const found = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") depth--;
    else if (s[i] === "\\" && depth === 0) {
      const d = derivativeAt(s, i);
      if (d) { found.push(d); i = d.end - 1; }
    }
  }
  return found;
}

// The left side of an ODE: \frac{dy}{dt}, \frac{d^2 y}{dt^2} or \ddot{y}, alone or times a coefficient
// (m \frac{d^2x}{dt^2}, \rho c_p \frac{dT}{dt}). { dependent, independent (null: from the settings),
// indices, order, coeff (LaTeX, "" for none), depTex } or null.
function odeLeftSide(lhs) {
  const found = topLevelDerivatives(lhs);
  if (found.length !== 1) return null;
  const d = found[0];
  if (d.order !== 1 && d.order !== 2) return null;
  const depInfo = latexSymbols(d.depTex);
  const dep = depInfo.symbols, ind = d.indTex ? latexSymbols(d.indTex).symbols : null;
  if (dep.length !== 1 || (ind && ind.length !== 1)) return null;
  let coeff = (lhs.slice(0, d.start) + " " + lhs.slice(d.end))
    .replace(/^(?:\s|\\[,;!:]|\\cdot|\\times|\*)+|(?:\s|\\[,;!:]|\\cdot|\\times|\*)+$/g, "").trim();
  if (coeff === "-") coeff = "-1";
  if (coeff === "+") coeff = "";
  if (coeff) {
    // a product only: no sums at the top level (a leading sign is fine)
    let depth = 0;
    for (let k = 0; k < coeff.length; k++) {
      const c = coeff[k];
      if (c === "{" || c === "(") depth++;
      else if (c === "}" || c === ")") depth--;
      else if (depth === 0 && k > 0 && (c === "+" || c === "-") && !/\\left$|\^$|_$/.test(coeff.slice(0, k).trimEnd())) return null;
    }
    if (/\\(?:left|right)\b/.test(coeff) && !/\\left\s*\(/.test(coeff)) return null;
  }
  return {
    dependent: preferredSpelling(dep[0]), independent: ind ? preferredSpelling(ind[0]) : null,
    indices: depInfo.indexed.get(dep[0]) || [], order: d.order, coeff, depTex: d.depTex.trim()
  };
}

// The order of an ODE card (1 or 2); 1 for anything else.
function odeOrder(eq) {
  if (!eq || eq.archetype !== "ode") return 1;
  const o = odeLeftSide((eq.latex || "").split("=")[0] || "");
  return o ? o.order : 1;
}

// The rate of a second-order state: x -> \dot{x}, \mathbf{r}_i -> \dot{\mathbf{r}}_i (an index stays outside).
function rateTex(depTex) {
  const t = String(depTex).trim();
  const m = /^([\s\S]*?)(_(?:\{([^{}]*)\}|([A-Za-z0-9])))$/.exec(t);
  if (m && m[1] && parseIndexList(m[3] !== undefined ? m[3] : m[4])) return `\\dot{${m[1]}}${m[2]}`;
  return `\\dot{${t}}`;
}

function rateSymbol(depTex) {
  const sym = latexSymbols(rateTex(depTex)).symbols;
  return sym.length === 1 ? preferredSpelling(sym[0]) : null;
}

// dx/dt on the right side of a second-order ODE is the rate state: \frac{dx}{dt} -> \dot{x}.
function rhsWithRates(rhs, independent) {
  let out = "";
  for (let i = 0; i < rhs.length; i++) {
    if (rhs[i] === "\\") {
      const d = derivativeAt(rhs, i);
      const ind = d && d.indTex && latexSymbols(d.indTex).symbols;
      if (d && d.order === 1 && ind && ind.length === 1 && preferredSpelling(ind[0]) === independent) {
        out += ` ${rateTex(d.depTex)} `;
        i = d.end - 1;
        continue;
      }
    }
    out += rhs[i];
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([}),])/g, "$1").trim();
}

// An ODE card as first-order equations, the form every solver integrates: a card with a coefficient
// becomes dy/dt = (rhs) / coeff; a second-order card m x'' = F becomes the pair
// dx/dt = \dot{x} and d\dot{x}/dt = F / m (states x and \dot{x}). Other cards are returned as they are.
function firstOrderOdes(eq) {
  const [lhs, ...rest] = (eq.latex || "").split("=");
  const ode = odeLeftSide(lhs || "");
  if (!ode || (ode.order === 1 && !ode.coeff)) return [eq];
  const t = odeVariables(eq).independent;
  let rhs = rest.join("=").trim() || "0";
  if (ode.order === 2) rhs = rhsWithRates(rhs, t);
  if (ode.coeff === "-1") rhs = `-\\left(${rhs}\\right)`;
  else if (ode.coeff) rhs = `\\frac{${rhs}}{${ode.coeff}}`;
  const symbols = [...new Set([...eq.inputs, ...eq.outputs])];
  const part = (suffix, latex, output) => ({ ...eq, id: `${eq.id}~${suffix}`, card: eq, latex, outputs: [output], inputs: symbols });
  if (ode.order === 1) return [part("1", `\\frac{d${ode.depTex}}{d${t}} = ${rhs}`, eq.outputs[0] || ode.dependent)];
  const v = rateTex(ode.depTex);
  const vSym = eq.outputs[1] || rateSymbol(ode.depTex);
  return [
    part("x", `\\frac{d${ode.depTex}}{d${t}} = ${v}`, eq.outputs[0] || ode.dependent),
    part("v", `\\frac{d${v}}{d${t}} = ${rhs}`, vSym)
  ];
}

// Unit of a rate: m and s -> m/s; kg m^-3 and s -> (kg m^-3)/s.
function rateUnit(unit, per) {
  const simple = u => /^[^\s/()·*]+$/.test(u);
  const den = simple(per) ? per : `(${per})`;
  if (unit === "1" || unit === "-") return `1/${den}`;
  return `${simple(unit) ? unit : `(${unit})`}/${den}`;
}

// A new rate state gets a start value, unit, size and description from its state, once.
function prefillRateMeta(x, v, t) {
  if (!x || !v) return;
  const meta = projectData.variableMeta;
  const mx = meta[x] || {}, mt = meta[t] || {};
  const mv = meta[v] || (meta[v] = { initVal: "0" });
  if (!mv.desc) mv.desc = mx.desc ? `Rate of change of ${mx.desc.charAt(0).toLowerCase()}${mx.desc.slice(1)}` : `Rate of change of ${codeOf(x)}`;
  if (!mv.units && mx.units && mt.units) mv.units = rateUnit(mx.units.trim(), mt.units.trim());
  if (!mv.size && mx.size) mv.size = mx.size;
}

// Why an equation with a derivative is not read as an ODE, or "".
function derivativeHint(eq) {
  const latex = eq.latex || "";
  if (eq.archetype === "ode") return "";
  const all = [];
  for (let i = 0; i < latex.length; i++) {
    if (latex[i] !== "\\") continue;
    const d = derivativeAt(latex, i);
    if (d) { all.push(d); i = d.end - 1; }
  }
  if (!all.length) return "";
  if (all.some(d => d.order > 2 || d.order < 0)) {
    return `Derivatives above second order are not solved. Write it as a chain of lower-order cards: for ${renderMath("\\frac{d^3x}{dt^3} = f")}, one card ${renderMath("\\frac{dx}{dt} = w")} and one card ${renderMath("\\frac{d^2w}{dt^2} = f")}.`;
  }
  const lhsOnly = topLevelDerivatives(latex.split("=")[0] || "").length;
  if (!lhsOnly) {
    return `A derivative on the right side is not computed here. To use the rate of a second-order state, write ${renderMath("\\dot{x}")}; for an ODE, put the derivative on the left.`;
  }
  return `Not read as an ODE: put the derivative alone on the left, or times a coefficient, for example ${renderMath("m \\frac{d^2x}{dt^2} = -k x - c \\frac{dx}{dt}")}.`;
}

// \mu(T) or f(x, y) as the whole left side: { name, args }.
function functionLeftSide(lhs) {
  const { symbols, calls } = latexSymbols(lhs);
  const name = symbols[0];
  const args = name && calls.get(name);
  if (!args || symbols.length !== 1 + args.filter(a => a !== name).length) return null;
  if (/[-+*/^]/.test(lhs.replace(/_\{[^}]*\}|_./g, ""))) return null;
  return { name: preferredSpelling(name), args: args.map(preferredSpelling) };
}

// Reads a LaTeX equation and returns its type, loop settings, outputs and inputs.
function detectFromLatex(latex) {
  const result = { archetype: "explicit", loopMeta: "", outputs: [], inputs: [] };
  if (!latex) return result;

  // 0. Function definition \mu(T) = ..., or an ODE: dy/dt = ..., m d^2x/dt^2 = ... (states x and \dot{x})
  const sides = latex.split("=");
  if (sides.length === 2) {
    const fn = functionLeftSide(sides[0]);
    if (fn) {
      return { archetype: "function", loopMeta: "", outputs: [fn.name],
        inputs: latexSymbols(sides[1]).symbols.filter(s => s !== fn.name && !fn.args.includes(s)) };
    }
    const ode = odeLeftSide(sides[0]);
    if (ode) {
      const ind = ode.independent || "t";
      const rhs = latexSymbols(ode.order === 2 ? rhsWithRates(sides[1], ind) : sides[1]).symbols;
      const coeff = ode.coeff ? latexSymbols(ode.coeff).symbols : [];
      const rate = ode.order === 2 ? rateSymbol(ode.depTex) : null;
      return { archetype: "ode", order: ode.order, loopMeta: odeDefaultSettings(ind), outputs: rate ? [ode.dependent, rate] : [ode.dependent],
        inputs: [...new Set([...coeff, ...rhs, ind])] };
    }
  }

  const dummyVars = new Set();

  // 1. Summation: \sum_{i=1}^{N} (with declared indices, sums are part of the expression instead)
  if (latex.includes("\\sum") && !latexSymbols(latex).usesIndices) {
    result.archetype = "summation";
    const m = latex.match(SUM_REGEX);
    if (m) {
      dummyVars.add(m[1]); // the index i is local to the sum, not an input
      result.loopMeta = `${m[1]} = ${m[2]}..${m[3]}`;
    } else {
      result.loopMeta = "i = 1..N";
    }
  }

  // 2. Integral: \int_{a}^{b} ... dx
  if (latex.includes("\\int")) {
    result.archetype = "integral";
    const diff = latex.match(/d([a-zA-Z])\b/);
    if (diff) { dummyVars.add("d" + diff[1]); dummyVars.add(diff[1]); }
    const m = latex.match(INT_REGEX);
    result.loopMeta = m ? `bounds = [${m[1]}, ${m[2]}]` : "Trapezoidal quadrature";
  }

  // 3. Recurrence: marching (y_{n+1} = y_n) or convergence (y_{new} = y_{old})
  const isConvergencePattern = /_\{?(new|old|k\+1)\}?\b/i.test(latex);
  const isMarchingPattern = /_\{?(n\+1|n|1|0)\}?\b/i.test(latex) && latex.includes("=");

  if (isConvergencePattern) {
    result.archetype = "convergence";
    result.loopMeta = "tol = 1e-6, max_iter = 500";
  } else if (isMarchingPattern && result.archetype === "explicit") {
    const parts = latex.split("=");
    const lhsRaw = extractSymbolsFromLatexSegment(parts[0]);
    const rhsRaw = extractSymbolsFromLatexSegment(parts[1]);
    // y_{n+1} = y_n + 1 marches; F = F_0 sin(w t) does not (no step suffix on the left)
    if (lhsRaw.length > 0 && normalizeRecurrenceSymbol(lhsRaw[0]) !== lhsRaw[0]) {
      const baseLhs = normalizeRecurrenceSymbol(lhsRaw[0]);
      if (rhsRaw.some(r => normalizeRecurrenceSymbol(r) === baseLhs && r !== lhsRaw[0])) {
        result.archetype = "marching";
        result.loopMeta = "N_steps = 100";
      }
    }
  }

  if (latex.includes("=")) {
    const parts = latex.split("=");
    let lhsVars = extractSymbolsFromLatexSegment(parts[0], dummyVars);
    let rhsVars = extractSymbolsFromLatexSegment(parts.slice(1).join("="), dummyVars);

    // 4. Implicit: the unknown can't be read off a bare left side (x = \cos x, c^2 = a^2 + b^2, ... = 0)
    if (result.archetype === "explicit" && parts.length === 2) {
      const unknown = implicitUnknown(parts[0], parts[1], lhsVars, rhsVars);
      if (unknown) {
        result.archetype = "implicit";
        result.loopMeta = LOOP_META_DEFAULTS.implicit;
        result.outputs = [unknown];
        result.inputs = [...new Set([...lhsVars, ...rhsVars])].filter(s => s !== unknown);
        return result;
      }
    }

    if (result.archetype === "marching" || result.archetype === "convergence") {
      // Only the state variable itself is collapsed (y_n -> y); other symbols like x_1 keep their subscript.
      lhsVars = [...new Set(lhsVars.map(normalizeRecurrenceSymbol))];
      rhsVars = [...new Set(rhsVars.map(r => lhsVars.includes(normalizeRecurrenceSymbol(r)) ? normalizeRecurrenceSymbol(r) : r))];
    } else {
      rhsVars = rhsVars.filter(v => !lhsVars.includes(v));
    }
    result.outputs = lhsVars;
    result.inputs = rhsVars;
  } else {
    result.inputs = extractSymbolsFromLatexSegment(latex, dummyVars);
  }
  return result;
}

// The unknown of an implicit equation, or null when the equation is explicit.
// Implicit: a left-side symbol also appears on the right (f in Colebrook), the left side is an
// expression (operators, powers, functions) rather than one symbol, or the left side is a number.
// The unknown is the symbol on both sides, else the one used most often (v in van der Waals),
// and on a tie the last factor (u in K u = F, x in A x = b).
function implicitUnknown(lhs, rhs, lhsVars, rhsVars) {
  if (/\\frac\s*\{\s*d|\\d{2,3}ot\b|\\partial|\\sum|\\int/.test(lhs)) return null; // derivatives, sums and integrals are not roots
  const both = lhsVars.filter(s => rhsVars.includes(s));
  if (both.length) return both[0];
  const bare = lhs.replace(/_\{[^}]*\}/g, "").replace(/\\left|\\right/g, "");
  const isExpression = /[-+^*/()]|\\(?:frac|dfrac|tfrac|sqrt|cdot|times|odot|circ|otimes|exp|ln|log|sin|cos|tan)(?![A-Za-z])/.test(bare);
  const isNumberSide = t => /^\s*[-+]?\d*\.?\d+\s*$/.test(t);
  let side = null;
  if (isNumberSide(lhs) && rhsVars.length) side = rhs;
  else if ((isExpression || lhsVars.length > 1) && lhsVars.length) side = lhs;
  if (!side) return null;
  const candidates = side === lhs ? lhsVars : rhsVars;
  const text = normalizeSubscripts(side);
  const count = s => (text.match(new RegExp("(?<![A-Za-z\\\\])" + escapeRegex(normalizeSubscripts(s)) + "(?![A-Za-z_])", "g")) || []).length;
  return candidates.reduce((best, s) => (count(s) >= count(best) ? s : best), candidates[0]);
}

// One spelling for subscripts: x_{1} -> x_1, T_{\infty} -> T_\infty
const normalizeSubscripts = s => String(s).replace(/_\{\s*([\p{L}0-9]|\\[A-Za-z]+)\s*\}/gu, "_$1");

const LOOP_META_DEFAULTS = {
  marching: "N_steps = 100",
  convergence: "tol = 1e-6, max_iter = 500",
  summation: "i = 1..N",
  integral: "Trapezoidal rule",
  implicit: "method = newton, tol = 1e-10, max_iter = 50",
  ode: "t = 0..10, steps = 100, method = rk4"
};

function odeDefaultSettings(independent) {
  return `${independent} = 0..10, steps = 100, method = rk4`;
}
