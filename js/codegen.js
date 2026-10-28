// SolverMapp — Code generators: Python, MATLAB and Fortran solvers (Newton, RK4, loops, CSV output).
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// CODE GENERATORS
// Each step of the plan is a list of units: an equation, a switch (equations for one output
// under conditions: if / else if / else) or an ODE system (integrated together, with the
// algebraic equations it needs evaluated in every stage). Each language writes the same units.
// ================================================================
function indentLines(lines, pad) {
  return lines.flatMap(l => l.split("\n")).map(l => (l ? pad + l : l));
}

// Variables computed by a coupled block that stage 0 does not set: they need a starting guess.
function coupledGuesses(step, varList) {
  return step.computes
    .map(s => varList.find(v => v.symbol === s))
    .filter(v => v && !isGiven(v) && !v.callable);
}

function coupledNames(step) {
  return step.eqs.map(e => e.name || "Untitled").join(", ");
}

// Scalars first: the size of an array can depend on one (m = np.full(int(N), ...) needs N).
const startValues = varList => [...varList.filter(v => isGiven(v) && !v.shape), ...varList.filter(v => isGiven(v) && v.shape)];

// Start value of a vector or matrix: "1, 2, 3", "1, 2; 3, 4" (rows), "I" (identity) or one
// value for every element.
function arrayStart(v) {
  const t = String(v.initVal || "").trim().replace(/^\[(.*)\]$/, "$1");
  if (/^(I|eye)$/i.test(t)) return { kind: "eye" };
  if (t.includes(";")) return { kind: "rows", rows: t.split(";").map(r => r.split(",").map(x => x.trim()).filter(Boolean)) };
  if (t.includes(",")) return { kind: "list", values: t.split(",").map(x => x.trim()).filter(Boolean) };
  return { kind: "fill", value: t || "0.0" };
}

// Start value (or starting guess) of a variable in one language: scalars as typed, vectors and
// matrices from arrayStart and the Size column.
function startCode(v, lang, used) {
  const shape = v.shape && !v.shape.error ? v.shape : null;
  if (!shape) return lang === "fortran" ? fortranNumbers(v.initVal || "1.0") : (v.initVal || "1.0");
  const s = arrayStart(v);
  const d = shape.dims;
  if (lang === "python") {
    used.add("numpy");
    const n = d.map(pyInt);
    if (s.kind === "eye") return `np.eye(${n[0]})`;
    if (s.kind === "rows") return `np.array([${s.rows.map(r => `[${r.join(", ")}]`).join(", ")}], dtype=float)`;
    if (s.kind === "list") return `np.array([${s.values.join(", ")}], dtype=float)${shape.rank === 2 ? `.reshape(${n.join(", ")})` : ""}`;
    return `np.full(${shape.rank === 2 ? `(${n.join(", ")})` : n[0]}, ${s.value}, dtype=float)`;
  }
  if (lang === "matlab") {
    if (s.kind === "eye") return `eye(${d[0]})`;
    if (s.kind === "rows") return `[${s.rows.map(r => r.join(", ")).join("; ")}]`;
    if (s.kind === "list") return shape.rank === 2 ? `reshape([${s.values.join(", ")}], ${d[1]}, ${d[0]}).'` : `[${s.values.join("; ")}]`;
    return `${s.value} * ones(${d[0]}, ${shape.rank === 2 ? d[1] : 1})`;
  }
  const f = x => fortranNumbers(x);
  if (s.kind === "eye") { used.add("eye"); return `eye(${fInt(d[0])})`; }
  if (s.kind === "rows") return `reshape([${s.rows.flat().map(f).join(", ")}], [${s.rows.length}, ${s.rows[0].length}], order=[2, 1])`;
  if (s.kind === "list") return shape.rank === 2 ? `reshape([${s.values.map(f).join(", ")}], [${d.map(fInt).join(", ")}], order=[2, 1])` : `[${s.values.map(f).join(", ")}]`;
  return null; // filled after an allocate (see fortranStart)
}

const shapeOfCode = name => shapeTable()[name] || null;
const isArrayName = name => !!shapeOfCode(name);

function implicitNote(p, c) {
  const lines = [`${c} ${ROOT_METHODS[p.method] || ROOT_METHODS.newton} on the residual (left side - right side) = 0, solved for ${p.out}`];
  if (!ROOT_METHODS[p.method]) lines.push(`${c} (method "${p.method}" is not available yet: Newton-Raphson is used)`);
  if (p.min || p.max) lines.push(p.vector ? `${c} (min / max apply to scalar unknowns only)` : `${c} Branch: ${[p.min, p.out, p.max].filter(Boolean).join(" <= ")}`);
  return lines;
}

// The unknown limited to its branch: min(max(x, lo), hi) — the same in Python, MATLAB and Fortran.
function clampCode(p, wrap = t => t) {
  let e = p.out;
  if (p.min) e = `max(${e}, ${wrap(p.min)})`;
  if (p.max) e = `min(${e}, ${wrap(p.max)})`;
  return e;
}

const header = (eq, c) => {
  const ref = refText(eq);
  return [`${c} --- [${(eq.archetype || "explicit").toUpperCase()}] ${eq.name || "Untitled"}${ref ? ` (${ref})` : ""} ---`,
    `${c} LaTeX: ${eq.latex}${eq.assumptions ? ` | Assumptions: ${eq.assumptions}` : ""}`];
};

// A setting of an ODE (bound) as code: a number, a variable or a LaTeX expression.
function odeBound(text) {
  if (isNumber(text)) return text.trim();
  return latexToCode(text, [...new Set(projectData.equations.flatMap(e => [...e.inputs, ...e.outputs]))]);
}

// The solution of an ODE system as a CSV file (setting save = k): t and every state, vectors and
// matrices flattened row by row (header t, x[1], x[2], ... written at run time, so it also fits
// sizes given by a variable), at the start and every k steps. The same file from every language.
function odeHistory(system, ctx) {
  const s = system.settings;
  if (!s.save) return null;
  const k = ++ctx.counter.ode;
  const cols = [codeOf(s.independent), ...system.states.map(codeOf)];
  return { k, file: `ode_system_${k}.csv`, cols, every: s.save, rank: name => shapeOfCode(name)?.rank || 0 };
}

// Comment lines naming the ODE cards of a system, as written; a second-order card notes its two states.
function odeCardComments(system, c) {
  return system.cards.flatMap(eq => {
    const lines = [`${c} ${eq.name || "Untitled"}: ${eq.latex}`];
    const parts = firstOrderOdes(eq);
    if (parts.length === 2) lines.push(`${c}   second order, integrated as ${parts.map(p => codeOf(p.outputs[0])).join(" and ")}: ${parts.map(p => p.latex).join(" ; ")}`);
    return lines;
  });
}

// Lines of every unit of a list, in one language.
function unitsLines(units, L, ctx) {
  return units.flatMap(unit => {
    if (unit.kind === "switch") return L.switch(unit.group, ctx);
    if (unit.kind === "ode") return L.ode(unit.system, ctx);
    return [...L.eq({ ...equationPlan(unit.eq, ctx.arrays), inCoupled: ctx.inCoupled }, ctx), ""];
  });
}

function switchCases(group) {
  return group.eqs.map(eq => ({ eq, cond: conditionText(eq) ? conditionToCode(eq.condition) : "" }));
}

// ---------- Python ----------
const pyInt = v => (isNumber(v) ? v : `int(${v})`);

const PY = {
  c: "#",
  eq(p, ctx) {
    const { eq, arch, out } = p;
    const ex = code => langCode(code, "python", undefined, ctx.used);
    const rhs = p.free.length || p.hasSums ? "" : rhsFor(p, "python", ctx.used); // index notation: see assignLines
    const lines = header(eq, "#");
    const big = isArrayName(out);
    if (big) ctx.used.add("numpy");
    const change = (a, b) => (big ? `np.max(np.abs(${a} - ${b}))` : `abs(${a} - ${b})`);
    if (arch === "marching") {
      lines.push(`for step in range(${pyInt(p.steps)}):`, `    ${out} = ${rhs}`);
    } else if (arch === "convergence") {
      lines.push(`tol, max_iter = ${p.tol}, ${pyInt(p.maxIter)}`, `for it in range(max_iter):`, `    ${out}_new = ${rhs}`,
        `    if ${change(`${out}_new`, out)} < tol:`, `        ${out} = ${out}_new`, `        break`, `    ${out} = ${out}_new`,
        `else:`, `    print("Warning: ${out} did not converge in", max_iter, "iterations")`);
    } else if (arch === "summation") {
      lines.push(`${out} = 0.0`, `for ${p.index} in range(${pyInt(p.lo)}, ${pyInt(p.hi)} + 1):`, `    ${out} += ${rhs}`);
    } else if (arch === "integral") {
      lines.push(`# Trapezoidal rule over ${p.x} from ${p.lo} to ${p.hi}`, `n_quad = ${pyInt(p.n)}`, `dx = (${p.hi} - ${p.lo}) / n_quad`,
        `${out} = 0.0`, `for q in range(n_quad + 1):`, `    ${p.x} = ${p.lo} + q * dx`, `    w_q = 0.5 if q in (0, n_quad) else 1.0`,
        `    ${out} += w_q * (${rhs}) * dx`);
    } else if (arch === "implicit") {
      lines.push(...implicitNote(p, "#"));
      if (p.linear) {
        ctx.used.add("numpy");
        lines.push(`# Linear in ${out}: solved directly`, `${out} = np.linalg.solve(${langTree(p.linear.A, "python", ctx.used)}, ${langTree(p.linear.b, "python", ctx.used)})`);
        return lines;
      }
      const guess = p.guessFromStart ? startCode(varOf(eq.outputs[0]), "python", ctx.used) : ex(p.guess);
      lines.push(`def ${p.fn}(${out}):`, `    return ${ex(p.residual)}`);
      lines.push(p.inCoupled ? `# starts from the value of the previous pass` : `${out} = ${guess}  # initial guess`);
      lines.push(`tol, max_iter = ${p.tol}, ${pyInt(p.maxIter)}`, `for it in range(max_iter):`);
      if (p.vector) {
        ctx.used.add("numpy");
        lines.push(`    r_nr = ${p.fn}(${out})`, `    jac_nr = np.zeros((r_nr.size, ${out}.size))`, `    for j_nr in range(${out}.size):`,
          `        e_nr = np.zeros(${out}.size)`, `        e_nr[j_nr] = 1e-6 * max(abs(${out}[j_nr]), 1e-6)`,
          `        jac_nr[:, j_nr] = (${p.fn}(${out} + e_nr) - ${p.fn}(${out} - e_nr)) / (2 * e_nr[j_nr])`,
          `    ${out}_new = ${out} - np.linalg.solve(jac_nr, r_nr)`,
          `    if np.max(np.abs(${out}_new - ${out})) < tol * (1 + np.max(np.abs(${out}))):`);
      } else {
        if (p.min || p.max) lines.splice(lines.length - 2, 0, `${out} = ${clampCode(p, ex)}  # start on the branch`);
        lines.push(`    h_nr = 1e-6 * max(abs(${out}), 1e-6)`, `    dr_nr = (${p.fn}(${out} + h_nr) - ${p.fn}(${out} - h_nr)) / (2 * h_nr)`,
          `    if dr_nr == 0:`, `        print("Warning: zero derivative in the Newton iteration for ${out}")`, `        break`,
          `    ${out}_new = ${out} - ${p.fn}(${out}) / dr_nr`);
        if (p.min) lines.push(`    if ${out}_new < ${ex(p.min)}: ${out}_new = 0.5 * (${out} + ${ex(p.min)})  # stay on the branch`);
        if (p.max) lines.push(`    if ${out}_new > ${ex(p.max)}: ${out}_new = 0.5 * (${out} + ${ex(p.max)})  # stay on the branch`);
        lines.push(`    if abs(${out}_new - ${out}) < tol * (1 + abs(${out})):`);
      }
      lines.push(`        ${out} = ${out}_new`, `        break`, `    ${out} = ${out}_new`, `else:`,
        `    print("Warning: ${out} did not converge in", max_iter, "iterations")`);
    } else if (arch === "function") {
      lines.push(`def ${out}(${p.params.join(", ")}):`, `    return ${ex(p.code)}`);
    } else if (arch === "ode") {
      lines.push(`# integrated in its ODE system`);
    } else {
      if (p.free.length || p.hasSums) lines.push(...assignLines("python", out, p, ctx));
      else lines.push(`${out} = ${rhs}`);
    }
    return lines;
  },
  switch(group, ctx) {
    const lines = [`# --- SWITCH: ${codeOf(group.symbol)} by case ---`];
    switchCases(group).forEach((c, k) => {
      const body = indentLines(PY.eq({ ...equationPlan(c.eq, ctx.arrays), inCoupled: ctx.inCoupled }, ctx), "    ");
      if (!c.cond) lines.push(`else:`, ...body);
      else lines.push(`${k ? "elif" : "if"} ${langCode(c.cond, "python")}:`, ...body);
    });
    if (!group.otherwise) lines.push(`else:`, `    print("Warning: no case applies for ${codeOf(group.symbol)}: its start value is used")`,
      `    ${codeOf(group.symbol)} = ${startCode(varOf(group.symbol), "python", ctx.used)}`);
    return [...lines, ""];
  },
  ode(system, ctx) {
    const { settings: s } = system;
    const m = ODE_METHODS[s.method];
    const t = codeOf(s.independent);
    const states = system.odes.map(eq => { const y = codeOf(eq.outputs[0]); return { eq, y, rate: assignLines("python", `${y}_rate`, equationPlan(eq), ctx, { rateOf: y }) }; });
    const alg = indentLines(unitsLines(system.algebraic, PY, ctx).filter(Boolean), "");
    const lines = [`# --- [ODE SYSTEM] ${states.map(x => x.y).join(", ")} over ${t}: ${m.short}, ${s.steps} steps ---`];
    lines.push(...odeCardComments(system, "#"));
    if (s.unknownMethod) lines.push(`# (method "${s.unknownMethod}" is not available: RK4 is used)`);
    lines.push(`${t} = ${langCode(odeBound(s.from), "python")}`, `h_rk = (${langCode(odeBound(s.to), "python")} - ${t}) / ${s.steps}`);
    const hist = odeHistory(system, ctx);
    const f = hist && `f_ode${hist.k}`;
    if (hist) {
      ctx.used.add("ode_row");
      lines.push(`# Solution every ${hist.every} steps -> ${hist.file}`, `${f} = open("${hist.file}", "w")`,
        `${f}.write(ode_header(${JSON.stringify(hist.cols)}, ${hist.cols.join(", ")}))`, `${f}.write(ode_row(${hist.cols.join(", ")}))`);
    }
    lines.push(`for step in range(${pyInt(s.steps)}):`);
    if (s.method === "euler") {
      lines.push(...indentLines(alg, "    "), ...states.flatMap(x => indentLines(x.rate, "    ")), `    ${t} = ${t} + h_rk`,
        ...states.map(x => `    ${x.y} = ${x.y} + h_rk * ${x.y}_rate`));
    } else {
      lines.push(`    ${t}_rk0 = ${t}`, ...states.map(x => `    ${x.y}_rk0, ${x.y}_acc = ${x.y}, 0.0`), `    for stage in range(4):`,
        ...indentLines(alg, "        "), ...states.flatMap(x => indentLines(x.rate, "        ")),
        ...states.map(x => `        ${x.y}_acc = ${x.y}_acc + (1, 2, 2, 1)[stage] * ${x.y}_rate`),
        `        if stage < 3:`, `            c_rk = (0.5, 0.5, 1.0)[stage]`, `            ${t} = ${t}_rk0 + c_rk * h_rk`,
        ...states.map(x => `            ${x.y} = ${x.y}_rk0 + c_rk * h_rk * ${x.y}_rate`),
        `    ${t} = ${t}_rk0 + h_rk`, ...states.map(x => `    ${x.y} = ${x.y}_rk0 + h_rk / 6 * ${x.y}_acc`));
    }
    if (hist) lines.push(`    if (step + 1) % ${hist.every} == 0:`, `        ${f}.write(ode_row(${hist.cols.join(", ")}))`, `${f}.close()`);
    if (alg.length) lines.push(`# Algebraic equations at the final ${t}`, ...alg);
    return [...lines, ""];
  }
};

function generatePythonCode(plan, varList) {
  const arrays = indexedArrays(plan, varList);
  const used = new Set(projectHasArrays(varList) ? ["numpy"] : []);
  const ctx = { arrays, used, inCoupled: false, counter: { ode: 0 } };
  const body = [];
  body.push(`def run_solver():`);
  body.push(`    # ==========================================================================`);
  body.push(`    # STAGE 0: INPUTS AND START VALUES OF STATE VARIABLES`);
  body.push(`    # ==========================================================================`);
  const comment = v => `# [${roleLabel(v)}] (${v.units || "-"}) ${v.desc}`.trimEnd();
  startValues(varList).filter(v => !arrays.has(v.symbol)).forEach(v => {
    body.push(`    ${v.codeVar.padEnd(10)} = ${startCode(v, "python", used)}  ${comment(v)}`);
  });
  startValues(varList).filter(v => arrays.has(v.symbol)).forEach(v => {
    const { lo, hi } = arrays.get(v.symbol);
    const list = listValues(v.initVal);
    const size = lo === "1" ? pyInt(hi) : `${pyInt(hi)} - ${pyInt(lo)} + 1`;
    body.push(`    ${v.codeVar.padEnd(10)} = ${list ? `[${list.join(", ")}]` : `[${v.initVal || "1.0"}] * (${size})`}  ${comment(v)}, indexed ${lo}..${hi}`);
  });
  varList.filter(v => v.callable && !v.definedAsFunction && !projectData.equations.some(e => e.archetype === "function" && e.outputs[0] === v.symbol)).forEach(v => {
    body.push(`    def ${v.codeVar}(${v.args.map(codeOf).join(", ")}):  ${comment(v)}`, `        return ${v.initVal || "1.0"}  # TODO: ${v.codeVar} as a function of ${v.args.map(codeOf).join(", ")}`);
  });

  plan.steps.forEach((step, sIdx) => {
    body.push(`\n    # ==========================================================================`);
    body.push(`    # STAGE ${sIdx + 1}: ${step.coupled ? "COUPLED BLOCK" : step.units.some(u => u.kind === "ode") ? "ODE INTEGRATION" : "EXECUTION BLOCK"}`);
    body.push(`    # ==========================================================================`);
    if (!step.coupled) {
      body.push(...indentLines(unitsLines(step.units, PY, ctx), "    "));
      return;
    }
    const names = step.computes.map(codeOf).join(", ");
    const big = step.computes.some(s => isArrayName(codeOf(s)));
    body.push(`    # ${coupledNames(step)} depend on each other:`);
    body.push(`    # solved together by fixed-point iteration, starting from the Start column.`);
    coupledGuesses(step, varList).forEach(v => body.push(`    ${v.codeVar.padEnd(10)} = ${startCode(v, "python", used)}  # starting guess`));
    body.push(`    tol_c, max_iter_c = 1e-8, 200`);
    body.push(`    for it_c in range(max_iter_c):`);
    body.push(`        prev_c = [${names}]`);
    body.push(...indentLines(unitsLines(step.units, PY, { ...ctx, inCoupled: true }), "        "));
    body.push(big
      ? `        if max(np.max(np.abs(np.subtract(x_c, p_c))) for x_c, p_c in zip([${names}], prev_c)) < tol_c:`
      : `        if max(abs(x_c - p_c) for x_c, p_c in zip([${names}], prev_c)) < tol_c:`);
    body.push(`            break`);
    body.push(`    else:`);
    body.push(`        print("Warning: coupled block (${names}) did not converge in", max_iter_c, "iterations")`);
    body.push(``);
  });

  if (used.has("ode_row")) {
    body.splice(1, 0, `    def ode_row(*values):  # one CSV line: scalars, and vectors / matrices flattened row by row`,
      `        flat = []`, `        for v in values:`, `            flat.extend(v.ravel().tolist() if hasattr(v, "ravel") else [v])`,
      `        return ",".join(repr(float(x)) for x in flat) + "\\n"`, ``,
      `    def ode_header(names, *values):  # t, then x[1], x[2], ... for the elements of each array`,
      `        cols = []`, `        for name, v in zip(names, values):`,
      `            cols += [f"{name}[{k + 1}]" for k in range(v.size)] if hasattr(v, "ravel") else [name]`,
      `        return ",".join(cols) + "\\n"`, ``);
  }
  body.push(`    return {`);
  varList.filter(v => !v.callable).forEach(v => {
    body.push(`        "${v.codeVar}": ${v.codeVar},  # [${v.units || "-"}] ${v.desc}`.trimEnd());
  });
  body.push(`    }\n`);
  body.push(`if __name__ == "__main__":`);
  body.push(`    res = run_solver()`);
  body.push(`    for k, val in res.items():`);
  body.push(`        print(f"{k:12s} = {val}")`);

  const lines = [`"""`, `Solver generated by SolverMapp`,
    `Equation types: explicit, marching loop, convergence loop, summation, integral (trapezoidal rule),`,
    `implicit (Newton-Raphson or linear solve), ODE (RK4 or Euler), function; plus switches and coupled blocks`,
    `"""`, `import math`];
  if (used.has("numpy")) lines.push(`import numpy as np`, `from numpy import sqrt, exp, log, log10, sin, cos, tan\n`);
  else lines.push(`from math import sqrt, exp, log, log10, sin, cos, tan\n`);
  return [...lines, ...body].join("\n");
}

// ---------- MATLAB ----------
const mlRow = h => `[${h.cols.map(c => (h.rank(c) === 2 ? `reshape(${c}.', 1, [])` : h.rank(c) === 1 ? `${c}(:).'` : c)).join(", ")}]`;
const ML = {
  c: "%",
  eq(p, ctx) {
    const { eq, arch, out } = p;
    const ex = code => langCode(code, "matlab");
    const rhs = p.free.length || p.hasSums ? "" : rhsFor(p, "matlab");
    const lines = [`% [${arch.toUpperCase()}] ${eq.name || "Untitled"}: ${eq.latex}`];
    const big = isArrayName(out);
    const change = (a, b) => (big ? `max(abs(${a} - ${b}), [], 'all')` : `abs(${a} - ${b})`);
    if (arch === "marching") {
      lines.push(`for step = 1:${p.steps}\n    ${out} = ${rhs};\nend`);
    } else if (arch === "convergence") {
      lines.push(`converged = false;`);
      lines.push(`for it = 1:${p.maxIter}\n    ${out}_new = ${rhs};\n    if ${change(`${out}_new`, out)} < ${p.tol}, ${out} = ${out}_new; converged = true; break; end\n    ${out} = ${out}_new;\nend`);
      lines.push(`if ~converged, warning('${out} did not converge in %d iterations', ${p.maxIter}); end`);
    } else if (arch === "summation") {
      lines.push(`${out} = 0;\nfor ${p.index} = ${p.lo}:${p.hi}\n    ${out} = ${out} + ${rhs};\nend`);
    } else if (arch === "integral") {
      lines.push(`% Trapezoidal rule over ${p.x} from ${p.lo} to ${p.hi}`);
      lines.push(`n_quad = ${p.n};\ndx = (${p.hi} - ${p.lo}) / n_quad;\n${out} = 0;`);
      lines.push(`for q = 0:n_quad\n    ${p.x} = ${p.lo} + q * dx;\n    w_q = 1 - 0.5 * (q == 0 || q == n_quad);\n    ${out} = ${out} + w_q * (${rhs}) * dx;\nend`);
    } else if (arch === "implicit") {
      lines.push(...implicitNote(p, "%"));
      if (p.linear) {
        lines.push(`% Linear in ${out}: solved directly`, `${out} = ${langTree(p.linear.A, "matlab")} \\ (${langTree(p.linear.b, "matlab")});`);
        return lines;
      }
      const [lo, hi] = [p.min && ex(p.min), p.max && ex(p.max)];
      lines.push(`${p.fn} = @(${out}) ${ex(p.residual)};`);
      lines.push(p.inCoupled ? `% starts from the value of the previous pass` : `${out} = ${p.guessFromStart ? startCode(varOf(eq.outputs[0]), "matlab") : ex(p.guess)}; % initial guess`);
      if (!p.vector && (lo || hi)) lines.push(`${out} = ${clampCode(p, ex)}; % start on the branch`);
      lines.push(`converged = false;`, `for it = 1:${p.maxIter}`);
      if (p.vector) {
        lines.push(`    r_nr = ${p.fn}(${out});`, `    jac_nr = zeros(numel(r_nr), numel(${out}));`, `    for j_nr = 1:numel(${out})`,
          `        e_nr = zeros(size(${out})); e_nr(j_nr) = 1e-6 * max(abs(${out}(j_nr)), 1e-6);`,
          `        jac_nr(:, j_nr) = (${p.fn}(${out} + e_nr) - ${p.fn}(${out} - e_nr)) / (2 * e_nr(j_nr));`, `    end`,
          `    ${out}_new = ${out} - jac_nr \\ r_nr;`,
          `    if max(abs(${out}_new - ${out})) < ${p.tol} * (1 + max(abs(${out}))), ${out} = ${out}_new; converged = true; break; end`);
      } else {
        lines.push(`    h_nr = 1e-6 * max(abs(${out}), 1e-6);`, `    dr_nr = (${p.fn}(${out} + h_nr) - ${p.fn}(${out} - h_nr)) / (2 * h_nr);`,
          `    if dr_nr == 0, warning('Zero derivative in the Newton iteration for ${out}'); break; end`,
          `    ${out}_new = ${out} - ${p.fn}(${out}) / dr_nr;`);
        if (lo) lines.push(`    if ${out}_new < ${lo}, ${out}_new = 0.5 * (${out} + ${lo}); end % stay on the branch`);
        if (hi) lines.push(`    if ${out}_new > ${hi}, ${out}_new = 0.5 * (${out} + ${hi}); end % stay on the branch`);
        lines.push(`    if abs(${out}_new - ${out}) < ${p.tol} * (1 + abs(${out})), ${out} = ${out}_new; converged = true; break; end`);
      }
      lines.push(`    ${out} = ${out}_new;`, `end`, `if ~converged, warning('${out} did not converge in %d iterations', ${p.maxIter}); end`);
    } else if (arch === "function") {
      lines.push(`${out} = @(${p.params.join(", ")}) ${ex(p.code)};`);
    } else if (arch === "ode") {
      lines.push(`% integrated in its ODE system`);
    } else {
      if (p.free.length || p.hasSums) lines.push(...assignLines("matlab", out, p, ctx));
      else lines.push(`${out} = ${rhs};`);
    }
    return lines;
  },
  switch(group, ctx) {
    const lines = [`% --- Switch: ${codeOf(group.symbol)} by case ---`];
    switchCases(group).forEach((c, k) => {
      const body = indentLines(ML.eq({ ...equationPlan(c.eq, ctx.arrays), inCoupled: ctx.inCoupled }, ctx), "    ");
      lines.push(c.cond ? `${k ? "elseif" : "if"} ${langCode(c.cond, "matlab")}` : `else`, ...body);
    });
    if (!group.otherwise) lines.push(`else`, `    warning('No case applies for ${codeOf(group.symbol)}: its start value is used');`,
      `    ${codeOf(group.symbol)} = ${startCode(varOf(group.symbol), "matlab")};`);
    return [...lines, `end`];
  },
  ode(system, ctx) {
    const { settings: s } = system;
    const m = ODE_METHODS[s.method];
    const t = codeOf(s.independent);
    const states = system.odes.map(eq => { const y = codeOf(eq.outputs[0]); return { y, rate: assignLines("matlab", `${y}_rate`, equationPlan(eq), ctx, { rateOf: y }) }; });
    const alg = unitsLines(system.algebraic, ML, ctx).filter(Boolean);
    const lines = [`% --- ODE system: ${states.map(x => x.y).join(", ")} over ${t}: ${m.short}, ${s.steps} steps ---`];
    lines.push(...odeCardComments(system, "%"));
    lines.push(`${t} = ${langCode(odeBound(s.from), "matlab")};`, `h_rk = (${langCode(odeBound(s.to), "matlab")} - ${t}) / ${s.steps};`);
    const hist = odeHistory(system, ctx);
    const fid = hist && `fid_ode${hist.k}`;
    const writeRow = pad => [`${pad}row_ode = ${mlRow(hist)};`, `${pad}fprintf(${fid}, [repmat('%.17g,', 1, numel(row_ode) - 1), '%.17g\\n'], row_ode);`];
    if (hist) lines.push(`% Solution every ${hist.every} steps -> ${hist.file}`, `${fid} = fopen('${hist.file}', 'w');`, `head_ode = '${hist.cols[0]}';`,
      ...hist.cols.slice(1).map(c => (hist.rank(c) ? `head_ode = [head_ode, sprintf(',${c}[%d]', 1:numel(${c}))];` : `head_ode = [head_ode, ',${c}'];`)),
      `fprintf(${fid}, '%s\\n', head_ode);`, ...writeRow(""));
    if (s.method === "euler") {
      lines.push(`for step = 1:${s.steps}`, ...indentLines(alg, "    "), ...states.flatMap(x => indentLines(x.rate, "    ")),
        `    ${t} = ${t} + h_rk;`, ...states.map(x => `    ${x.y} = ${x.y} + h_rk * ${x.y}_rate;`), `end`);
    } else {
      lines.push(`w_rk = [1, 2, 2, 1]; c_rk = [0.5, 0.5, 1];`, `for step = 1:${s.steps}`, `    ${t}_rk0 = ${t};`,
        ...states.map(x => `    ${x.y}_rk0 = ${x.y}; ${x.y}_acc = 0;`), `    for stage = 1:4`,
        ...indentLines(alg, "        "), ...states.flatMap(x => indentLines(x.rate, "        ")),
        ...states.map(x => `        ${x.y}_acc = ${x.y}_acc + w_rk(stage) * ${x.y}_rate;`),
        `        if stage < 4`, `            ${t} = ${t}_rk0 + c_rk(stage) * h_rk;`,
        ...states.map(x => `            ${x.y} = ${x.y}_rk0 + c_rk(stage) * h_rk * ${x.y}_rate;`), `        end`, `    end`,
        `    ${t} = ${t}_rk0 + h_rk;`, ...states.map(x => `    ${x.y} = ${x.y}_rk0 + h_rk / 6 * ${x.y}_acc;`), `end`);
    }
    if (hist) {
      lines.splice(lines.length - 1, 0, `    if mod(step, ${hist.every}) == 0`, ...writeRow("        "), `    end`);
      lines.push(`fclose(${fid});`);
    }
    if (alg.length) lines.push(`% Algebraic equations at the final ${t}`, ...alg);
    return lines;
  }
};

function generateMatlabCode(plan, varList) {
  const arrays = indexedArrays(plan, varList);
  const ctx = { arrays, used: new Set(), inCoupled: false, counter: { ode: 0 } };
  const lines = [`% Solver generated by SolverMapp\nclear; clc;\n`];
  lines.push(`%% Stage 0: Inputs and start values of state variables`);
  const comment = v => `% [${roleLabel(v)}] (${v.units || "-"}) ${v.desc}`.trimEnd();
  startValues(varList).forEach(v => {
    let value = startCode(v, "matlab");
    if (arrays.has(v.symbol)) {
      const { lo, hi } = arrays.get(v.symbol);
      const list = listValues(v.initVal);
      value = list ? `[${list.join(", ")}]` : `${v.initVal || "1.0"} * ones(1, ${lo === "1" ? hi : `${hi} - ${lo} + 1`})`;
    }
    lines.push(`${v.codeVar.padEnd(10)} = ${value}; ${comment(v)}`);
  });
  varList.filter(v => v.callable && !projectData.equations.some(e => e.archetype === "function" && e.outputs[0] === v.symbol)).forEach(v => {
    lines.push(`${v.codeVar.padEnd(10)} = @(${v.args.map(codeOf).join(", ")}) ${v.initVal || "1.0"}; % TODO: ${v.codeVar} as a function of ${v.args.map(codeOf).join(", ")}`);
  });

  plan.steps.forEach((step, sIdx) => {
    lines.push(`\n%% Stage ${sIdx + 1}${step.coupled ? " (coupled block)" : ""}`);
    if (!step.coupled) {
      lines.push(...unitsLines(step.units, ML, ctx).filter(Boolean));
      return;
    }
    const names = step.computes.map(codeOf).join(", ");
    const big = step.computes.some(s => isArrayName(codeOf(s)));
    const flat = big ? `[${step.computes.map(s => `${codeOf(s)}(:)`).join("; ")}]` : `[${names}]`;
    lines.push(`% ${coupledNames(step)} depend on each other: fixed-point iteration`);
    coupledGuesses(step, varList).forEach(v => lines.push(`${v.codeVar.padEnd(10)} = ${startCode(v, "matlab")}; % starting guess`));
    lines.push(`converged_c = false;`);
    lines.push(`for it_c = 1:200`);
    lines.push(`    prev_c = ${flat};`);
    lines.push(...indentLines(unitsLines(step.units, ML, { ...ctx, inCoupled: true }).filter(Boolean), "    "));
    lines.push(`    if max(abs(${flat} - prev_c)) < 1e-8, converged_c = true; break; end`);
    lines.push(`end`);
    lines.push(`if ~converged_c, warning('Coupled block (${names}) did not converge in 200 iterations'); end`);
  });

  lines.push(`\n%% Results`);
  varList.filter(v => !v.callable).forEach(v => lines.push(`fprintf('%-12s = %s\\n', '${v.codeVar}', mat2str(${v.codeVar}));`));
  return lines.join("\n");
}

// ---------- Fortran ----------
// Real literals get the double-precision kind (0.02 -> 0.02_dp, 2 -> 2.0_dp); integer powers stay.
function fortranNumbers(expr) {
  return String(expr).replace(/(\*\*\s*)?(?<![\w.])(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?(?![\w.])/g,
    (m, pow, mant, exp) => (pow ? m : (mant.includes(".") || exp ? mant + (exp || "") : mant + ".0") + "_dp"));
}

const fInt = v => (isNumber(v) ? v : `int(${v})`);

// allocate(x(n)) for a vector or matrix that is filled element by element or accumulated.
function fortranAllocate(name) {
  const shape = shapeOfCode(name);
  return shape ? [`if (.not. allocated(${name})) allocate(${name}(${shape.dims.map(fInt).join(", ")}))`] : [];
}

const FT = {
  c: "!",
  eq(p, ctx) {
    const { eq, arch, out } = p;
    const ex = code => langCode(code, "fortran", undefined, ctx.used);
    const rhs = p.free.length || p.hasSums ? "" : fortranNumbers(rhsFor(p, "fortran", ctx.used));
    const lines = [`! [${arch.toUpperCase()}] ${eq.name || "Untitled"}: ${eq.latex}`];
    const big = isArrayName(out);
    const change = (a, b) => (big ? `maxval(abs(${a} - ${b}))` : `abs(${a} - ${b})`);
    if (arch === "marching") {
      lines.push(`do step = 1, ${fInt(p.steps)}\n  ${out} = ${rhs}\nend do`);
    } else if (arch === "convergence") {
      const max = fInt(p.maxIter);
      lines.push(`do it = 1, ${max}\n  ${out}_new = ${rhs}\n  if (${change(`${out}_new`, out)} < ${fortranNumbers(p.tol)}) then\n    ${out} = ${out}_new\n    exit\n  end if\n  ${out} = ${out}_new\nend do`);
      lines.push(`if (it > ${max}) print *, "Warning: ${out} did not converge in", ${max}, "iterations"`);
    } else if (arch === "summation") {
      lines.push(...fortranAllocate(out), `${out} = 0.0_dp\ndo ${p.index} = ${fInt(p.lo)}, ${fInt(p.hi)}\n  ${out} = ${out} + ${rhs}\nend do`);
    } else if (arch === "integral") {
      const n = fInt(p.n);
      const [lo, hi] = [fortranNumbers(p.lo), fortranNumbers(p.hi)];
      lines.push(`! Trapezoidal rule over ${p.x} from ${p.lo} to ${p.hi}`);
      lines.push(...fortranAllocate(out), `dx = (${hi} - ${lo}) / real(${n}, dp)\n${out} = 0.0_dp`);
      lines.push(`do q = 0, ${n}\n  ${p.x} = ${lo} + q * dx\n  w_q = merge(0.5_dp, 1.0_dp, q == 0 .or. q == ${n})\n  ${out} = ${out} + w_q * (${rhs}) * dx\nend do`);
    } else if (arch === "implicit") {
      // The residual is an internal function (after "contains"), see generateFortranCode.
      const max = fInt(p.maxIter);
      lines.push(...implicitNote(p, "!"));
      if (p.linear) {
        ctx.used.add("solve");
        lines.push(`! Linear in ${out}: solved directly`, `${out} = solve(${langTree(p.linear.A, "fortran", ctx.used)}, ${langTree(p.linear.b, "fortran", ctx.used)})`);
        return lines;
      }
      const [lo, hi] = [p.min && ex(p.min), p.max && ex(p.max)];
      if (!p.inCoupled) {
        const v = varOf(eq.outputs[0]);
        const init = p.guessFromStart ? startCode(v, "fortran", ctx.used) : ex(p.guess);
        if (init === null) lines.push(...fortranAllocate(out), `${out} = ${fortranNumbers(arrayStart(v).value)}  ! initial guess`);
        else lines.push(`${out} = ${init}  ! initial guess`);
      } else {
        lines.push(`! starts from the value of the previous pass`);
      }
      if (p.vector) {
        ctx.used.add("solve");
        lines.push(`do it = 1, ${max}`, `  r_nr = ${p.fn}(${out})`, `  if (allocated(jac_nr)) deallocate(jac_nr)`, `  allocate(jac_nr(size(r_nr), size(${out})))`,
          `  do j_nr = 1, size(${out})`, `    e_nr = 0.0_dp * ${out}`, `    e_nr(j_nr) = 1.0e-6_dp * max(abs(${out}(j_nr)), 1.0e-6_dp)`,
          `    jac_nr(:, j_nr) = (${p.fn}(${out} + e_nr) - ${p.fn}(${out} - e_nr)) / (2.0_dp * e_nr(j_nr))`, `  end do`,
          `  ${out}_new = ${out} - solve(jac_nr, r_nr)`,
          `  if (maxval(abs(${out}_new - ${out})) < ${fortranNumbers(p.tol)} * (1.0_dp + maxval(abs(${out})))) then\n    ${out} = ${out}_new\n    exit\n  end if\n  ${out} = ${out}_new\nend do`);
      } else {
        if (lo || hi) lines.push(`${out} = ${clampCode(p, ex)}  ! start on the branch`);
        lines.push(`do it = 1, ${max}`);
        lines.push(`  h_nr = 1.0e-6_dp * max(abs(${out}), 1.0e-6_dp)`);
        lines.push(`  dr_nr = (${p.fn}(${out} + h_nr) - ${p.fn}(${out} - h_nr)) / (2.0_dp * h_nr)`);
        lines.push(`  if (dr_nr == 0.0_dp) then\n    print *, "Warning: zero derivative in the Newton iteration for ${out}"\n    exit\n  end if`);
        lines.push(`  ${out}_new = ${out} - ${p.fn}(${out}) / dr_nr`);
        if (lo) lines.push(`  if (${out}_new < ${lo}) ${out}_new = 0.5_dp * (${out} + ${lo})  ! stay on the branch`);
        if (hi) lines.push(`  if (${out}_new > ${hi}) ${out}_new = 0.5_dp * (${out} + ${hi})  ! stay on the branch`);
        lines.push(`  if (abs(${out}_new - ${out}) < ${fortranNumbers(p.tol)} * (1.0_dp + abs(${out}))) then\n    ${out} = ${out}_new\n    exit\n  end if\n  ${out} = ${out}_new\nend do`);
      }
      lines.push(`if (it > ${max}) print *, "Warning: ${out} did not converge in", ${max}, "iterations"`);
    } else if (arch === "function") {
      lines.push(`! ${out}(${p.params.join(", ")}) is an internal function (after "contains")`);
    } else if (arch === "ode") {
      lines.push(`! integrated in its ODE system`);
    } else {
      if (p.free.length || p.hasSums) lines.push(...assignLines("fortran", out, p, ctx));
      else lines.push(`${out} = ${rhs}`);
    }
    return lines;
  },
  switch(group, ctx) {
    const lines = [`! --- Switch: ${codeOf(group.symbol)} by case ---`];
    switchCases(group).forEach((c, k) => {
      const body = indentLines(FT.eq({ ...equationPlan(c.eq, ctx.arrays), inCoupled: ctx.inCoupled }, ctx), "  ");
      lines.push(c.cond ? `${k ? "else if" : "if"} (${langCode(c.cond, "fortran")}) then` : `else`, ...body);
    });
    if (!group.otherwise) {
      const init = startCode(varOf(group.symbol), "fortran", ctx.used);
      lines.push(`else`, `  print *, "Warning: no case applies for ${codeOf(group.symbol)}: its start value is used"`,
        init === null ? `  ${codeOf(group.symbol)} = ${fortranNumbers(arrayStart(varOf(group.symbol)).value)}` : `  ${codeOf(group.symbol)} = ${init}`);
    }
    return [...lines, `end if`];
  },
  ode(system, ctx) {
    const { settings: s } = system;
    const m = ODE_METHODS[s.method];
    const t = codeOf(s.independent);
    const n = fInt(s.steps);
    const states = system.odes.map(eq => { const y = codeOf(eq.outputs[0]); return { y, rate: assignLines("fortran", `${y}_rate`, equationPlan(eq), ctx, { rateOf: y }) }; });
    const alg = unitsLines(system.algebraic, FT, ctx).filter(Boolean);
    const lines = [`! --- ODE system: ${states.map(x => x.y).join(", ")} over ${t}: ${m.short}, ${s.steps} steps ---`];
    lines.push(...odeCardComments(system, "!"));
    lines.push(`${t} = ${langCode(odeBound(s.from), "fortran")}`, `h_rk = (${langCode(odeBound(s.to), "fortran")} - ${t}) / real(${n}, dp)`);
    const hist = odeHistory(system, ctx);
    const unit = hist && `u_ode${hist.k}`;
    const writeRow = pad => `${pad}write(${unit}, '(*(g0.17, :, ","))') ${hist.cols.map(c => (hist.rank(c) === 2 ? `transpose(${c})` : c)).join(", ")}`;
    if (hist) {
      ctx.counter.units = [...(ctx.counter.units || []), unit];
      lines.push(`! Solution every ${hist.every} steps -> ${hist.file}`, `open(newunit=${unit}, file="${hist.file}", status="replace", action="write")`,
        `write(${unit}, '(a)', advance="no") "${hist.cols[0]}"`,
        ...hist.cols.slice(1).flatMap(c => (hist.rank(c)
          ? [`do k_csv = 1, size(${c})`, `  write(${unit}, '(a, i0, a)', advance="no") ",${c}[", k_csv, "]"`, `end do`]
          : [`write(${unit}, '(a)', advance="no") ",${c}"`])),
        `write(${unit}, '(a)') ""`, writeRow(""));
      if (hist.cols.some(c => hist.rank(c))) ctx.counter.units = [...ctx.counter.units, "k_csv"];
    }
    if (s.method === "euler") {
      lines.push(`do step = 1, ${n}`, ...indentLines(alg, "  "), ...states.flatMap(x => indentLines(x.rate, "  ")),
        `  ${t} = ${t} + h_rk`, ...states.map(x => `  ${x.y} = ${x.y} + h_rk * ${x.y}_rate`), `end do`);
    } else {
      lines.push(`do step = 1, ${n}`, `  ${t}_rk0 = ${t}`, ...states.map(x => `  ${x.y}_rk0 = ${x.y}\n  ${x.y}_acc = 0.0_dp * ${x.y}`), `  do stage = 1, 4`,
        ...indentLines(alg, "    "), ...states.flatMap(x => indentLines(x.rate, "    ")),
        ...states.map(x => `    ${x.y}_acc = ${x.y}_acc + w_rk(stage) * ${x.y}_rate`),
        `    if (stage < 4) then`, `      ${t} = ${t}_rk0 + c_rk(stage) * h_rk`,
        ...states.map(x => `      ${x.y} = ${x.y}_rk0 + c_rk(stage) * h_rk * ${x.y}_rate`), `    end if`, `  end do`,
        `  ${t} = ${t}_rk0 + h_rk`, ...states.map(x => `  ${x.y} = ${x.y}_rk0 + h_rk / 6.0_dp * ${x.y}_acc`), `end do`);
    }
    if (hist) {
      lines.splice(lines.length - 1, 0, `  if (mod(step, ${hist.every}) == 0) then`, writeRow("    "), `  end if`);
      lines.push(`close(${unit})`);
    }
    if (alg.length) lines.push(`! Algebraic equations at the final ${t}`, ...alg);
    return lines;
  }
};

// Free-form Fortran allows 132 characters a line: long comments are cut, long statements continued.
function fortranWrap(line) {
  if (line.length <= 130) return [line];
  if (line.trim().startsWith("!")) return [line.slice(0, 127) + "..."];
  const indent = line.match(/^\s*/)[0];
  const out = [];
  let rest = line;
  while (rest.length > 120) {
    let cut = rest.lastIndexOf(" ", 115);
    if (cut <= indent.length) cut = 115;
    out.push(rest.slice(0, cut) + " &");
    rest = indent + "    & " + rest.slice(cut).trimStart();
  }
  out.push(rest);
  return out;
}

// Fortran ignores case: code names that differ only in case (T and t) are the same variable.
function fortranCaseClashes(varList) {
  const seen = {};
  varList.forEach(v => (seen[v.codeVar.toLowerCase()] = seen[v.codeVar.toLowerCase()] || new Set()).add(v.codeVar));
  return Object.values(seen).filter(s => s.size > 1).map(s => [...s]);
}

// Helper routines the Fortran program may need (internal procedures after "contains").
const FORTRAN_HELPERS = {
  solve: [
    `  ! Solves A x = b by Gaussian elimination with partial pivoting`,
    `  function solve(A, b) result(x)`,
    `    real(dp), intent(in) :: A(:, :), b(:)`,
    `    real(dp), allocatable :: x(:), M(:, :), row(:)`,
    `    integer :: n, i, k, p`,
    `    n = size(b)`,
    `    M = A`,
    `    x = b`,
    `    do k = 1, n`,
    `      p = k - 1 + maxloc(abs(M(k:n, k)), 1)`,
    `      if (p /= k) then`,
    `        row = M(k, :); M(k, :) = M(p, :); M(p, :) = row`,
    `        x([k, p]) = x([p, k])`,
    `      end if`,
    `      do i = k + 1, n`,
    `        x(i) = x(i) - M(i, k) / M(k, k) * x(k)`,
    `        M(i, k:n) = M(i, k:n) - M(i, k) / M(k, k) * M(k, k:n)`,
    `      end do`,
    `    end do`,
    `    do i = n, 1, -1`,
    `      x(i) = (x(i) - dot_product(M(i, i + 1:n), x(i + 1:n))) / M(i, i)`,
    `    end do`,
    `  end function solve`
  ],
  inv: [
    `  ! Inverse of a square matrix, column by column`,
    `  function inv(A) result(B)`,
    `    real(dp), intent(in) :: A(:, :)`,
    `    real(dp), allocatable :: B(:, :), e(:)`,
    `    integer :: j`,
    `    allocate(B(size(A, 1), size(A, 1)))`,
    `    do j = 1, size(A, 1)`,
    `      e = 0.0_dp * A(:, 1)`,
    `      e(j) = 1.0_dp`,
    `      B(:, j) = solve(A, e)`,
    `    end do`,
    `  end function inv`
  ],
  cross3: [
    `  function cross3(a, b) result(c)`,
    `    real(dp), intent(in) :: a(3), b(3)`,
    `    real(dp) :: c(3)`,
    `    c = [a(2) * b(3) - a(3) * b(2), a(3) * b(1) - a(1) * b(3), a(1) * b(2) - a(2) * b(1)]`,
    `  end function cross3`
  ],
  eye: [
    `  function eye(n) result(E)`,
    `    integer, intent(in) :: n`,
    `    real(dp), allocatable :: E(:, :)`,
    `    integer :: i`,
    `    allocate(E(n, n))`,
    `    E = 0.0_dp`,
    `    do i = 1, n`,
    `      E(i, i) = 1.0_dp`,
    `    end do`,
    `  end function eye`
  ],
  matpow: [
    `  function matpow(A, k) result(B)`,
    `    real(dp), intent(in) :: A(:, :), k`,
    `    real(dp), allocatable :: B(:, :)`,
    `    integer :: i`,
    `    B = A`,
    `    do i = 2, nint(k)`,
    `      B = matmul(B, A)`,
    `    end do`,
    `  end function matpow`
  ]
};

function generateFortranCode(plan, varList) {
  const arrays = indexedArrays(plan, varList);
  const used = new Set();
  const ctx = { arrays, used, inCoupled: false, counter: { ode: 0 } };
  const plans = plan.steps.flatMap(s => s.eqs).map(eq => equationPlan(eq, arrays));
  const has = arch => plans.some(p => p.arch === arch);
  const systems = plan.steps.flatMap(s => s.units.filter(u => u.kind === "ode").map(u => u.system));
  const rank = name => shapeOfCode(name)?.rank || 0;
  const decl = (name, r) => (r ? `real(dp), allocatable :: ${name}(${r === 2 ? ":, :" : ":"})` : `real(dp) :: ${name}`);

  // Body first: it records the helper routines it uses.
  const body = [];
  body.push(`\n  ! --- Stage 0: inputs and start values of state variables ---`);
  startValues(varList).forEach(v => {
    if (arrays.has(v.symbol)) {
      const { lo, hi } = arrays.get(v.symbol);
      const list = listValues(v.initVal);
      body.push(`  allocate(${v.codeVar}(${fInt(lo)}:${fInt(hi)}))`);
      body.push(`  ${v.codeVar} = ${list ? `[${list.map(fortranNumbers).join(", ")}]` : fortranNumbers(v.initVal || "1.0")}`);
      return;
    }
    const init = startCode(v, "fortran", used);
    if (init === null) body.push(...indentLines(fortranAllocate(v.codeVar), "  "), `  ${v.codeVar} = ${fortranNumbers(arrayStart(v).value)}`);
    else body.push(`  ${v.codeVar} = ${init}`);
  });

  plan.steps.forEach((step, sIdx) => {
    body.push(`\n  ! --- Stage ${sIdx + 1}${step.coupled ? " (coupled block)" : ""} ---`);
    if (!step.coupled) {
      body.push(...indentLines(unitsLines(step.units, FT, ctx).filter(Boolean), "  "));
      return;
    }
    const names = step.computes.map(codeOf).join(", ");
    body.push(`  ! ${coupledNames(step)} depend on each other: fixed-point iteration`);
    coupledGuesses(step, varList).forEach(v => {
      const init = startCode(v, "fortran", used);
      if (init === null) body.push(...indentLines(fortranAllocate(v.codeVar), "  "), `  ${v.codeVar} = ${fortranNumbers(arrayStart(v).value)}  ! starting guess`);
      else body.push(`  ${v.codeVar} = ${init}  ! starting guess`);
    });
    body.push(`  do it_c = 1, 200`);
    body.push(`    prev_c = [${names}]`);
    body.push(...indentLines(unitsLines(step.units, FT, { ...ctx, inCoupled: true }).filter(Boolean), "    "));
    body.push(`    if (maxval(abs([${names}] - prev_c)) < 1.0e-8_dp) exit`);
    body.push(`  end do`);
    body.push(`  if (it_c > 200) print *, "Warning: coupled block (${names}) did not converge in 200 iterations"`);
  });

  body.push(`\n  ! --- Results ---`);
  varList.filter(v => !v.callable).forEach(v => body.push(`  print '(a12, " = ", *(g0, 1x))', "${v.codeVar}", ${v.codeVar}`));

  // Internal procedures: residuals of implicit equations, function definitions, stubs, helpers.
  // They see the program's variables (host association).
  const contains = [];
  [...new Map(plans.filter(p => p.arch === "implicit" && !p.linear).map(p => [p.fn, p])).values()].forEach(p => {
    contains.push(`\n  ! Residual of ${p.eq.name || "Untitled"}: left side - right side`);
    const r = langCode(p.residual, "fortran", undefined, used);
    if (p.vector) contains.push(`  function ${p.fn}(${p.out}) result(r)\n    real(dp), intent(in) :: ${p.out}(:)\n    real(dp), allocatable :: r(:)\n    r = ${r}\n  end function ${p.fn}`);
    else contains.push(`  real(dp) function ${p.fn}(${p.out})\n    real(dp), intent(in) :: ${p.out}\n    ${p.fn} = ${r}\n  end function ${p.fn}`);
  });
  plans.filter(p => p.arch === "function").forEach(p => {
    contains.push(`\n  ! ${p.eq.name || "Untitled"}: ${p.eq.latex}`);
    contains.push(`  real(dp) function ${p.out}(${p.params.join(", ")})\n    real(dp), intent(in) :: ${p.params.join(", ")}\n    ${p.out} = ${langCode(p.code, "fortran", undefined, used)}\n  end function ${p.out}`);
  });
  varList.filter(v => v.callable && !plans.some(p => p.arch === "function" && p.out === v.codeVar)).forEach(v => {
    const args = v.args.map(codeOf);
    contains.push(`\n  ! TODO: ${v.codeVar} as a function of ${args.join(", ")} (returns its Start value for now)`);
    contains.push(`  real(dp) function ${v.codeVar}(${args.join(", ")})\n    real(dp), intent(in) :: ${args.join(", ")}\n    ${v.codeVar} = ${fortranNumbers(v.initVal || "1.0")} + 0.0_dp * (${args.join(" + ")})\n  end function ${v.codeVar}`);
  });
  if (used.has("inv")) used.add("solve");
  Object.keys(FORTRAN_HELPERS).filter(k => used.has(k)).forEach(k => contains.push("", ...FORTRAN_HELPERS[k]));

  // Declarations: only what the program uses.
  const integers = [];
  if (has("marching") || systems.length) integers.push("step");
  if (systems.some(s => s.settings.method === "rk4")) integers.push("stage");
  if (has("convergence") || plans.some(p => p.arch === "implicit" && !p.linear)) integers.push("it");
  if (plans.some(p => p.arch === "implicit" && p.vector && !p.linear)) integers.push("j_nr");
  if (has("integral")) integers.push("q");
  if (plan.coupledSteps.length) integers.push("it_c");
  integers.push(...new Set(ctx.counter.units || []));
  [...(ctx.counter.loopVars || [])].forEach(l => { if (!integers.includes(l)) integers.push(l); });
  plans.filter(p => p.arch === "summation").forEach(p => { if (!integers.includes(p.index)) integers.push(p.index); });
  const temps = new Map(); // name -> rank
  plans.filter(p => p.arch === "convergence" || (p.arch === "implicit" && !p.linear)).forEach(p => temps.set(p.out + "_new", rank(p.out)));
  plans.filter(p => p.arch === "integral").forEach(p => temps.set(p.x, 0));
  if (has("integral")) { temps.set("dx", 0); temps.set("w_q", 0); }
  if (plans.some(p => p.arch === "implicit" && !p.vector && !p.linear)) { temps.set("h_nr", 0); temps.set("dr_nr", 0); }
  if (plans.some(p => p.arch === "implicit" && p.vector && !p.linear)) { temps.set("r_nr", 1); temps.set("e_nr", 1); temps.set("jac_nr", 2); }
  systems.forEach(sys => {
    temps.set("h_rk", 0);
    const t = codeOf(sys.settings.independent);
    if (sys.settings.method === "rk4") temps.set(t + "_rk0", 0);
    sys.states.forEach(sym => {
      const y = codeOf(sym);
      temps.set(y + "_rate", rank(y));
      if (sys.settings.method === "rk4") { temps.set(y + "_rk0", rank(y)); temps.set(y + "_acc", rank(y)); }
    });
  });
  (ctx.counter.temps || new Map()).forEach((rank, name) => temps.set(name, rank));
  varList.forEach(v => temps.delete(v.codeVar));

  const lines = [`program solvermapp\n  implicit none\n  integer, parameter :: dp = selected_real_kind(15, 307)`];
  if (integers.length) lines.push(`  integer :: ${integers.join(", ")}`);
  varList.filter(v => !v.callable).forEach(v => {
    const d = arrays.has(v.symbol) ? `real(dp), allocatable :: ${v.codeVar}(:)` : decl(v.codeVar, rank(v.codeVar));
    lines.push(`  ${d.padEnd(34)} ! [${roleLabel(v)}] (${v.units || "-"}) ${v.desc}`.trimEnd());
  });
  const scalarTemps = [...temps].filter(([, r]) => !r).map(([n]) => n);
  if (scalarTemps.length) lines.push(`  real(dp) :: ${scalarTemps.join(", ")}`);
  [...temps].filter(([, r]) => r).forEach(([n, r]) => lines.push(`  ${decl(n, r)}`));
  if (systems.some(s => s.settings.method === "rk4")) lines.push(`  real(dp), parameter :: w_rk(4) = [1.0_dp, 2.0_dp, 2.0_dp, 1.0_dp], c_rk(3) = [0.5_dp, 0.5_dp, 1.0_dp]`);
  if (plan.coupledSteps.length) lines.push(`  real(dp), allocatable :: prev_c(:)`);
  lines.push(...body);
  if (contains.length) lines.push(`\ncontains`, ...contains);
  lines.push(`end program solvermapp`);
  return lines.flatMap(l => l.split("\n")).flatMap(fortranWrap).join("\n");
}

function varOf(sym) {
  return buildVariableRegistry().find(v => v.symbol === sym) || { symbol: sym, codeVar: codeOf(sym), initVal: startValueCode(sym), shape: parseSize(projectData.variableMeta[sym]?.size) };
}
