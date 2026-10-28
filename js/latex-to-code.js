// SolverMapp — LaTeX to neutral code (`latexToCode`): products, fractions, functions, vectors,
// index notation and sums; `Expr` (evaluate.js) turns it into Python, MATLAB and Fortran.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// LATEX -> CODE
// ================================================================
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Converts a LaTeX right-hand side into a code expression.
// Known variables are replaced by nameOf(sym) (the code name, or an array element in a sum);
// only the state variable of a marching/convergence loop has its step suffix (y_n, y_{old})
// collapsed, so x_1 stays x_1.
function latexRhsToCodeDraft(eq, nameOf = codeOf) {
  const latexStr = eq.latex || "";
  if (!latexStr.includes("=")) return "0.0";
  let rhs = latexStr.split("=").slice(1).join("=").trim();
  // Remove \sum_{...}^{...} (the summation type loops itself) or \int_{...}^{...} and dx
  if (eq.archetype === "summation") rhs = rhs.replace(/\\sum_\{?[^}^]+\}?\^\{?[^}\s]+\}?/g, "");
  if (eq.archetype === "integral") rhs = rhs.replace(/\\int_\{?[^}^]+\}?\^\{?[^}\s]+\}?/g, "").replace(/\\,?\s*d[a-zA-Z]\b/g, "");
  const isLoop = eq.archetype === "marching" || eq.archetype === "convergence";
  return latexToCode(rhs, [...eq.inputs, ...eq.outputs], nameOf, isLoop ? eq.outputs : [], { active: new Set(freeIndices(eq)) }) || "1.0";
}

// Residual of an implicit equation, left side - right side, as a code expression.
function residualCode(eq, nameOf = codeOf) {
  const [lhs, rhs] = (eq.latex || "").split("=").map(side => latexToCode(side || "", [...eq.inputs, ...eq.outputs], nameOf) || "0");
  if (rhs === "0") return lhs;
  if (lhs === "0") return `-(${rhs})`;
  return `${lhs} - (${rhs})`;
}

// \frac{a}{b}, \sqrt{a}, \sqrt[n]{a}, x^{a+b} and other {groups}, nested to any depth.
function texGroupsToCode(s) {
  const group = i => { // s[i] === "{": [inner, index after the closing brace]
    for (let depth = 0, j = i; j < s.length; j++) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) return [s.slice(i + 1, j), j + 1];
    }
    return [s.slice(i + 1), s.length];
  };
  const simple = t => /^(?:\u0001\d+\u0002|[A-Za-z_]\w*|\d+(?:\.\d+)?)$/.test(t.trim());
  let out = "";
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = /^\\[dt]?frac\s*(?=\{)/.exec(rest))) {
      const [a, j] = group(i + m[0].length);
      const k = s.slice(j).match(/^\s*/)[0].length + j;
      const [b, end] = s[k] === "{" ? group(k) : [s[k] || "1", k + 1];
      out += `((${texGroupsToCode(a)}) / (${texGroupsToCode(b)}))`;
      i = end;
    } else if ((m = /^\\sqrt\s*(?:\[([^\]]+)\])?\s*(?=\{)/.exec(rest))) {
      const [a, end] = group(i + m[0].length);
      out += m[1] ? `(${texGroupsToCode(a)})^(1 / (${texGroupsToCode(m[1])}))` : `sqrt(${texGroupsToCode(a)})`;
      i = end;
    } else if ((m = /^\^\s*(?=\{)/.exec(rest))) {
      const [a, end] = group(i + m[0].length);
      const inner = texGroupsToCode(a);
      out += simple(inner) ? `^${inner.trim()}` : `^(${inner})`;
      i = end;
    } else if (s[i] === "{") {
      const [a, end] = group(i);
      out += texGroupsToCode(a);
      i = end;
    } else {
      out += s[i++];
    }
  }
  return out;
}

// Converts a piece of LaTeX into a code expression (Python syntax: ** for powers).
// `symbols` are replaced by nameOf(sym) (the code name, or an array element in a sum);
// for the symbols in `collapse` (the state variable of a marching/convergence loop) the step
// suffix (y_n, y_{old}) is dropped too, so x_1 stays x_1.
//
// Vectors and matrices: \cdot, \times and \odot become the markers · × ⊙ and a transpose
// (^T, ^\top) the marker ᵀ, for Expr to read; \|x\| is norm(x) and |x| abs(x).
// Functions: \mu(T) becomes mu(T), and a bare \mu becomes mu(T) with its declared arguments;
// an ODE state written y(t) is just y.
//
// Index notation (declared indices): sums become isum(j, lo, hi, cond, body) and indexed symbols
// at(x, i, j); opts.active are the indices already bound (free indices of the equation, outer sums).
function latexToCode(tex, symbols, nameOf = codeOf, collapse = [], opts = {}) {
  const fns = callableMap();
  const calls = latexSymbols(tex).calls;
  const held = []; // __n__ placeholders: sums and indexed symbols, written back at the end
  let code = normalizeSubscripts(tex)
    .replace(/\\(mathbf|boldsymbol|bm|vec|hat|bar|dot|tilde|underline)\s+([A-Za-z])/g, "\\$1{$2}")
    .replace(/\\log_\{?10\}?/g, "\\logten ")
    .replace(/\\left\s*\\\|([\s\S]*?)\\right\s*\\\|/g, "\\normfn($1)")
    .replace(/\\(?:left\s*\\)?lVert([\s\S]*?)\\(?:right\s*\\)?rVert/g, "\\normfn($1)")
    .replace(/\\\|([\s\S]*?)\\\|/g, "\\normfn($1)")
    .replace(/\\left\s*\|([\s\S]*?)\\right\s*\|/g, "\\absfn($1)")
    .replace(/\|([^|]+)\|/g, "\\absfn($1)")
    .replace(/\^\s*(?:\{\s*)?(?:\\top|\\intercal|\\mathsf\s*\{\s*T\s*\}|\\mathrm\s*\{\s*T\s*\})(?:\s*\})?/g, " ᵀ ");
  code = indexNotationPass(code, symbols, opts.active || new Set(), held);
  // Not inside a longer name; a letter that is itself a superscript (u^T K) may come before.
  const NOT_AFTER = "(?<!\\\\|(?<!\\^)[A-Za-z])";
  const symRe = sym => NOT_AFTER + escapeRegex(normalizeSubscripts(sym)) + "(?![_A-Za-z])";
  const ARGS = "\\s*(?:\\\\left\\s*)?\\(([^()]*?)(?:\\\\right\\s*)?\\)";

  // Functions: calls keep (or get) their arguments
  const fnNames = [];
  const argSymbols = [];
  [...fns.keys()].sort((a, b) => b.length - a.length).forEach(sym => {
    const mark = () => { fnNames.push(codeOf(sym)); return `\u0003${fnNames.length - 1}\u0004`; };
    code = code.replace(new RegExp(symRe(sym) + ARGS, "g"), (m, inner) => `${mark()}(${inner})`);
    code = code.replace(new RegExp(symRe(sym), "g"), () => `${mark()}(${fns.get(sym).join(", ")})`);
    argSymbols.push(...fns.get(sym));
  });
  // Dependent variables written with their arguments, y(t): the value itself
  calls.forEach((args, sym) => {
    if (!fns.has(preferredSpelling(sym))) code = code.replace(new RegExp("(" + symRe(sym) + ")" + ARGS, "g"), "$1");
  });

  const names = [];
  const symAt = [];
  [...new Set([...symbols, ...argSymbols])]
    .filter(sym => !fns.has(sym))
    .sort((a, b) => b.length - a.length)
    .forEach(sym => {
      const tail = (collapse.includes(sym) ? `(?:${RECURRENCE_SUFFIX})?` : "") + "(?![_A-Za-z])";
      const re = new RegExp(NOT_AFTER + escapeRegex(normalizeSubscripts(sym)) + tail, "g");
      code = code.replace(re, () => { names.push(nameOf(sym)); symAt.push(sym); return ` \u0001${names.length - 1}\u0002 `; });
    });
  // A^T: transpose when the base is a vector or matrix, or T is not a variable here
  code = code.replace(/(\u0001(\d+)\u0002|\))\s*\^\s*(?:\{\s*)?(?:(T)(?![A-Za-z_\d])|\u0001(\d+)\u0002)(?:\s*\})?/g, (m, base, bk, letter, tk) => {
    if (letter || (symAt[tk] === "T" && bk !== undefined && isNonScalarSymbol(symAt[bk]))) return `${base} ᵀ `;
    return m;
  });

  code = texGroupsToCode(code
    .replace(/\\left|\\right/g, "")
    .replace(/\\(?:mathrm|mathit|text|operatorname)\s*(?=\{)/g, ""))
    .replace(/\\cdot(?![A-Za-z])/g, " · ")
    .replace(/\\times(?![A-Za-z])/g, " × ")
    .replace(/\\(?:odot|circ)(?![A-Za-z])/g, " ⊙ ")
    .replace(/\\normfn/g, "norm")
    .replace(/\\absfn/g, "abs")
    .replace(/\\logten/g, "log10")
    .replace(/\\ln(?![A-Za-z])/g, "log")
    .replace(/\\infty/g, "inf")
    .replace(/\\[,;!: ]/g, " ")
    .replace(/\\/g, "")
    .replace(/[{}]/g, "")
    .replace(/\^/g, "**")
    .replace(/\)\s*\(/g, ") (")
    .replace(/(?<![\w.])(\d+(?:\.\d+)?)\(/g, "$1 (")
    .replace(/\u0001(\d+)\u0002/g, (_, i) => names[i])
    .replace(/\u0003(\d+)\u0004/g, (_, i) => fnNames[i])
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s*\*\*\s*/g, "**").replace(/\s+ᵀ/g, "ᵀ")
    .trim();

  // Implicit multiplication: "0.5 T" -> "0.5 * T", "2 (a + b)" -> "2 * (a + b)", "f[i - 1] x"
  const FUNCS = new Set(["sqrt", "sin", "cos", "tan", "exp", "log", "log10", "norm", "abs"]);
  return code.replace(/([A-Za-z_]\w*|\d+(?:\.\d+)?|\)|\]|ᵀ)\s+(?=[A-Za-z_(\d])/g,
    (m, w, at, all) => (FUNCS.has(w) ? (all[at + m.length] === "(" ? w : w + " ") : w + " * "))
    // A function applied to one operand without parentheses: "cos x" -> "cos(x)"
    .replace(/\b(sqrt|sin|cos|tan|exp|log|log10) ([A-Za-z_]\w*(?:\[[^\]]*\])?|\d+(?:\.\d+)?)/g, "$1($2)")
    .replace(/__(\d+)__/g, (m, k) => held[k]);
}

// A bound of an index range or a sum (1, N, M + 1) as neutral code.
function rangeCode(text) {
  const t = String(text).trim();
  if (isNumber(t)) return t;
  return latexToCode(t, [...new Set([...indexRangeSymbols(), ...projectData.equations.flatMap(e => [...e.inputs, ...e.outputs])])]);
}

// Sums and indexed symbols of index notation, kept as __n__ placeholders (letter-free, so the
// symbol pass does not touch them). A sum covers the term after it, up to the next + or -.
function indexNotationPass(code, symbols, active, held) {
  const ranges = indexRanges();
  if (!ranges.size) return code;
  const hold = text => { held.push(text); return ` __${held.length - 1}__ `; };

  // 1. Sums
  let out = "";
  let i = 0;
  while (i < code.length) {
    const m = /^\\sum(?![A-Za-z])\s*(?:\\limits\s*)?/.exec(code.slice(i));
    if (!m) { out += code[i++]; continue; }
    let j = i + m[0].length;
    const readScript = () => {
      while (code[j] === " ") j++;
      if (code[j] === "{") {
        let depth = 0, k = j;
        for (; k < code.length; k++) {
          if (code[k] === "{") depth++;
          else if (code[k] === "}" && --depth === 0) break;
        }
        const inner = code.slice(j + 1, k);
        j = k + 1;
        return inner;
      }
      const cmd = /^\\[A-Za-z]+/.exec(code.slice(j));
      if (cmd) { j += cmd[0].length; return cmd[0]; }
      return code[j++] || "";
    };
    let sub = null, sup = null;
    for (let pass = 0; pass < 2; pass++) {
      while (code[j] === " ") j++;
      if (code[j] === "_" && sub === null) { j++; sub = readScript(); }
      else if (code[j] === "^" && sup === null) { j++; sup = readScript(); }
    }
    const loops = sumLoops(sub, sup, active);
    if (!loops) { out += code.slice(i, j); i = j; continue; } // not index notation: left as it was
    const end = sumBodyEnd(code, j);
    const inner = new Set([...active, ...loops.map(l => l.letter)]);
    let body = `(${latexToCode(code.slice(j, end), symbols, codeOf, [], { active: inner })})`;
    for (const l of [...loops].reverse()) body = `isum(${l.letter}, ${l.lo}, ${l.hi}, ${l.cond || "1"}, ${body})`;
    out += hold(body);
    i = end;
  }
  code = out;

  // 2. Indexed symbols: m_i -> at(m, i), k_{ij} -> at(k, i, j), x_{i+1} -> at(x, i + 1)
  const NOT_AFTER = "(?<!\\\\|(?<!\\^)[A-Za-z])";
  [...new Set(symbols)].sort((a, b) => b.length - a.length).forEach(sym => {
    const re = new RegExp(NOT_AFTER + escapeRegex(normalizeSubscripts(sym)) + "_(?:\\{([^{}]*)\\}|([A-Za-z]))", "g");
    code = code.replace(re, (whole, braced, single) => {
      const list = parseIndexList(braced !== undefined ? braced : single);
      if (!list) return whole;
      const idx = list.map(x => (x.letter ? x.letter + (x.offset > 0 ? ` + ${x.offset}` : x.offset < 0 ? ` - ${-x.offset}` : "") : String(x.value)));
      return hold(`at(${codeOf(sym)}, ${idx.join(", ")})`);
    });
  });
  return code;
}

// The loops of a sum from its scripts: \sum_j, \sum_{j=1}^{M}, \sum_{j \ne i}, \sum_{j<i},
// \sum_{i<j} (both free: all pairs). null when the scripts are not about declared indices.
function sumLoops(sub, sup, active) {
  const ranges = indexRanges();
  if (sub === null) return null;
  const t = sub.trim();
  const full = letter => ({ letter, lo: rangeCode(ranges.get(letter).from), hi: rangeCode(ranges.get(letter).to) });
  let m = /^([A-Za-z])\s*=\s*(.+)$/.exec(t);
  if (m && sup !== null && ranges.has(m[1])) return [{ letter: m[1], lo: rangeCode(m[2]), hi: rangeCode(sup) }];
  if (/^[A-Za-z]$/.test(t) && ranges.has(t)) return [full(t)];
  m = /^([A-Za-z])\s*(\\neq?|\\leq?|\\geq?|\\lt|\\gt|!=|<=|>=|<|>)\s*([A-Za-z])$/.exec(t);
  if (!m || !ranges.has(m[1]) || !ranges.has(m[3])) return null;
  const op = { "\\ne": "!=", "\\neq": "!=", "!=": "!=", "\\le": "<=", "\\leq": "<=", "<=": "<=", "\\ge": ">=", "\\geq": ">=", ">=": ">=", "<": "<", "\\lt": "<", ">": ">", "\\gt": ">" }[m[2]];
  const [a, b] = [m[1], m[3]];
  const cond = `${a} ${op} ${b}`;
  if (!active.has(a) && !active.has(b)) return [full(a), { ...full(b), cond }];
  if (!active.has(a)) return [{ ...full(a), cond }];
  if (!active.has(b)) return [{ ...full(b), cond }];
  return null;
}

// End of a sum's body: the next + or - (or closing bracket, = or ,) at its own level.
function sumBodyEnd(code, start) {
  let depth = 0;
  let seen = false;
  for (let k = start; k < code.length; k++) {
    const c = code[k];
    if ("{([".includes(c)) depth++;
    else if ("})]".includes(c)) { if (--depth < 0) return k; }
    else if (depth === 0 && seen && (c === "+" || c === "-" || c === "=" || c === "," || c === "<" || c === ">")) {
      const prev = code.slice(start, k).trimEnd().slice(-1);
      if (prev !== "^" && prev !== "_") return k;
    }
    if (!/\s/.test(c)) seen = true;
  }
  return code.length;
}

// The free indices of an equation: those on its left side (x_{ij} = ..., dv_i/dt = ...).
function freeIndices(eq) {
  if (!indexRanges().size || !eq.outputs[0]) return [];
  const lhs = (eq.latex || "").split("=")[0] || "";
  if (eq.archetype === "ode") {
    const ode = odeLeftSide(lhs);
    return ((ode && ode.indices) || []).filter(l => indexRanges().has(l));
  }
  const ix = latexSymbols(lhs).indexed;
  return (ix.get(Latex.canonical(eq.outputs[0])) || ix.get(eq.outputs[0]) || []).filter(l => indexRanges().has(l));
}

// Symbols exported as functions -> their declared arguments: function cards (\mu(T) = ...) and
// inputs written as \mu(T) that no equation computes (given as a function to fill in).
function callableMap() {
  const map = new Map();
  const produced = new Set(projectData.equations.flatMap(e => e.outputs));
  projectData.equations.forEach(eq => {
    if (eq.archetype !== "function" || !eq.outputs[0]) return;
    const fn = functionLeftSide((eq.latex || "").split("=")[0] || "");
    map.set(eq.outputs[0], fn ? fn.args : []);
  });
  projectData.equations.forEach(eq => latexSymbols(eq.latex).calls.forEach((args, raw) => {
    const sym = preferredSpelling(raw);
    if (!produced.has(sym) && !map.has(sym)) map.set(sym, args.map(preferredSpelling));
  }));
  return map;
}

function isNonScalarSymbol(sym) {
  const size = parseSize(projectData.variableMeta[sym]?.size);
  return (size && !size.error) || looksNonScalar(sym);
}

// "Applies when" condition as code: R_e < 2300, 2300 \le R_e < 4000, x > 0 \land y > 0.
function conditionToCode(text) {
  const symbols = [...new Set(projectData.equations.flatMap(e => [...e.inputs, ...e.outputs, ...conditionSymbols(e)]))];
  const s = ` ${conditionText({ condition: text })} `
    .replace(/\\text\s*\{\s*(and|or|not)\s*\}/gi, (m, w) => ` ${w.toLowerCase()} `)
    .replace(/\\(?:land|wedge)(?![A-Za-z])|&&/g, " and ")
    .replace(/\\(?:lor|vee)(?![A-Za-z])|\|\|/g, " or ")
    .replace(/\\(?:lnot|neg)(?![A-Za-z])/g, " not ")
    .replace(/\\(?:leqslant|leq|le)(?![A-Za-z])|≤/g, "<=")
    .replace(/\\(?:geqslant|geq|ge)(?![A-Za-z])|≥/g, ">=")
    .replace(/\\(?:neq|ne)(?![A-Za-z])|≠/g, "!=")
    .replace(/\\lt(?![A-Za-z])/g, "<").replace(/\\gt(?![A-Za-z])/g, ">");
  if (!s.trim()) return "";
  const clause = part => {
    const neg = /^\s*not\s+/.exec(part);
    const body = neg ? part.slice(neg[0].length) : part;
    const pieces = body.split(/(<=|>=|!=|==|=|<|>)/);
    const code = pieces.map((p, k) => (k % 2 ? (p === "=" ? "==" : p) : latexToCode(p.trim(), symbols))).join(" ");
    return neg ? `not (${code})` : code;
  };
  return s.split(/\b(and|or)\b/).map((part, k) => (k % 2 ? part : clause(part))).join(" ").replace(/\s+/g, " ").trim();
}

const isNumber = v => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(String(v).trim());

// Loop settings typed on the card, e.g. "N_steps = 100" or "tol = 1e-6, max_iter = 500".
function loopSettings(eq) {
  const s = {};
  (eq.loopMeta || "").split(/[,;]/).forEach(part => {
    const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.+?)\s*$/.exec(part);
    if (m) s[m[1].toLowerCase()] = m[2];
  });
  return s;
}

// A count from the settings: a number or a variable (N_steps = N), else the default.
function settingCount(eq, keys, fallback) {
  const s = loopSettings(eq);
  const key = keys.find(k => s[k] !== undefined);
  return key ? boundCode(s[key]) : fallback;
}

function settingNumber(eq, keys, fallback) {
  const s = loopSettings(eq);
  const key = keys.find(k => s[k] !== undefined && isNumber(s[k]));
  return key ? s[key].trim() : fallback;
}

function integralBounds(eq) {
  const m = eq.latex.match(INT_REGEX);
  if (m) return [boundCode(m[1]), boundCode(m[2])];
  return [codeOf(eq.inputs[0] || "a"), codeOf(eq.inputs[1] || "b")];
}

// The x of "dx": the variable the integrand is evaluated at.
function integrationVariable(eq) {
  const all = [...eq.latex.matchAll(/(?:\\,|\s|^)d([a-zA-Z])\b/g)];
  return autoCodeName(all.length ? all[all.length - 1][1] : "x");
}

function isIndexedBy(sym, index) {
  return new RegExp(`_(?:\\{${index}\\}|${index})$`).test(sym);
}

// Inputs indexed by a sum index (f_i in \sum_{i=1}^{N} f_i) become arrays over the sum's range.
function indexedArrays(plan, varList) {
  const inputs = new Set(varList.filter(v => v.role === "Global Input").map(v => v.symbol));
  const arrays = new Map();
  plan.steps.flatMap(s => s.eqs).filter(eq => eq.archetype === "summation").forEach(eq => {
    const p = equationPlan(eq);
    eq.inputs.forEach(sym => {
      if (inputs.has(sym) && isIndexedBy(sym, p.index) && !arrays.has(sym)) arrays.set(sym, { lo: p.lo, hi: p.hi });
    });
  });
  return arrays;
}

// Start values written as a list ("1, 2, 3" or "[1, 2, 3]"), or null for a single value.
function listValues(initVal) {
  const t = String(initVal || "").trim().replace(/^\[(.*)\]$/, "$1");
  return t.includes(",") ? t.split(",").map(x => x.trim()).filter(Boolean) : null;
}

// Everything the generators need to write one equation as an assignment or a loop.
function equationPlan(eq, arrays = new Map()) {
  const arch = eq.archetype || "explicit";
  const p = { eq, arch, out: codeOf(eq.outputs[0]), arrays: [] };
  if (arch === "marching") {
    p.steps = settingCount(eq, ["n_steps", "steps", "n"], "100");
  } else if (arch === "convergence") {
    p.tol = settingNumber(eq, ["tol", "tolerance"], "1e-6");
    p.maxIter = settingCount(eq, ["max_iter", "maxiter"], "500");
  } else if (arch === "summation") {
    const m = eq.latex.match(SUM_REGEX);
    p.index = m && /^[A-Za-z]$/.test(m[1]) ? m[1] : "i";
    p.lo = m ? boundCode(m[2]) : "1";
    p.hi = m ? boundCode(m[3]) : "N";
    p.arrays = eq.inputs.filter(s => arrays.has(s));
  } else if (arch === "integral") {
    [p.lo, p.hi] = integralBounds(eq);
    p.n = settingCount(eq, ["n_quad", "n"], "100");
    p.x = integrationVariable(eq);
  } else if (arch === "implicit") {
    const s = loopSettings(eq);
    p.method = (s.method || "newton").trim().toLowerCase();
    p.tol = settingNumber(eq, ["tol", "tolerance"], "1e-10");
    p.maxIter = settingCount(eq, ["max_iter", "maxiter"], "50");
    p.guess = settingExpr(s, ["guess", "x0", "initial"]) || startValueCode(eq.outputs[0]);
    p.min = settingExpr(s, ["min", "lower"]);
    p.max = settingExpr(s, ["max", "upper"]);
    p.residual = residualCode(eq);
    p.fn = "res_" + p.out;
    p.vector = isNonScalarSymbol(eq.outputs[0]);
    p.guessFromStart = !settingExpr(s, ["guess", "x0", "initial"]);
    // K u = F: linear in a vector unknown, solved directly instead of by Newton
    if (p.vector) {
      try {
        const r = Expr.parse(p.residual), shapes = shapeTable();
        const prod = r.k === "bin" && r.op === "-" ? r.a : null;
        if (prod && prod.k === "bin" && (prod.op === "*" || prod.op === "·") && prod.b.k === "var" && prod.b.name === p.out &&
            Expr.shapeOf(prod.a, shapes).rank === 2 && !Expr.mentions(prod.a, p.out) && !Expr.mentions(r.b, p.out)) {
          p.linear = { A: prod.a, b: r.b };
        }
      } catch (e) { /* not parseable: Newton */ }
    }
  } else if (arch === "ode") {
    p.ode = odeSettings(eq);
  } else if (arch === "function") {
    const fn = functionLeftSide((eq.latex || "").split("=")[0] || "");
    p.params = (fn ? fn.args : []).map(codeOf);
    p.paramSymbols = fn ? fn.args : [];
  }
  // The right-hand side as neutral code (evaluated in the browser, written per language by rhsFor)
  p.code = arch === "function"
    ? latexToCode((eq.latex || "").split("=").slice(1).join("="), [...eq.inputs, ...p.paramSymbols]) || "0.0"
    : p.arrays.length ? rhsFor(p, "neutral") : latexRhsToCodeDraft(eq);
  // Index notation: the equation holds for every value of its free indices (a loop)
  const ranges = indexRanges();
  p.free = freeIndices(eq).map(letter => ({ letter, lo: rangeCode(ranges.get(letter).from), hi: rangeCode(ranges.get(letter).to) }));
  p.hasSums = /\bisum\(/.test(p.code);
  return p;
}

// name = rhs, or (index notation) name_{ij} = rhs for every value of the free indices, in loops;
// the array is created first (rateOf: like that ODE state). In MATLAB and Fortran the sums of
// the right-hand side are computed by loops written just before the assignment.
function assignLines(lang, name, p, ctx, { rateOf = null } = {}) {
  const end = lang === "matlab" ? ";" : "";
  const free = p.free || [];
  const pre = [];
  ctx.counter = ctx.counter || {};
  const rhs = langCode(p.code, lang, undefined, ctx.used, { pre, counter: ctx.counter });
  if (!free.length) return [...pre, `${name} = ${rhs}${end}`];
  const shape = shapeOfCode(rateOf || name);
  const row = !!shape && shape.rank === 2 && free.length === 1;
  const dims = shape && shape.dims ? shape.dims : free.map(f => indexRangeSize(f.letter));
  const letters = free.map(f => f.letter);
  const bound = code => (isNumber(code) ? code : lang === "matlab" ? langCode(code, "matlab") : `int(${langCode(code, lang)})`);
  const lines = [];
  const pad = k => (lang === "fortran" ? "  " : "    ").repeat(k);
  if (lang === "python") {
    ctx.used.add("numpy");
    lines.push(rateOf ? `${name} = np.zeros_like(${rateOf}, dtype=float)` : `${name} = np.zeros(${dims.length === 1 ? pyInt(dims[0]) : `(${dims.map(pyInt).join(", ")})`})`);
    free.forEach((f, k) => lines.push(`${pad(k)}for ${f.letter} in range(${bound(f.lo)}, ${bound(f.hi)} + 1):`));
    lines.push(...pre.map(l => pad(free.length) + l), `${pad(free.length)}${name}[${letters.map(l => `${l} - 1`).join(", ")}] = ${rhs}`);
    return lines;
  }
  if (lang === "matlab") {
    lines.push(rateOf ? `${name} = zeros(size(${rateOf}));` : `${name} = zeros(${dims[0]}, ${dims.length === 2 ? dims[1] : 1});`);
    free.forEach((f, k) => lines.push(`${pad(k)}for ${f.letter} = ${bound(f.lo)}:${bound(f.hi)}`));
    lines.push(...pre.map(l => pad(free.length) + l),
      row ? `${pad(free.length)}${name}(${letters[0]}, :) = (${rhs}).';` : `${pad(free.length)}${name}(${letters.join(", ")}) = ${rhs};`);
    free.forEach((f, k) => lines.push(`${pad(free.length - 1 - k)}end`));
    return lines;
  }
  (ctx.counter.loopVars = ctx.counter.loopVars || new Set());
  letters.forEach(l => ctx.counter.loopVars.add(l));
  if (rateOf) lines.push(`${name} = 0.0_dp * ${rateOf}`);
  else lines.push(`if (allocated(${name})) deallocate(${name})`, `allocate(${name}(${dims.map(fInt).join(", ")}))`);
  free.forEach((f, k) => lines.push(`${pad(k)}do ${f.letter} = ${bound(f.lo)}, ${bound(f.hi)}`));
  lines.push(...pre.map(l => pad(free.length) + l), row ? `${pad(free.length)}${name}(${letters[0]}, :) = ${rhs}` : `${pad(free.length)}${name}(${letters.join(", ")}) = ${rhs}`);
  free.forEach((f, k) => lines.push(`${pad(free.length - 1 - k)}end do`));
  return lines;
}

// A code tree (Expr) written in one language.
function langTree(tree, lang, used = new Set()) {
  return Expr.emit(tree, { lang, shapes: shapeTable(), used, number: lang === "fortran" ? fortranNumbers : null });
}

const ROOT_METHODS = { newton: "Newton–Raphson" }; // more methods can be added here (secant, bisection, ...)

// A setting written as a number, a variable or a LaTeX expression (guess = R_u T_g / p), as code.
function settingExpr(s, keys) {
  const key = keys.find(k => s[k] !== undefined && s[k].trim());
  if (!key) return null;
  const text = s[key].trim();
  if (isNumber(text)) return text;
  return latexToCode(text, Object.keys(projectData.variableMeta).concat(projectData.equations.flatMap(e => [...e.inputs, ...e.outputs])));
}

function startValueCode(sym) {
  const v = String(projectData.variableMeta[sym]?.initVal ?? "").trim();
  return v || "1.0";
}

// Right-hand side with array elements written the way each language indexes them.
// lang "neutral": the browser's form (Python indexing, vector markers kept).
function rhsFor(p, lang, used) {
  if (!p.arrays.length) return lang === "neutral" ? p.code : langCode(p.code, lang, undefined, used);
  const element = code => {
    if (lang === "python" || lang === "neutral") return `${code}[${p.lo === "1" ? `${p.index} - 1` : p.lo === "0" ? p.index : `${p.index} - ${p.lo}`}]`;
    if (lang === "matlab") return `${code}(${p.lo === "1" ? p.index : `${p.index} - ${p.lo} + 1`})`;
    return `${code}(${p.index})`; // Fortran arrays are allocated as lo:hi
  };
  const code = latexRhsToCodeDraft(p.eq, sym => (p.arrays.includes(sym) ? element(codeOf(sym)) : codeOf(sym)));
  if (lang === "neutral") return code;
  const scalar = toScalarCode(code);
  return lang === "matlab" ? scalar.replace(/\*\*/g, "^") : lang === "fortran" ? fortranNumbers(scalar) : scalar;
}

function refText(eq) {
  return [articleFlag(eq), eq.eqNumber && `Eq. ${eq.eqNumber}`, eq.source].filter(Boolean).join(", ");
}

function roleLabel(v) {
  return ROLE_UI[v.role].label;
}
