// SolverMapp — The variable registry: every symbol with its role (input, state, intermediate,
// output), size, code name and where it is used (`buildVariableRegistry`).
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// VARIABLE REGISTRY & ROLE CLASSIFIER
// ================================================================
// Internal role names are kept as-is (they appear in exported code comments);
// ROLE_UI controls only how they look.
const ROLE_UI = {
  "Global Input":   { label: "Input",        cls: "role-input",  token: "--input",  hint: "given by you" },
  "State Var (y₀)": { label: "State",        cls: "role-state",  token: "--state",  hint: "updated in a loop, needs a start value" },
  "Intermediate":   { label: "Intermediate", cls: "role-inter",  token: "--inter",  hint: "passed between equations" },
  "Final Output":   { label: "Output",       cls: "role-output", token: "--output", hint: "final result" }
};

// Names the generated code already uses, or language keywords.
const RESERVED_NAMES = new Set(["lambda", "in", "is", "if", "for", "def", "end", "and", "or", "not", "class", "return", "pass", "del", "global", "with", "as", "from", "import", "try", "while", "break", "else", "function", "i", "it", "step", "q", "dx", "n_quad", "tol", "max_iter", "N_steps", "res", "math", "it_c", "prev_c", "tol_c", "max_iter_c", "x_c", "p_c", "w_q", "converged", "converged_c", "dp", "real", "int", "abs", "merge", "maxval", "h_nr", "dr_nr", "tan", "log10", "min", "max", "r_nr", "e_nr", "jac_nr", "j_nr", "h_rk", "c_rk", "w_rk", "stage", "np", "norm", "norm2", "dot", "dot_product", "cross", "cross3", "solve", "inv", "eye", "matmul", "matpow", "transpose", "size", "spread", "reshape", "ones", "zeros", "allocated"]);

function autoCodeName(sym) {
  if (!sym) return "var";
  let name = sym
    .replace(/\\(?:mathbf|boldsymbol|bm|vec|underline|mathrm|mathit|mathsf)\s*\{([^}]*)\}/g, "$1") // \mathbf{u} -> u
    .replace(/\\(dot|ddot|hat|bar|tilde|widehat|widetilde|overline)\s*\{([^}]*)\}/g, "$2_$1")   // \dot{m} -> m_dot
    .replace(/\\infty/g, "inf").replace(/\\/g, "").replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "var";
  if (/^[0-9]/.test(name)) name = "v_" + name;
  if (RESERVED_NAMES.has(name)) name += "_";
  return name;
}

function codeOf(sym) {
  const custom = projectData.variableMeta[sym]?.codeName;
  return (custom && custom.trim()) || autoCodeName(sym);
}

// Loop bounds can be numbers (\sum_{i=1}^{10}) or symbols (^{N}).
function boundCode(s) {
  const t = String(s).replace(/[{}]/g, "").trim();
  return /^[\d.]+$/.test(t) ? t : codeOf(t);
}

function isValidIdentifier(name) {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name);
}

// Equations that can take part in the plan: they need LaTeX and at least one output.
function isComplete(eq) {
  return !!(eq.latex.trim() && eq.outputs.length > 0);
}

// Size of a vector or matrix from the Size column: "3", "N" (vector), "3x3", "N x M", "3,3"
// (matrix); empty or 1 = scalar. dims are code expressions (numbers or code names).
function parseSize(text) {
  const t = String(text || "").trim();
  if (!t || t === "1") return null;
  const parts = t.split(/\s*(?:x|×|,|\*)\s*/i).filter(Boolean);
  if (!parts.length || parts.length > 2) return { error: "Use n for a vector, or n x m for a matrix" };
  const dims = parts.map(d => (isNumber(d) ? String(Math.round(+d)) : codeOf(d)));
  return { rank: dims.length, dims, text: t };
}

// Bold or arrow notation: written as a vector or matrix.
const looksNonScalar = sym => /^\\(?:mathbf|boldsymbol|bm|vec|underline)\s*\{/.test(sym);

// The independent variable and the dependent one of an ODE card.
function odeVariables(eq) {
  const ode = odeLeftSide((eq.latex || "").split("=")[0] || "");
  return { dependent: eq.outputs[0] || (ode && ode.dependent), independent: (ode && ode.independent) || odeIndependentFromSettings(eq) || "t" };
}

function odeIndependentFromSettings(eq) {
  const m = /(?:^|[,;])\s*([^=,;]+?)\s*=\s*[^,;]+\.\.[^,;]+/.exec(eq.loopMeta || "");
  return m ? Latex.canonical(m[1]) : null;
}

function buildVariableRegistry() {
  const allVars = {};
  const touch = sym => allVars[sym] || (allVars[sym] = { usedAsInputIn: [], producedBy: [], isStateVar: false, args: null, definedAsFunction: "", independentOf: "" });
  projectData.equations.forEach(eq => {
    const isSelfLoopEq = (eq.archetype === "marching" || eq.archetype === "convergence" || eq.archetype === "ode");
    const label = eq.name || "Untitled equation";
    eq.inputs.forEach(sym => touch(sym).usedAsInputIn.push(label));
    conditionSymbols(eq).forEach(sym => { if (!eq.inputs.includes(sym)) touch(sym).usedAsInputIn.push(label); });
    eq.outputs.forEach(sym => {
      touch(sym).producedBy.push(label);
      if (isSelfLoopEq || eq.inputs.includes(sym)) allVars[sym].isStateVar = true;
    });
    if (eq.archetype === "implicit" && eq.outputs[0]) touch(eq.outputs[0]).guessFor = label;
    // Dependent / independent variables: \mu(T) notation, function definitions and ODEs
    latexSymbols(eq.latex).calls.forEach((args, raw) => {
      const sym = preferredSpelling(raw);
      if (allVars[sym] && !allVars[sym].args) allVars[sym].args = args.map(preferredSpelling);
    });
    latexSymbols(eq.latex).indexed.forEach((letters, raw) => {
      const sym = preferredSpelling(raw);
      if (allVars[sym] && (!allVars[sym].indexedBy || allVars[sym].indexedBy.length < letters.length)) allVars[sym].indexedBy = letters;
    });
    if (eq.archetype === "function" && eq.outputs[0]) {
      const fn = functionLeftSide((eq.latex || "").split("=")[0] || "");
      touch(eq.outputs[0]).args = fn ? fn.args : (allVars[eq.outputs[0]].args || []);
      allVars[eq.outputs[0]].definedAsFunction = label;
    }
    if (eq.archetype === "ode" && eq.outputs[0]) {
      const { independent } = odeVariables(eq);
      eq.outputs.forEach(o => { touch(o).args = [independent]; });
      touch(independent).independentOf = label;
      const [x, v] = eq.outputs;
      if (v && allVars[x].indexedBy && !allVars[v].indexedBy) allVars[v].indexedBy = allVars[x].indexedBy;
    }
  });

  // The bounds of the declared indices (N in i = 1..N) are inputs too
  if (projectData.equations.some(eq => latexSymbols(eq.latex).usesIndices)) {
    indexRangeSymbols().forEach(sym => { touch(sym).usedAsInputIn.push("Indices"); });
  }

  return Object.keys(allVars).map(sym => {
    const info = allVars[sym];
    let role = "Global Input";
    if (info.isStateVar) role = "State Var (y₀)";
    else if (info.producedBy.length > 0 && info.usedAsInputIn.length > 0) role = "Intermediate";
    else if (info.producedBy.length > 0 && info.usedAsInputIn.length === 0) role = "Final Output";
    // A function of other variables: defined by a function card, or an input written as \mu(T)
    // (then it is given as a function to fill in). An ODE state y(t) is not called.
    const callable = !!info.definedAsFunction || (role === "Global Input" && !!info.args && !info.independentOf);

    const meta = projectData.variableMeta[sym] || {};
    return {
      symbol: sym,
      codeVar: codeOf(sym),
      codeName: meta.codeName || "",
      role,
      badgeStyle: ROLE_UI[role].cls,
      initVal: meta.initVal !== undefined ? meta.initVal : "1.0",
      units: meta.units || "", // empty = not given yet; "1" or "-" = dimensionless
      desc: meta.desc || "",
      producedBy: info.producedBy,
      usedAsInputIn: info.usedAsInputIn,
      guessFor: info.guessFor || "", // solved implicitly by this equation: Start is the initial guess
      args: info.args || [],         // independent variables: \mu(T) -> ["T"], ODE state y(t) -> ["t"]
      callable,                      // exported as a function mu(T)
      independentOf: info.independentOf, // the independent variable of this ODE: set by the integrator
      size: meta.size || "",
      shape: callable ? null : parseSize(meta.size) || indexedShape(sym, info.indexedBy),
      indexedBy: info.indexedBy || null // index notation: m_i -> ["i"]
    };
  });
}

// Symbols in the bounds of the declared indices (N, M).
function indexRangeSymbols() {
  const out = new Set();
  indexRanges().forEach(r => [r.from, r.to].forEach(t => latexSymbols(t).symbols.forEach(x => out.add(preferredSpelling(x)))));
  return [...out];
}

// Size of an index range as code: 1..N -> N, 0..N -> (N - 0 + 1)
function indexRangeSize(letter) {
  const r = indexRanges().get(letter);
  const code = t => (isNumber(t) ? String(Math.round(+t)) : codeOf(preferredSpelling(Latex.canonical(t))));
  if (!r) return "1";
  if (r.from.trim() === "1") return code(r.to);
  if (isNumber(r.from) && isNumber(r.to)) return String(Math.round(+r.to - +r.from + 1));
  return `(${code(r.to)} - ${code(r.from)} + 1)`;
}

// An array used with indices and no Size: one dimension per index (m_i -> N, k_{ij} -> N x N).
// A bold symbol with an index (\mathbf{r}_i, a vector per body) needs its Size.
function indexedShape(sym, letters) {
  if (!letters || !letters.length || letters.length > 2 || looksNonScalar(sym) || !letters.every(l => indexRanges().has(l))) return null;
  return { rank: letters.length, dims: letters.map(indexRangeSize), text: letters.map(indexRangeSize).join(" x ") };
}

// How a variable is shown: \mu(T), y(t), or just the symbol.
function displaySymbol(v) {
  return v.args && v.args.length ? `${v.symbol}(${v.args.join(", ")})` : v.symbol;
}

// Variables set at the start: inputs and start values of states (not functions or ODE independents).
const isGiven = v => (v.role === "Global Input" || v.role === "State Var (y₀)") && !v.callable && !v.independentOf;

// Code names of vectors and matrices -> { rank, dims }.
function shapeTable(varList = buildVariableRegistry()) {
  const shapes = {};
  varList.forEach(v => { if (v.shape && !v.shape.error) shapes[v.codeVar] = v.shape; });
  return shapes;
}

const projectHasArrays = varList => varList.some(v => v.shape && !v.shape.error);
