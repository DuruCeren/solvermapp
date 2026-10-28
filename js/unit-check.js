// SolverMapp — Dimensional consistency of an equation (`UnitCheck`, `unitCheckResult`).
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// UNIT CHECK (ported from example_project/js/unit-check.js)
// Checks that every side of the equation and every added term has the same SI dimensions,
// that arguments of sin/exp/ln/... and exponents are dimensionless, and flags terms with the
// same dimension but a different scale (mm vs m), usually a conversion bug in code.
//
// Adapted to this app: units come from the shared variable table, step suffixes
// (T_{new}, y_{n+1}) resolve to the state variable, and an integration variable that is not
// tracked (dx) takes the unit of its bounds (x_1, x_2).
// ================================================================
const UnitCheck = (() => {
  const L = Latex;
  const U = Units;

  class Unsupported extends Error {}

  const FUNCS = new Set([
    "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh", "coth", "exp", "log", "ln", "lg", "sgn"
  ]);
  const NOISE_CMDS = new Set([
    ",", ";", ":", "!", " ", "quad", "qquad", "displaystyle", "textstyle", "limits", "nolimits",
    "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "\\"
  ]);
  const NOISE_WITH_ARG = new Set(["text", "textrm", "textit", "mbox", "label", "tag"]);
  const NOISE_CHARS = new Set([",", ";", "&", "~"]);
  const INTEGRALS = new Set(["int", "iint", "iiint", "oint"]);
  const CONSTANT_CMDS = new Set(["pi", "infty"]);
  const PER_LENGTH = U.pow(U.parse("m"), -1);

  // variables: [{ symbol, unit }] — every variable of the project.
  function check(latex, variables) {
    const src = String(latex || "");
    if (!src.trim()) return { state: "empty", issues: [], missing: [], untracked: [], invalid: [], sides: [] };

    const units = new Map(); // canonical symbol -> { symbol, unit } | { symbol, error }
    const nonscalar = new Set(variables.filter(v => v.nonscalar).map(v => L.canonical(v.symbol)));
    for (const v of variables) {
      const key = L.canonical(v.symbol);
      if (!key || units.has(key)) continue;
      try {
        units.set(key, { symbol: v.symbol, unit: U.parse(v.unit) });
      } catch (err) {
        units.set(key, { symbol: v.symbol, error: err.message });
      }
    }

    // y_{n+1}, T_{old} -> y, T;  \Delta x -> x
    function resolve(key) {
      if (units.has(key)) return units.get(key);
      const base = L.canonical(normalizeRecurrenceSymbol(key));
      if (units.has(base)) return units.get(base);
      const step = /^\\[Dd]elta (.+)$/.exec(key);
      if (step && units.has(step[1])) return units.get(step[1]);
      return null;
    }

    // Integration variable x that is not tracked: use the unit shared by x_1, x_2, ...
    function resolveDifferential(key) {
      const entry = resolve(key);
      if (entry) return entry;
      const bounds = [...units.entries()].filter(([k, e]) => k.startsWith(key + "_") && e.unit);
      if (bounds.length && bounds.every(([, e]) => U.sameDims(e.unit, bounds[0][1].unit))) return bounds[0][1];
      return null;
    }

    const ctx = L.analyze(src);
    const T = ctx.tokens;
    const issues = [];
    const missing = new Set();
    const untracked = new Set();
    const invalid = new Set();
    let integralDepth = 0;
    let differential = false;

    const text = (a, b) => L.sliceSrc(T, src, a, b).trim();
    const isChar = (i, ch) => L.isChar(T[i], ch);
    const isCmd = (i, name) => !!T[i] && T[i].type === "cmd" && T[i].value === name;
    const mul = (a, b) => (a && b ? U.mul(a, b) : null);
    const div = (a, b) => (a && b ? U.div(a, b) : null);
    const pow = (a, p) => (a ? U.pow(a, p) : null);
    const term = (a, b, v) => ({ latex: text(a, b), unit: v ? U.describe(v) : "?" });

    function lookup(name) {
      const key = L.canonical(name);
      const entry = differential ? resolveDifferential(key) : resolve(key);
      if (!entry) { untracked.add(key); return null; }
      if (entry.error) { invalid.add(entry.symbol); return null; }
      if (!entry.unit) { missing.add(entry.symbol); return null; }
      return entry.unit;
    }

    function lookupDifferential(name) {
      differential = true;
      try { return lookup(name); } finally { differential = false; }
    }

    function requireDimensionless(v, a, b, what) {
      if (v && !U.isDimensionless(v)) {
        issues.push({ level: "error", message: `${what} must be dimensionless`, terms: [term(a, b, v)] });
      }
    }

    function isSign(i) {
      return isChar(i, "+") || isChar(i, "-") || isCmd(i, "pm") || isCmd(i, "mp");
    }

    function isNoise(i) {
      const t = T[i];
      if (t.type === "cmd") return NOISE_CMDS.has(t.value) || NOISE_WITH_ARG.has(t.value);
      return t.type === "char" && (NOISE_CHARS.has(t.value) || (t.value === "." && !(T[i + 1] && T[i + 1].type === "digit")));
    }

    function skipNoise(i, to) {
      if (T[i].type === "cmd" && NOISE_WITH_ARG.has(T[i].value)) {
        const arg = L.readArg(T, i + 1, to);
        return arg ? arg.next : to;
      }
      return i + 1;
    }

    function skipScripts(i, to) {
      while (i < to && (isChar(i, "_") || isChar(i, "^") || isCmd(i, "limits") || isCmd(i, "nolimits"))) {
        if (T[i].type === "cmd") { i++; continue; }
        const arg = L.readArg(T, i + 1, to);
        i = arg ? arg.next : to;
      }
      return i;
    }

    function matchClose(i, to) {
      const open = T[i].value;
      const close = open === "(" ? ")" : "]";
      let depth = 0;
      for (let j = i; j < to; j++) {
        if (isChar(j, open)) depth++;
        else if (isChar(j, close) && --depth === 0) return j;
      }
      throw new Unsupported(`Unbalanced "${open}"`);
    }

    function matchRight(i, to) {
      let depth = 0;
      for (let j = i; j < to; j++) {
        if (isCmd(j, "left")) depth++;
        else if (isCmd(j, "right") && --depth === 0) return j;
      }
      throw new Unsupported("\\left without matching \\right");
    }

    // Numeric value of a token range (2, -1, 1/2, \frac{1}{2}), or null.
    function numberValue(from, to) {
      let sign = 1;
      let k = from;
      if (isChar(k, "-")) { sign = -1; k++; } else if (isChar(k, "+")) k++;
      if (k >= to) return null;
      if (T[k].type === "cmd" && L.FRACS.has(T[k].value)) {
        const a = L.readArg(T, k + 1, to);
        const b = a && L.readArg(T, a.next, to);
        if (!b || b.next !== to) return null;
        const x = numberValue(a.innerFrom, a.innerTo);
        const y = numberValue(b.innerFrom, b.innerTo);
        return x != null && y ? sign * x / y : null;
      }
      const str = T.slice(k, to).map(t => t.value).join("").replace(/^\((.*)\)$/, "$1");
      const m = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(str);
      return m ? sign * (m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1])) : null;
    }

    // Compare terms that must share one unit (added terms, or sides of the equation).
    function combine(parts, kind) {
      const known = parts.filter(p => p.v);
      if (!known.length) return null;
      const ref = known[0];
      for (const p of known.slice(1)) {
        if (!U.sameDims(p.v, ref.v)) {
          issues.push({
            level: "error",
            message: kind === "side" ? "The two sides have different units" : "Added terms have different units",
            terms: [term(ref.from, ref.to, ref.v), term(p.from, p.to, p.v)]
          });
        } else if (!U.sameScale(p.v, ref.v)) {
          issues.push({
            level: "warn",
            message: `Same dimension, different scale (×${+(p.v.f / ref.v.f).toPrecision(4)}): check unit conversions`,
            terms: [term(ref.from, ref.to, ref.v), term(p.from, p.to, p.v)]
          });
        }
      }
      return ref.v;
    }

    function parseSum(from, to) {
      const parts = [];
      let i = from;
      while (i < to) {
        while (i < to && (isSign(i) || isNoise(i))) i = isSign(i) ? i + 1 : skipNoise(i, to);
        if (i >= to) break;
        const start = i;
        const [v, next] = parseProduct(i, to);
        if (next === start) throw new Unsupported(`Can't read "${text(start, start + 1)}"`);
        parts.push({ v, from: start, to: next });
        i = next;
      }
      return combine(parts, "term");
    }

    function parseProduct(from, to) {
      let v = U.ONE;
      let i = from;
      while (i < to) {
        if (isSign(i)) break;
        if (isNoise(i)) { i = skipNoise(i, to); continue; }
        if (isCmd(i, "cdot") || isCmd(i, "times") || isCmd(i, "odot") || isCmd(i, "circ") || isCmd(i, "otimes") || isChar(i, "*")) { i++; continue; }
        if (isChar(i, "/")) {
          const [d, next] = parseFactor(i + 1, to);
          v = div(v, d);
          i = next;
          continue;
        }
        const [f, next] = parseFactor(i, to);
        v = mul(v, f);
        i = next;
      }
      return [v, i];
    }

    function parseFactor(from, to) {
      let [v, i] = parsePrimary(from, to);
      while (i < to) {
        if (isChar(i, "^")) {
          const arg = L.readArg(T, i + 1, to);
          if (!arg) throw new Unsupported("Missing exponent");
          v = applyPower(v, arg, from, i);
          i = arg.next;
        } else if (isChar(i, "'") || isChar(i, "!")) {
          i++;
        } else {
          break;
        }
      }
      return [v, i];
    }

    function applyPower(base, arg, baseFrom, baseTo) {
      const sup = text(arg.innerFrom, arg.innerTo);
      // A^T, A^\top: a transpose keeps the unit
      const baseText = text(baseFrom, baseTo);
      if (/^\\(?:top|intercal)$|^\\math(?:sf|rm)\s*\{\s*T\s*\}$/.test(sup) ||
          (sup === "T" && (/^\\(?:mathbf|boldsymbol|bm|vec|underline)\b/.test(baseText) || nonscalar.has(L.canonical(baseText))))) return base;
      const p = numberValue(arg.innerFrom, arg.innerTo);
      if (p != null) return pow(base, p);
      // u^n with an untracked n: a time level, not a power
      if (/^[nkm]$/.test(sup) && !units.has(sup)) return base;
      const e = parseSum(arg.innerFrom, arg.innerTo);
      requireDimensionless(e, arg.innerFrom, arg.innerTo, "An exponent");
      if (!base || U.isDimensionless(base)) return base;
      issues.push({
        level: "warn",
        message: "A symbolic power of a quantity with units can't be checked",
        terms: [term(baseFrom, arg.next, null)]
      });
      return null;
    }

    function parsePrimary(i, to) {
      const t = T[i];

      if (t.type === "digit" || (t.value === "." && T[i + 1] && T[i + 1].type === "digit")) {
        let j = i;
        while (j < to && (T[j].type === "digit" || isChar(j, "."))) j++;
        return [U.ONE, j];
      }
      if (isChar(i, "(") || isChar(i, "[")) {
        const close = matchClose(i, to);
        return [parseSum(i + 1, close), close + 1];
      }
      if (isChar(i, "|")) {
        let j = i + 1;
        while (j < to && !isChar(j, "|")) j++;
        if (j >= to) throw new Unsupported('Unbalanced "|"');
        return [parseSum(i + 1, j), j + 1];
      }

      const name = t.type === "cmd" || t.type === "fn" ? t.value : null;
      // Norm \|x\| or \lVert x \rVert: the unit of x
      if (name === "|" || name === "lVert") {
        let j = i + 1;
        while (j < to && !(isCmd(j, "|") || isCmd(j, "rVert"))) j++;
        if (j >= to) throw new Unsupported("Unbalanced norm \\|");
        return [parseSum(i + 1, j), j + 1];
      }
      if (name === "left") return parseLeftRight(i, to);
      if (t.type === "cmd" && L.FRACS.has(name)) return parseFrac(i, to);
      if (name === "sqrt") return parseSqrt(i, to);
      if (name === "max" || name === "min") return parseMinMax(i, to);
      if (name === "operatorname" || (name && FUNCS.has(name))) return parseFunction(i, to);
      if (name === "lim" || name === "sum" || name === "prod") return parseProduct(skipScripts(i + 1, to), to);
      if (t.type === "cmd" && INTEGRALS.has(name)) {
        integralDepth++;
        try { return parseProduct(skipScripts(i + 1, to), to); } finally { integralDepth--; }
      }
      if (name === "nabla") return [PER_LENGTH, i + 1];
      if (name === "partial") return parsePartial(i, to);
      if (t.type === "cmd" && CONSTANT_CMDS.has(name)) return [U.ONE, i + 1];

      // Differential in an integral: d x contributes the unit of x
      if (L.isDifferential(ctx, i) || (integralDepth > 0 && t.value === "d" && t.type === "letter" && L.isSymbolStart(T[i + 1]))) {
        const sym = L.readSymbol(ctx, i + 1, to);
        if (sym && sym.name) return [lookupDifferential(sym.name), sym.next];
        return parsePrimary(i + 1, to);
      }

      const sym = L.readSymbol(ctx, i, to);
      if (sym) {
        if (!sym.name) {
          const upright = /\{\s*d\s*\}$/.test(text(i, sym.next));
          if (upright && sym.next < to) return parsePrimary(sym.next, to); // \mathrm{d}x
          return [U.ONE, sym.next]; // e^{...}, \mathrm{e}
        }
        let next = sym.next;
        // u(x, t): an argument list of plain symbols is function notation, not a product
        if (isChar(next, "(")) {
          const close = matchClose(next, to);
          if (isArgumentList(next + 1, close)) next = close + 1;
        }
        return [lookup(sym.name), next];
      }

      if (isChar(i, "{")) {
        const arg = L.readArg(T, i, to);
        return [parseSum(arg.innerFrom, arg.innerTo), arg.next];
      }
      throw new Unsupported(`Can't interpret "${text(i, i + 1)}"`);
    }

    function isArgumentList(from, to) {
      let i = from;
      while (i < to) {
        const sym = L.readSymbol(ctx, i, to);
        if (!sym || !sym.name) return false;
        i = sym.next;
        if (i < to && !isChar(i, ",")) return false;
        i++;
      }
      return true;
    }

    function parseLeftRight(i, to) {
      const right = matchRight(i, to);
      const inner = parseSum(i + 2, right);
      let next = right + 2;
      // Evaluation bar: \left. ... \right|_{x=0}
      if (isChar(right + 1, "|") || isChar(right + 1, ".")) next = skipScripts(next, to);
      return [inner, next];
    }

    // Index after a differential marker (d, \partial, \mathrm{d}) at i, or -1.
    function diffMarkerEnd(i, to) {
      if (i >= to) return -1;
      const t = T[i];
      if (t.type === "cmd" && t.value === "partial") return i + 1;
      if (t.type === "letter" && t.value === "d") {
        const n = T[i + 1];
        return i + 1 >= to || L.isSymbolStart(n) || isChar(i + 1, "^") || isChar(i + 1, "{") ? i + 1 : -1;
      }
      if (isCmd(i, "mathrm")) {
        const arg = L.readArg(T, i + 1, to);
        if (arg && text(arg.innerFrom, arg.innerTo) === "d") return arg.next;
      }
      return -1;
    }

    function parseFrac(i, to) {
      const a = L.readArg(T, i + 1, to);
      const b = a && L.readArg(T, a.next, to);
      if (!b) throw new Unsupported("Incomplete \\frac");
      const numMark = diffMarkerEnd(a.innerFrom, a.innerTo);
      const denMark = diffMarkerEnd(b.innerFrom, b.innerTo);
      if (numMark >= 0 && denMark >= 0) {
        // Derivative: d^n y / dx^n has the unit of y / x^n
        let k = numMark;
        if (isChar(k, "^")) k = L.readArg(T, k + 1, a.innerTo).next;
        const top = k < a.innerTo ? parseSum(k, a.innerTo) : U.ONE;
        return [div(top, parseDifferentials(b.innerFrom, b.innerTo)), b.next];
      }
      return [div(parseSum(a.innerFrom, a.innerTo), parseSum(b.innerFrom, b.innerTo)), b.next];
    }

    function parseDifferentials(from, to) {
      let v = U.ONE;
      let j = from;
      while (j < to) {
        if (isNoise(j)) { j = skipNoise(j, to); continue; }
        const m = diffMarkerEnd(j, to);
        const sym = m >= 0 && m < to ? L.readSymbol(ctx, m, to) : null;
        if (!sym || !sym.name) throw new Unsupported(`Can't read the derivative "${text(from, to)}"`);
        let p = 1;
        let n = sym.next;
        if (isChar(n, "^")) {
          const e = L.readArg(T, n + 1, to);
          p = numberValue(e.innerFrom, e.innerTo);
          if (p == null) throw new Unsupported(`Can't read the derivative order in "${text(from, to)}"`);
          n = e.next;
        }
        v = mul(v, pow(lookupDifferential(sym.name), p));
        j = n;
      }
      return v;
    }

    function parsePartial(i, to) {
      // \partial_t T  ->  1/t
      if (!isChar(i + 1, "_")) throw new Unsupported("Write partial derivatives as \\frac{\\partial y}{\\partial x} or \\partial_x y");
      const arg = L.readArg(T, i + 2, to);
      const sym = arg && L.readSymbol(ctx, arg.innerFrom, arg.innerTo);
      if (!sym || !sym.name) throw new Unsupported(`Can't read "${text(i, arg ? arg.next : to)}"`);
      return [div(U.ONE, lookupDifferential(sym.name)), arg.next];
    }

    function parseSqrt(i, to) {
      let j = i + 1;
      let degree = 2;
      if (isChar(j, "[")) {
        const close = matchClose(j, to);
        degree = numberValue(j + 1, close);
        if (!degree) throw new Unsupported(`Can't read the root degree "${text(j, close + 1)}"`);
        j = close + 1;
      }
      const arg = L.readArg(T, j, to);
      if (!arg) throw new Unsupported("Incomplete \\sqrt");
      return [pow(parseSum(arg.innerFrom, arg.innerTo), 1 / degree), arg.next];
    }

    function parseFunction(i, to) {
      let j = i + 1;
      let label = "\\" + T[i].value;
      if (T[i].value === "operatorname") {
        const arg = L.readArg(T, j, to);
        label = arg ? text(arg.innerFrom, arg.innerTo) : "function";
        j = arg ? arg.next : to;
      }
      j = skipScripts(j, to); // \sin^2, \log_{10}
      while (j < to && isNoise(j)) j = skipNoise(j, to);
      if (j >= to) throw new Unsupported(`Missing argument for ${label}`);
      const [arg, next] = parseFactor(j, to);
      requireDimensionless(arg, j, next, `The argument of ${label.replace(/^\\/, "")}`);
      return [U.ONE, next];
    }

    function parseMinMax(i, to) {
      const j = skipScripts(i + 1, to);
      let from;
      let close;
      if (isCmd(j, "left")) { close = matchRight(j, to); from = j + 2; }
      else if (isChar(j, "(")) { close = matchClose(j, to); from = j + 1; }
      else return parseFactor(j, to);
      const parts = [];
      let start = from;
      let depth = 0;
      for (let k = from; k <= close; k++) {
        if (k < close && (isChar(k, "(") || isChar(k, "{"))) depth++;
        else if (k < close && (isChar(k, ")") || isChar(k, "}"))) depth--;
        if (k === close || (depth === 0 && isChar(k, ","))) {
          parts.push({ v: parseSum(start, k), from: start, to: k });
          start = k + 1;
        }
      }
      const next = isCmd(j, "left") ? close + 2 : close + 1;
      return [combine(parts, "term"), next];
    }

    // ---------- Run ----------
    const relations = L.findRelations(ctx);
    const sides = [];
    let start = 0;
    for (const r of [...relations, T.length]) {
      sides.push({ from: start, to: r });
      start = r + 1;
    }

    let unsupported = "";
    try {
      for (const side of sides) side.v = parseSum(side.from, side.to);
      const proportional = relations.some(r => isCmd(r, "propto"));
      if (sides.length > 1 && !proportional) combine(sides, "side");
    } catch (err) {
      if (!(err instanceof Unsupported)) throw err;
      unsupported = err.message;
    }

    const hasError = issues.some(x => x.level === "error");
    const incomplete = missing.size || untracked.size || invalid.size;
    let state = "ok";
    if (hasError) state = "error";
    else if (unsupported) state = "unsupported";
    else if (incomplete) state = "incomplete";
    else if (issues.length) state = "warn";

    return {
      state, unsupported, issues,
      missing: [...missing], untracked: [...untracked], invalid: [...invalid],
      sides: sides.map(s => ({ latex: text(s.from, s.to), unit: s.v ? U.describe(s.v) : null }))
    };
  }

  return { check };
})();

const CHECK_TITLES = {
  ok: "✓ Units are consistent",
  warn: "⚠ Units are consistent, but scales differ",
  error: "✗ Unit mismatch",
  incomplete: "Unit check incomplete",
  unsupported: "This equation could not be fully checked"
};
const CHECK_LABELS = { ok: "✓ units", warn: "⚠ unit scale", error: "✗ units", incomplete: "… units", unsupported: "? units" };

// Unit check of one equation against the shared variable table. Never throws.
function unitCheckResult(eq, varList = buildVariableRegistry()) {
  try {
    // Index notation: m_j has the unit of m; an index used as a number (i + j - 1) is dimensionless
    const latex = indexRanges().size
      ? normalizeSubscripts(eq.latex).replace(/_(?:\{([^{}]*)\}|([A-Za-z]))/g, (m, braced, single) => (parseIndexList(braced !== undefined ? braced : single) ? "" : m))
      : eq.latex;
    const vars = varList.map(v => ({ symbol: v.symbol, unit: v.units, nonscalar: !!v.shape }));
    indexRanges().forEach((r, letter) => vars.push({ symbol: letter, unit: "1" }));
    const ode = eq.archetype === "ode" && odeLeftSide((eq.latex || "").split("=")[0] || "");
    if (ode && ode.order === 2) {
      const unitOf = sym => (varList.find(v => v.symbol === sym) || {}).units || "";
      const ux = unitOf(ode.dependent), ut = unitOf(odeVariables(eq).independent);
      const unit = ux && ut ? `(${ux})/(${ut})^2` : "";
      const base = ode.dependent;
      vars.push({ symbol: `\\ddot{${base}}`, unit, nonscalar: looksNonScalar(base) });
    }
    return UnitCheck.check(latex, vars);
  } catch (err) {
    return { state: "unsupported", unsupported: String(err.message || err), issues: [], missing: [], untracked: [], invalid: [], sides: [] };
  }
}

// Small badge for the equation list and the graph; empty when the check is off.
function unitCheckBadge(eq, varList) {
  if (!eq.unitCheck || !eq.latex.trim()) return "";
  const state = unitCheckResult(eq, varList).state;
  return CHECK_LABELS[state] ? `<span class="eq-item-check eq-item-check-${state}">${CHECK_LABELS[state]}</span>` : "";
}
