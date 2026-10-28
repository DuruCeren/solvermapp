// SolverMapp — The Report tab: the model description as LaTeX and an HTML preview.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// REPORT (tab 4)
// The report is first built as a format-neutral model (plain data per section). Writers turn
// it into LaTeX (+ .bib) or the HTML preview; sentences are shared through a small "format"
// object (text, math, number, unit, citation), so a Markdown writer can reuse them.
// ================================================================
let reportView = "preview";
let reportOutput = { tex: "", bib: "" };

const GREEK_LETTERS = ("alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi " +
  "rho varrho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega").split(" ");
const GREEK_RE = new RegExp(`^\\\\(?:${GREEK_LETTERS.join("|")})(?![A-Za-z])`);

const ROLE_GROUPS = [
  ["Global Input", "Inputs"], ["State Var (y₀)", "State variables"],
  ["Intermediate", "Intermediate variables"], ["Final Output", "Outputs"]
];

function slugify(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Sort key ignoring LaTeX markup: \hat{T}_{\infty} -> "t_infty"
function symbolSortKey(sym) {
  return sym.replace(/\\[A-Za-z]+\s*\{/g, "").replace(/[\\{}]/g, "").toLowerCase();
}

function isDimensionlessUnit(text) {
  try {
    const u = Units.parse(text);
    return !!u && Units.isDimensionless(u) && Math.abs(u.f - 1) < 1e-12;
  } catch (e) { return false; }
}

// Loop settings for display: the values as typed (numbers or symbols).
function reportSettings(eq) {
  const s = loopSettings(eq);
  const sum = eq.archetype === "summation" ? eq.latex.match(SUM_REGEX) : null;
  const int = eq.archetype === "integral" ? eq.latex.match(INT_REGEX) : null;
  const strip = t => String(t).replace(/^\{|\}$/g, "").trim();
  const dx = [...eq.latex.matchAll(/(?:\\,|\s|^)d([a-zA-Z])\b/g)];
  return {
    steps: s.n_steps || s.steps || s.n || "100",
    tol: settingNumber(eq, ["tol", "tolerance"], "1e-6"),
    maxIter: s.max_iter || s.maxiter || "500",
    index: sum ? sum[1] : "i", from: sum ? strip(sum[2]) : "1", to: sum ? strip(sum[3]) : "N",
    variable: dx.length ? dx[dx.length - 1][1] : "x",
    lower: int ? strip(int[1]) : "a", upper: int ? strip(int[2]) : "b",
    n: s.n_quad || s.n || "100",
    // implicit: as typed (numbers, variables or LaTeX); no guess = the Start value
    method: ROOT_METHODS[(s.method || "newton").trim().toLowerCase()] || ROOT_METHODS.newton,
    rootTol: settingNumber(eq, ["tol", "tolerance"], "1e-10"),
    rootMaxIter: s.max_iter || s.maxiter || "50",
    guess: (s.guess || s.x0 || s.initial || "").trim(),
    min: (s.min || s.lower || "").trim(), max: (s.max || s.upper || "").trim(),
    ode: eq.archetype === "ode" ? odeSettings(eq) : null,
    linear: eq.archetype === "implicit" && !!equationPlan(eq).linear,
    free: freeIndices(eq), // index notation: the equation holds for every value of these
    args: eq.archetype === "function" ? (functionLeftSide((eq.latex || "").split("=")[0] || "") || { args: [] }).args : []
  };
}

function buildReportModel(opts) {
  const plan = analyzeSolverArchitecture();
  const varList = buildVariableRegistry();
  const bySymbol = new Map(varList.map(v => [v.symbol, v]));
  const hasStart = v => v.role === "Global Input" || v.role === "State Var (y₀)";
  const row = v => ({
    symbol: v.symbol, desc: v.desc.trim(), units: v.units.trim(), role: v.role,
    value: opts.values && hasStart(v) ? String(v.initVal).trim() : ""
  });

  // Variables table
  let groups;
  if (opts.grouping === "alpha") {
    const sorted = [...varList].sort((a, b) => symbolSortKey(a.symbol).localeCompare(symbolSortKey(b.symbol)) || a.symbol.localeCompare(b.symbol));
    groups = [["Latin symbols", sorted.filter(v => !GREEK_RE.test(v.symbol))], ["Greek symbols", sorted.filter(v => GREEK_RE.test(v.symbol))]];
  } else {
    groups = ROLE_GROUPS.map(([role, title]) => [title, varList.filter(v => v.role === role)]);
  }
  const variables = groups.filter(([, list]) => list.length).map(([title, list]) => ({ title, rows: list.map(row) }));

  // References: one per distinct author, year and reference text
  const references = [];
  const refOf = new Map();
  projectData.equations.forEach(eq => {
    const author = eq.author.trim(), year = eq.year.trim(), text = eq.source.trim();
    if (!author && !text) return;
    const id = [author, year, text].join("|");
    let ref = references.find(r => r.id === id);
    if (!ref) {
      const base = (slugify(author.split(/[\s,]+/)[0]).replace(/-/g, "") || "ref") + year.replace(/\D/g, "");
      let key = base;
      for (let n = 0; references.some(r => r.key === key); n++) key = base + String.fromCharCode(98 + n);
      ref = { id, key, author, year, text };
      references.push(ref);
    }
    refOf.set(eq.id, ref);
  });

  // Equations in the order of solution, then the ones not in the plan yet
  const ordered = [...plan.steps.flatMap(s => s.eqs), ...plan.incomplete].filter(eq => eq.latex.trim());
  const coupledOf = new Map();
  plan.coupledSteps.forEach(step => step.eqs.forEach(eq => coupledOf.set(eq.id, step.eqs)));
  const labels = new Set();
  const equations = ordered.map((eq, i) => {
    const base = "eq:" + (slugify(eq.name) || "equation-" + (i + 1));
    let label = base;
    for (let n = 2; labels.has(label); n++) label = `${base}-${n}`;
    labels.add(label);
    return {
      eq, number: i + 1, label,
      title: eq.name.trim() || "Untitled equation",
      latex: eq.latex.trim(),
      ref: refOf.get(eq.id) || null,
      flag: articleFlag(eq), eqNumber: cleanEqNumber(eq), sourceText: eq.source.trim(),
      type: eq.archetype || "explicit", settings: reportSettings(eq),
      outputs: eq.outputs, assumptions: eq.assumptions.trim(),
      where: [...new Set([...eq.outputs, ...eq.inputs])].map(s => bySymbol.get(s)).filter(Boolean).map(row)
    };
  });
  const entryOf = new Map(equations.map(e => [e.eq.id, e]));
  const systemOf = new Map();
  plan.steps.forEach(step => step.units.filter(u => u.kind === "ode").forEach(u => u.system.cards.forEach(eq => systemOf.set(eq.id, u.system.cards))));
  equations.forEach(e => {
    e.coupledWith = (coupledOf.get(e.eq.id) || []).filter(o => o !== e.eq).map(o => entryOf.get(o.id)).filter(Boolean);
    e.systemWith = (systemOf.get(e.eq.id) || []).filter(o => o !== e.eq).map(o => entryOf.get(o.id)).filter(Boolean);
    e.condition = conditionText(e.eq);
    e.otherwiseCase = !e.condition && !!String(e.eq.condition || "").trim();
  });

  // Algorithm: set inputs and start values, then one block per step of the plan
  const inputs = varList.filter(v => v.role === "Global Input" && isGiven(v));
  const states = varList.filter(v => v.role === "State Var (y₀)" && isGiven(v));
  const algorithm = [];
  if (inputs.length) algorithm.push({ type: "set", label: "Set the inputs", rows: inputs.map(row), values: false });
  // Arrays: just the symbol (their values are in the variables table)
  if (states.length) algorithm.push({ type: "set", label: "Set the start values", rows: states.map(v => ({ ...row(v), value: v.shape ? "" : String(v.initVal).trim() })), values: true });
  const node = eq => {
    const e = entryOf.get(eq.id);
    if (e.type === "marching") return { type: "for", entry: e };
    if (e.type === "convergence") return { type: "until", entry: e };
    if (e.type === "implicit") return { type: e.settings.linear ? "compute" : "root", entry: e };
    if (e.type === "function") return { type: "define", entry: e };
    return { type: "compute", entry: e };
  };
  // Switch: { cases: [{ cond (LaTeX, "" = otherwise), body }], symbol }; ODE system: states, settings, odes, algebraic
  const unitNodes = unit => {
    if (unit.kind === "eq") return entryOf.has(unit.eq.id) ? [node(unit.eq)] : [];
    if (unit.kind === "switch") {
      return [{ type: "switch", symbol: unit.group.symbol, otherwise: !!unit.group.otherwise,
        cases: unit.group.eqs.filter(eq => entryOf.has(eq.id)).map(eq => ({ cond: conditionText(eq), body: [node(eq)] })) }];
    }
    const sys = unit.system;
    return [{ type: "ode", states: sys.states, settings: sys.settings,
      odes: sys.cards.filter(eq => entryOf.has(eq.id)).map(eq => entryOf.get(eq.id)), algebraic: sys.algebraic.flatMap(unitNodes) }];
  };
  plan.steps.forEach(step => {
    const items = step.units.flatMap(unitNodes);
    if (step.coupled) algorithm.push({ type: "coupled", outputs: step.computes, body: items, tol: "1e-8", maxIter: "200" });
    else algorithm.push(...items);
  });

  const cited = opts.equations ? equations.map(e => e.ref).filter(Boolean) : [];
  const roleCount = role => varList.filter(v => v.role === role).length;

  const notes = [];
  const noDesc = varList.filter(v => !v.desc.trim());
  const noUnit = varList.filter(v => !v.units.trim());
  if (opts.nomenclature || opts.equations) {
    if (noDesc.length) notes.push(`${noDesc.length} variable(s) have no description, shown as “–”. Filter the Variables table by <strong>To check</strong>.`);
    if (noUnit.length) notes.push(`${noUnit.length} variable(s) have no unit.`);
  }
  varList.filter(v => v.callable && !projectData.equations.some(e => e.archetype === "function" && e.outputs[0] === v.symbol))
    .forEach(v => notes.push(`${escapeHtml(displaySymbol(v))} is used as a function but not defined by an equation: the exported code returns its Start value.`));
  const noLatex = projectData.equations.filter(eq => !eq.latex.trim()).length;
  if (noLatex) notes.push(`${noLatex} equation(s) without LaTeX are left out.`);
  if (opts.references && opts.equations && !references.length) notes.push("No references yet: fill in the author, year or Reference fields of the equation cards.");
  if (opts.references && !opts.equations && references.length) notes.push("References are cited from the Equations section; turn it on to include them.");

  return {
    title: opts.title.trim() || "Model description",
    author: opts.author.trim(),
    variables, equations, algorithm,
    references: references.filter(r => cited.includes(r)),
    counts: {
      equations: equations.length, variables: varList.length, steps: plan.steps.length,
      inputs: roleCount("Global Input"), states: roleCount("State Var (y₀)"),
      intermediate: roleCount("Intermediate"), outputs: roleCount("Final Output"), coupled: plan.coupledSteps.length
    },
    notes
  };
}

// ---------- Shared sentences (format-independent) ----------
const sentence = s => (/[.!?]$/.test(s) ? s : s + ".");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function listJoin(items) {
  return items.length < 2 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function unitPhrase(units, f) {
  if (!units) return "";
  if (isDimensionlessUnit(units)) return "dimensionless";
  return unitError(units) ? f.text(units) : f.unit(units);
}

function whereText(r, f) {
  const unit = unitPhrase(r.units, f);
  return (r.desc ? f.text(r.desc) : "–") + (unit ? `, ${unit}` : "");
}

function overviewText(m, f, opts) {
  const c = m.counts;
  const roles = [plural(c.inputs, "input"), plural(c.states, "state variable"), plural(c.intermediate, "intermediate variable"), plural(c.outputs, "output")];
  let s = `The model consists of ${plural(c.equations, "equation")} in ${plural(c.variables, "variable")}: ${listJoin(roles)}. `;
  s += `It is solved in ${plural(c.steps, "step")}`;
  if (c.coupled) s += `, ${c.coupled === 1 ? "one of them a coupled block" : `${c.coupled} of them coupled blocks`} of equations solved together`;
  s += opts.algorithm ? ` (${f.algRef()}).` : ".";
  return s;
}

function sourceText(e, f, opts) {
  const num = e.eqNumber ? `, ${f.text("Eq.")}${f.nbsp}(${f.text(e.eqNumber)})` : "";
  if (opts.references && e.ref) return `Source: ${f.cite(e.ref)}${num}.`;
  const origin = e.flag || e.sourceText;
  if (!origin && !num) return "";
  return `Source: ${origin ? f.text(origin) : "article"}${num}.`;
}

function typeText(e, f) {
  const s = e.settings;
  const outs = listJoin(e.outputs.map(f.math));
  if (e.type === "marching") return `Marched over ${f.count(s.steps)} steps, starting from the start value of ${outs}.`;
  if (e.type === "convergence") return `Iterated until the change in ${outs} is below ${f.num(s.tol)}, with at most ${f.count(s.maxIter)} iterations.`;
  if (e.type === "summation") return `Summed over ${f.math(`${s.index} = ${s.from}, \\dots, ${s.to}`)}.`;
  if (e.type === "integral") return `Integrated numerically over ${f.math(s.variable)} from ${f.math(s.lower)} to ${f.math(s.upper)} with the trapezoidal rule (${f.math(`n = ${s.n}`)}).`;
  if (e.type === "implicit" && s.linear) return `Linear in ${outs}: solved directly as a linear system (Gaussian elimination with partial pivoting).`;
  if (e.type === "implicit") return `Implicit in ${outs}: solved for the root of the residual (left side minus right side) by ${s.method} iteration from ${guessText(e, f)}, until the relative step is below ${f.num(s.rootTol)}, with at most ${f.count(s.rootMaxIter)} iterations.${branchText(e, f)}`;
  if (e.type === "ode") {
    const o = s.ode;
    const parts = firstOrderOdes(e.eq);
    const split = parts.length === 2
      ? ` Second order: it is integrated as the first-order pair ${listJoin(parts.map(p => f.math(p.latex)))}.`
      : parts[0] !== e.eq ? ` It is integrated as ${f.math(parts[0].latex)}.` : "";
    return `Integrated over ${f.math(o.independent)} from ${f.math(o.from)} to ${f.math(o.to)} with the ${ODE_METHODS[o.method].label} method in ${f.count(o.steps)} steps, starting from the start value of ${outs}` +
      (e.systemWith.length ? `, together with ${listJoin(e.systemWith.map(x => f.eqRef(x)))}.` : ".") +
      (o.save ? ` The solution is saved every ${f.count(String(o.save))} steps.` : "") + split;
  }
  if (e.type === "function") {
    const call = `${e.outputs[0]}(${s.args.join(", ")})`;
    return `Defines ${f.math(call)} as a function of ${listJoin(s.args.map(f.math))}; ${f.math(e.outputs[0])} in the other equations stands for ${f.math(call)}.`;
  }
  return "";
}

// Index notation: "Holds for every i = 1, ..., N and j = 1, ..., N."
function indexSentence(e, f) {
  const free = e.settings.free || [];
  if (!free.length) return "";
  const ranges = indexRanges();
  return `Holds for every ${listJoin(free.map(l => f.math(`${l} = ${ranges.get(l).from}, \\dots, ${ranges.get(l).to}`)))}.`;
}

// "Applies when Re < 2300." for the cases of a switch.
function conditionSentence(e, f) {
  if (e.condition) return `Applies when ${f.math(e.condition)}.`;
  if (e.otherwiseCase) return `Applies otherwise (when no other case for ${f.math(e.outputs[0])} holds).`;
  return "";
}

// "the start value of v" or "v = 8.23e-5" (a guess from the loop settings)
function guessText(e, f) {
  const s = e.settings;
  if (!s.guess) return `the start value of ${listJoin(e.outputs.map(f.math))}`;
  return isNumber(s.guess) ? `${f.math(e.outputs[0])} = ${f.num(s.guess)}` : f.math(`${e.outputs[0]} = ${s.guess}`);
}

// The limits that keep the iteration on one root when the equation has several: "b \le v".
function branchRange(e, f) {
  const s = e.settings;
  const lim = t => (isNumber(t) ? sciMath(t) : t);
  const parts = [s.min && lim(s.min), e.outputs[0], s.max && lim(s.max)].filter(Boolean);
  return f.math(parts.join(" \\le "));
}

function branchText(e, f) {
  const s = e.settings;
  if (!s.min && !s.max) return "";
  return ` The iteration is kept on the branch ${branchRange(e, f)}, which selects the root when the equation has several.`;
}

// One Newton step: x <- x - R(x) / R'(x)
function rootStepMath(e) {
  const x = e.outputs[0];
  return `${x} \\leftarrow ${x} - R(${x}) / R'(${x})`;
}

function coupledText(e, f) {
  if (!e.coupledWith.length) return "";
  return `Coupled with ${listJoin(e.coupledWith.map(o => f.eqRef(o)))}: solved together.`;
}

// One algorithm step as text, e.g. "Compute W by numerical integration (Eq. 3)".
function algorithmPhrase(node, f) {
  const e = node.entry;
  const outs = listJoin(e.outputs.map(f.math));
  const ref = f.eqRef(e);
  if (node.type === "for" || node.type === "until") return `Update ${outs} with ${ref}`;
  if (node.type === "root") return `${f.math(rootStepMath(e))}, with ${f.math("R")} the residual of ${ref}`;
  if (node.type === "define") return `Define ${f.math(`${e.outputs[0]}(${e.settings.args.join(", ")})`)} by ${ref}`;
  if (e.type === "implicit") return `Solve the linear system ${ref} for ${outs}`;
  if (e.type === "summation") return `Compute ${outs} by the sum in ${ref}`;
  if (e.type === "integral") return `Compute ${outs} by numerical integration of ${ref} (trapezoidal rule, ${f.math(`n = ${e.settings.n}`)})`;
  const every = (e.settings.free || []).length ? ` for every ${listJoin(e.settings.free.map(f.math))}` : "";
  return `Compute ${outs}${every} from ${ref}`;
}

// ODE system: "t = 0 to 600 in 100 steps" and "Advance T by one RK4 step of Eq. (2)"
function odeHead(node, f) {
  const o = node.settings;
  return `${f.math(`${o.independent} = ${o.from}`)} to ${f.math(o.to)} in ${f.count(o.steps)} steps`;
}

function odePhrase(node, f) {
  const stages = node.algebraic.length && node.settings.method === "rk4" ? " (the equations above are evaluated at each of its 4 stages)" : "";
  return `Advance ${listJoin(node.states.map(f.math))} by one ${ODE_METHODS[node.settings.method].short} step of ${listJoin(node.odes.map(e => f.eqRef(e)))}${stages}`;
}

function setPhrase(node, f) {
  const items = node.rows.map(r => node.values && r.value ? `${f.math(r.symbol)} = ${f.num(r.value)}` : f.math(r.symbol));
  return `${node.label} ${listJoin(items)}`;
}

// ---------- LaTeX ----------
const TEX_SPECIAL = { "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#", "_": "\\_", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" };
const TEX_UNICODE = {
  "·": "\\textperiodcentered{}", "°": "\\textdegree{}", "µ": "\\textmu{}", "×": "$\\times$", "±": "$\\pm$", "−": "--",
  "≤": "$\\leq$", "≥": "$\\geq$", "≈": "$\\approx$", "≠": "$\\neq$", "→": "$\\rightarrow$", "∞": "$\\infty$", "√": "$\\surd$",
  "∂": "$\\partial$", "∆": "$\\Delta$", "∇": "$\\nabla$", "∑": "$\\sum$", "∫": "$\\int$"
};
"₀₁₂₃₄₅₆₇₈₉".split("").forEach((c, i) => { TEX_UNICODE[c] = `\\textsubscript{${i}}`; });
"⁰¹²³⁴⁵⁶⁷⁸⁹".split("").forEach((c, i) => { TEX_UNICODE[c] = `\\textsuperscript{${i}}`; });
"αβγδεζηθικλμνξπρστυφχψω".split("").forEach((c, i) => {
  TEX_UNICODE[c] = `$\\${"alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi chi psi omega".split(" ")[i]}$`;
});
"ΓΔΘΛΞΠΣΦΨΩ".split("").forEach((c, i) => {
  TEX_UNICODE[c] = `$\\${"Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega".split(" ")[i]}$`;
});

function texText(s) {
  return String(s).replace(/[\\&%$#_{}~^]/g, c => TEX_SPECIAL[c]).replace(/./gu, c => TEX_UNICODE[c] || c);
}

// Unit text -> siunitx: "W/(m·K)" -> \si{W/(m.K)}, "kg m^-3" -> \si{kg.m^{-3}}, "°C" -> \si{\degreeCelsius}
function texUnit(text) {
  const sup = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };
  const t = String(text).trim()
    .replace(/°C|degC/g, "\\degreeCelsius ")
    .replace(/Ω|ohm/g, "\\ohm ")
    .replace(/[µμ]/g, "\\micro ")
    .replace(/%/g, "\\percent ")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, m => "^{" + [...m].map(c => sup[c]).join("") + "}")
    .replace(/\*\*/g, "^")
    .replace(/\^\(?(-?\d+(?:\.\d+)?(?:\/\d+)?)\)?/g, "^{$1}")
    .replace(/([A-Za-z])(-?\d+)(?![\w.}])/g, "$1^{$2}")
    .replace(/\s*[·⋅×*]\s*/g, ".")
    .replace(/([A-Za-z)}])\s+(?=[A-Za-z\\(])/g, "$1.")
    .replace(/\s+$/, "");
  return `\\si{${t}}`;
}

const TEX_FORMAT = {
  text: texText,
  math: s => `$${s}$`,
  num: v => (isNumber(v) ? `\\num{${String(v).trim()}}` : texText(v)),
  count: v => (isNumber(v) ? String(v).trim() : `$${v}$`),
  unit: texUnit,
  cite: ref => `\\cite{${ref.key}}`,
  nbsp: "~"
};

function texSections(m, opts) {
  const f = { ...TEX_FORMAT, eqRef: e => (opts.equations ? `Eq.~\\eqref{${e.label}}` : `\\emph{${texText(e.title)}}`), algRef: () => "Algorithm~\\ref{alg:solution}" };
  const out = [];

  if (opts.nomenclature && m.variables.length) {
    const cols = opts.values ? 4 : 3;
    out.push(`\\section{Nomenclature}`);
    out.push(`\\begin{longtable}{@{}l p{${opts.values ? "0.48" : "0.6"}\\linewidth} l${opts.values ? " l" : ""}@{}}`);
    out.push(`  \\toprule`);
    out.push(`  Symbol & Description & Unit${opts.values ? " & Value" : ""} \\\\`);
    out.push(`  \\midrule`);
    out.push(`  \\endhead`);
    out.push(`  \\bottomrule`);
    out.push(`  \\endfoot`);
    m.variables.forEach((g, gi) => {
      if (gi) out.push(`  \\addlinespace`);
      out.push(`  \\multicolumn{${cols}}{@{}l}{\\textit{${texText(g.title)}}} \\\\`);
      g.rows.forEach(r => {
        const unit = r.units ? (isDimensionlessUnit(r.units) ? "--" : unitError(r.units) ? texText(r.units) : texUnit(r.units)) : "";
        const cells = [`$${r.symbol}$`, r.desc ? texText(r.desc) : "--", unit];
        if (opts.values) cells.push(r.value ? TEX_FORMAT.num(r.value) : "");
        out.push(`  ${cells.join(" & ")} \\\\`);
      });
    });
    out.push(`\\end{longtable}`, ``);
  }

  if (opts.equations && m.equations.length) {
    out.push(`\\section{Governing equations}`);
    m.equations.forEach(e => {
      out.push(``, `\\subsection{${texText(e.title)}}`);
      const source = sourceText(e, f, opts);
      if (source) out.push(source);
      out.push(`\\begin{equation}`, `  ${e.latex}`, `  \\label{${e.label}}`, `\\end{equation}`);
      if (e.where.length) {
        out.push(`\\noindent where`, ``, `\\noindent\\begin{tabular}{@{\\quad}l@{\\quad}p{0.7\\linewidth}@{}}`);
        e.where.forEach(r => out.push(`  $${r.symbol}$ & ${whereText(r, f)} \\\\`));
        out.push(`\\end{tabular}`, ``);
      }
      const extra = [indexSentence(e, f), conditionSentence(e, f), typeText(e, f), coupledText(e, f), e.assumptions ? `\\textit{Assumptions:} ${texText(sentence(e.assumptions))}` : ""].filter(Boolean);
      if (extra.length) out.push(`\\noindent ${extra.join(" ")}`);
    });
    out.push(``);
  }

  if (opts.algorithm && m.algorithm.length) {
    out.push(`\\section{Solution algorithm}`);
    out.push(`\\begin{algorithm}[htbp]`, `  \\caption{Solution procedure}\\label{alg:solution}`, `  \\begin{algorithmic}[1]`);
    const write = (node, pad) => {
      if (node.type === "set") out.push(`${pad}\\State ${setPhrase(node, f)}`);
      else if (node.type === "compute") out.push(`${pad}\\State ${algorithmPhrase(node, f)}`);
      else if (node.type === "for") {
        out.push(`${pad}\\For{$n = 1, \\dots, ${node.entry.settings.steps}$}`);
        out.push(`${pad}  \\State ${algorithmPhrase(node, f)}`);
        out.push(`${pad}\\EndFor`);
      } else if (node.type === "until") {
        const s = node.entry.settings;
        out.push(`${pad}\\Repeat`);
        out.push(`${pad}  \\State ${algorithmPhrase(node, f)}`);
        out.push(`${pad}\\Until{the change in ${listJoin(node.entry.outputs.map(f.math))} is below ${f.num(s.tol)} (at most ${f.count(s.maxIter)} iterations)}`);
      } else if (node.type === "root") {
        const e = node.entry, s = e.settings;
        out.push(`${pad}\\State Start from ${guessText(e, f)}${s.min || s.max ? `, branch ${branchRange(e, f)}` : ""}`);
        out.push(`${pad}\\Repeat \\Comment{${texText(s.method)}}`);
        out.push(`${pad}  \\State ${algorithmPhrase(node, f)}`);
        out.push(`${pad}\\Until{the relative step in ${f.math(e.outputs[0])} is below ${f.num(s.rootTol)} (at most ${f.count(s.rootMaxIter)} iterations)}`);
      } else if (node.type === "define") {
        out.push(`${pad}\\State ${algorithmPhrase(node, f)}`);
      } else if (node.type === "switch") {
        node.cases.forEach((c, k) => {
          out.push(c.cond ? `${pad}\\${k ? "ElsIf" : "If"}{${f.math(c.cond)}}` : `${pad}\\Else`);
          c.body.forEach(b => write(b, pad + "  "));
        });
        if (!node.otherwise) out.push(`${pad}\\Else`, `${pad}  \\State Keep the start value of ${f.math(node.symbol)}`);
        out.push(`${pad}\\EndIf`);
      } else if (node.type === "ode") {
        out.push(`${pad}\\For{${odeHead(node, f)}} \\Comment{${ODE_METHODS[node.settings.method].short}}`);
        node.algebraic.forEach(b => write(b, pad + "  "));
        out.push(`${pad}  \\State ${odePhrase(node, f)}`);
        out.push(`${pad}\\EndFor`);
      } else if (node.type === "coupled") {
        out.push(`${pad}\\Repeat \\Comment{coupled block: solved together}`);
        node.body.forEach(b => write(b, pad + "  "));
        out.push(`${pad}\\Until{${listJoin(node.outputs.map(f.math))} change by less than ${f.num(node.tol)} (at most ${node.maxIter} iterations)}`);
      }
    };
    m.algorithm.forEach(node => write(node, "    "));
    out.push(`  \\end{algorithmic}`, `\\end{algorithm}`, ``);
  }

  if (opts.flowchart && m.algorithm.some(n => n.type !== "set")) {
    const fc = buildFlowchart(projectData.flowchart, m);
    if (opts.algorithm) out.push(`Figure~\\ref{fig:flowchart} shows the same procedure as a flowchart.`, ``);
    else out.push(`\\section{Solution procedure}`);
    out.push(`\\begin{figure}[htbp]`, `  \\centering`, `  \\begin{adjustbox}{max width=\\linewidth, max totalheight=0.9\\textheight}`);
    out.push(flowTikz(fc, projectData.flowchart, e => (opts.equations ? `Eq.~\\eqref{${e.label}}` : null)));
    out.push(`  \\end{adjustbox}`, `  \\caption{Flowchart of the solution procedure}\\label{fig:flowchart}`, `\\end{figure}`, ``);
  }
  return { body: out.join("\n"), f };
}

function writeBib(m) {
  return m.references.map(r => {
    const fields = [];
    if (r.author) fields.push(`  author = {${texText(r.author)}}`);
    if (r.year) fields.push(`  year   = {${texText(r.year)}}`);
    if (r.text) fields.push(`  note   = {${texText(r.text)}}`);
    if (!r.author) fields.push(`  key    = {${texText(r.text.slice(0, 40))}}`);
    return `@misc{${r.key},\n${fields.join(",\n")}\n}`;
  }).join("\n\n");
}

function writeReportLatex(m, opts) {
  const { body, f } = texSections(m, opts);
  const bib = writeBib(m);
  const useRefs = opts.references && m.references.length > 0;
  const packages = ["\\usepackage{amsmath,amssymb}"];
  if (opts.nomenclature) packages.push("\\usepackage{booktabs,longtable}");
  packages.push("\\usepackage{siunitx}");
  if (opts.algorithm) packages.push("\\usepackage{algorithm}", "\\usepackage{algpseudocode}");
  if (opts.flowchart) packages.push("\\usepackage{tikz}", TIKZ_LIBRARIES, "\\usepackage{adjustbox}");

  if (opts.mode === "fragment") {
    const head = [
      `% Model report generated by SolverMapp. \\input{} this file into your document.`,
      `% It needs these packages in the preamble:`,
      ...packages.map(p => "%   " + p)
    ];
    if (useRefs) head.push(`% Citations use references.bib (Download .bib): add \\bibliography{references} to your document.`);
    return { tex: head.join("\n") + "\n\n" + body, bib };
  }

  const tex = [`% Model report generated by SolverMapp.`];
  if (useRefs) {
    tex.push(`% Compile with: pdflatex, bibtex, pdflatex, pdflatex (references.bib is written by the first run).`);
    tex.push(`\\begin{filecontents*}[overwrite]{references.bib}`, bib, `\\end{filecontents*}`);
  } else {
    tex.push(`% Compile with pdflatex (twice, for the equation and algorithm references).`);
  }
  tex.push(
    `\\documentclass[11pt,a4paper]{article}`,
    `\\usepackage[T1]{fontenc}`,
    `\\usepackage[utf8]{inputenc}`,
    `\\usepackage{lmodern}`,
    ...packages,
    `\\usepackage[hidelinks]{hyperref}`,
    ``,
    `\\title{${texText(m.title)}}`,
    `\\author{${texText(m.author)}}`,
    `\\date{\\today}`,
    ``,
    `\\begin{document}`,
    `\\maketitle`,
    ``,
    overviewText(m, f, opts),
    ``,
    body
  );
  if (useRefs) tex.push(`\\bibliographystyle{plain}`, `\\bibliography{references}`, ``);
  tex.push(`\\end{document}`);
  return { tex: tex.join("\n"), bib };
}

// ---------- HTML preview ----------
function writeReportPreview(m, opts) {
  const refNumber = new Map([...m.references].sort((a, b) => (a.author || a.text).localeCompare(b.author || b.text) || a.year.localeCompare(b.year)).map((r, i) => [r, i + 1]));
  const f = {
    text: escapeHtml,
    math: s => renderMath(s),
    num: v => escapeHtml(v),
    count: v => (isNumber(v) ? escapeHtml(v) : renderMath(v)),
    unit: u => escapeHtml(u),
    cite: ref => `[${refNumber.get(ref) || "?"}]`,
    nbsp: "&nbsp;",
    eqRef: e => (opts.equations ? `Eq. (${e.number})` : `<em>${escapeHtml(e.title)}</em>`),
    algRef: () => "Algorithm 1"
  };
  const html = [`<h1>${escapeHtml(m.title)}</h1>`];
  if (opts.mode === "standalone") {
    html.push(`<p class="rp-author">${escapeHtml(m.author)}${m.author ? " · " : ""}${new Date().toLocaleDateString()}</p>`);
    html.push(`<p>${overviewText(m, f, opts)}</p>`);
  }
  let section = 0;

  if (opts.nomenclature && m.variables.length) {
    html.push(`<h2>${++section}&ensp;Nomenclature</h2>`);
    html.push(`<table class="rp-table"><thead><tr><th>Symbol</th><th>Description</th><th>Unit</th>${opts.values ? "<th>Value</th>" : ""}</tr></thead>`);
    m.variables.forEach(g => {
      html.push(`<tbody><tr class="rp-group"><td colspan="${opts.values ? 4 : 3}">${escapeHtml(g.title)}</td></tr>`);
      g.rows.forEach(r => {
        const unit = r.units ? (isDimensionlessUnit(r.units) ? "–" : escapeHtml(r.units)) : "";
        html.push(`<tr><td>${renderMath(r.symbol)}</td><td>${r.desc ? escapeHtml(r.desc) : "–"}</td><td>${unit}</td>${opts.values ? `<td>${escapeHtml(r.value)}</td>` : ""}</tr>`);
      });
      html.push(`</tbody>`);
    });
    html.push(`</table>`);
  }

  if (opts.equations && m.equations.length) {
    html.push(`<h2>${++section}&ensp;Governing equations</h2>`);
    m.equations.forEach((e, i) => {
      html.push(`<h3>${section}.${i + 1}&ensp;${escapeHtml(e.title)}</h3>`);
      const source = sourceText(e, f, opts);
      if (source) html.push(`<p class="rp-source">${source}</p>`);
      let math;
      math = renderMath(e.latex, true);
      html.push(`<div class="rp-eq"><div>${math}</div><span class="rp-eqnum">(${e.number})</span></div>`);
      if (e.where.length) {
        html.push(`<p>where</p><table class="rp-where">${e.where.map(r => `<tr><td>${renderMath(r.symbol)}</td><td>${whereText(r, f)}</td></tr>`).join("")}</table>`);
      }
      const extra = [indexSentence(e, f), conditionSentence(e, f), typeText(e, f), coupledText(e, f), e.assumptions ? `<em>Assumptions:</em> ${escapeHtml(sentence(e.assumptions))}` : ""].filter(Boolean);
      if (extra.length) html.push(`<p>${extra.join(" ")}</p>`);
    });
  }

  if (opts.algorithm && m.algorithm.length) {
    html.push(`<h2>${++section}&ensp;Solution algorithm</h2>`);
    const lines = [];
    const kw = w => `<span class="rp-kw">${w}</span>`;
    const write = (node, depth) => {
      const add = (text, d = depth) => lines.push({ text, depth: d });
      if (node.type === "set") add(setPhrase(node, f));
      else if (node.type === "compute") add(algorithmPhrase(node, f));
      else if (node.type === "for") {
        add(`${kw("for")} ${renderMath(`n = 1, \\dots, ${node.entry.settings.steps}`)} ${kw("do")}`);
        add(algorithmPhrase(node, f), depth + 1);
        add(kw("end for"));
      } else if (node.type === "until") {
        const s = node.entry.settings;
        add(kw("repeat"));
        add(algorithmPhrase(node, f), depth + 1);
        add(`${kw("until")} the change in ${listJoin(node.entry.outputs.map(f.math))} is below ${f.num(s.tol)} (at most ${f.count(s.maxIter)} iterations)`);
      } else if (node.type === "root") {
        const e = node.entry, s = e.settings;
        add(`Start from ${guessText(e, f)}${s.min || s.max ? `, branch ${branchRange(e, f)}` : ""}`);
        add(`${kw("repeat")} <span class="muted">▷ ${escapeHtml(s.method)}</span>`);
        add(algorithmPhrase(node, f), depth + 1);
        add(`${kw("until")} the relative step in ${f.math(e.outputs[0])} is below ${f.num(s.rootTol)} (at most ${f.count(s.rootMaxIter)} iterations)`);
      } else if (node.type === "define") {
        add(algorithmPhrase(node, f));
      } else if (node.type === "switch") {
        node.cases.forEach((c, k) => {
          add(c.cond ? `${kw(k ? "else if" : "if")} ${f.math(c.cond)} ${kw("then")}` : kw("else"));
          c.body.forEach(b => write(b, depth + 1));
        });
        if (!node.otherwise) { add(kw("else")); add(`Keep the start value of ${f.math(node.symbol)}`, depth + 1); }
        add(kw("end if"));
      } else if (node.type === "ode") {
        add(`${kw("for")} ${odeHead(node, f)} ${kw("do")} <span class="muted">▷ ${ODE_METHODS[node.settings.method].short}</span>`);
        node.algebraic.forEach(b => write(b, depth + 1));
        add(odePhrase(node, f), depth + 1);
        add(kw("end for"));
      } else if (node.type === "coupled") {
        add(`${kw("repeat")} <span class="muted">▷ coupled block: solved together</span>`);
        node.body.forEach(b => write(b, depth + 1));
        add(`${kw("until")} ${listJoin(node.outputs.map(f.math))} change by less than ${f.num(node.tol)} (at most ${node.maxIter} iterations)`);
      }
    };
    m.algorithm.forEach(node => write(node, 0));
    html.push(`<div class="rp-algo"><div class="rp-algo-caption"><strong>Algorithm 1</strong> Solution procedure</div>` +
      lines.map((l, i) => `<div class="rp-algo-line"><span class="rp-algo-n">${i + 1}:</span><span style="padding-left:${l.depth * 22}px">${l.text}</span></div>`).join("") +
      `</div>`);
  }

  if (opts.flowchart && m.algorithm.some(n => n.type !== "set")) {
    if (opts.algorithm) html.push(`<p>Figure 1 shows the same procedure as a flowchart.</p>`);
    else html.push(`<h2>${++section}&ensp;Solution procedure</h2>`);
    // Without the Equations section there are no equation numbers to refer to.
    const flowOpts = { ...projectData.flowchart, numbers: projectData.flowchart.numbers && opts.equations };
    const { fc, size } = renderFlowchart(flowOpts, m);
    html.push(`<figure class="rp-figure">${flowSvg(fc, size, flowOpts, { idPrefix: "rpf" })}<figcaption>Figure 1: Flowchart of the solution procedure</figcaption></figure>`);
  }

  if (opts.references && m.references.length) {
    html.push(`<h2>References</h2><ol class="rp-refs">`);
    [...refNumber.keys()].forEach(r => html.push(`<li>${escapeHtml([r.author, r.year && `(${r.year})`].filter(Boolean).join(" "))}${r.author && r.text ? ". " : ""}${escapeHtml(r.text)}</li>`));
    html.push(`</ol>`);
  }

  if (html.length === (opts.mode === "standalone" ? 3 : 1)) html.push(`<p class="rp-empty">Choose at least one section, and add equations in step 1.</p>`);
  return html.join("\n");
}

// ---------- Report view ----------
function setReportOption(key, value) {
  projectData.report[key] = value;
  triggerAutoSave();
  renderReportView();
}

function setReportView(view) {
  reportView = view;
  renderReportView();
}

function syncReportForm() {
  const opts = projectData.report;
  const setIfIdle = (id, value) => { if (document.activeElement !== $(id)) $(id).value = value; };
  setIfIdle("reportTitle", opts.title);
  setIfIdle("reportAuthor", opts.author);
  document.querySelectorAll("[data-report]").forEach(el => { el.checked = !!opts[el.dataset.report]; });
  $("reportGrouping").value = opts.grouping;
  $("reportGrouping").disabled = !opts.nomenclature;
  ["standalone", "fragment"].forEach(m => $("reportMode_" + m).classList.toggle("active", opts.mode === m));
  $("reportModeHelp").innerHTML = opts.mode === "standalone"
    ? "One .tex file that compiles on its own with pdflatex; the references are embedded in it."
    : "Only the sections, to <code>\\input{}</code> into your own document. The packages it needs are listed at its top; use Download .bib for the references.";
  ["preview", "source"].forEach(v => $("reportView_" + v).classList.toggle("active", reportView === v));
}

function renderReportView() {
  const opts = projectData.report;
  syncReportForm();
  const model = buildReportModel(opts);
  reportOutput = writeReportLatex(model, opts);
  $("reportPreview").hidden = reportView !== "preview";
  $("reportSource").hidden = reportView !== "source";
  if (reportView === "preview") $("reportPreview").innerHTML = writeReportPreview(model, opts);
  else $("reportSource").textContent = reportOutput.tex;
  $("reportBibBtn").disabled = !reportOutput.bib;
  $("reportNotes").innerHTML = model.notes.map(n => `<li>${n}</li>`).join("");
  $("reportNotes").hidden = model.notes.length === 0;
}

function reportFileName() {
  return (slugify(projectData.report.title).replace(/-/g, "_") || "model_report") + ".tex";
}

function copyReport() {
  const btn = $("reportCopyBtn");
  navigator.clipboard.writeText(reportOutput.tex).then(() => {
    btn.textContent = "Copied ✓";
    setTimeout(() => btn.textContent = "Copy LaTeX", 1500);
  });
}

function downloadReportTex() {
  downloadText(reportFileName(), reportOutput.tex);
}

function downloadReportBib() {
  if (reportOutput.bib) downloadText("references.bib", reportOutput.bib + "\n");
}

function bindReportEvents() {
  $("reportTitle").addEventListener("input", e => setReportOption("title", e.target.value));
  $("reportAuthor").addEventListener("input", e => setReportOption("author", e.target.value));
  $("reportGrouping").addEventListener("change", e => setReportOption("grouping", e.target.value));
  document.querySelectorAll("[data-report]").forEach(el => {
    el.addEventListener("change", () => setReportOption(el.dataset.report, el.checked));
  });
}
