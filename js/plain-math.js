// SolverMapp — Plain math input ("Re = rho*u*D/mu") converted to LaTeX: `PlainMath`, `typedToLatex`.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// PLAIN MATH: "Re = rho*u*D/mu" -> "R_e = \frac{\rho u D}{\mu}"
// For users who don't type LaTeX. Text with a backslash or braces is taken as LaTeX.
// Names: Greek words become letters (rho -> \rho), a multi-letter name keeps one variable by
// putting the rest in the subscript (Re -> R_e, Ttotal -> T_{total}), _ starts a subscript
// (c_p, T_inf -> T_\infty), trailing digits are a subscript (mu0 -> \mu_0).
// dX/dt is a derivative; sqrt(), abs(), exp(), ln(), log(), log10(), sin() ... are functions;
// any other name followed by ( ) is a function of those arguments (mu(T)).
// ================================================================
const PlainMath = (() => {
  const GREEK = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta",
    "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega"]);
  const FUNCS = { sin: "\\sin", cos: "\\cos", tan: "\\tan", sinh: "\\sinh", cosh: "\\cosh", tanh: "\\tanh",
    exp: "\\exp", ln: "\\ln", log: "\\log", log10: "\\log_{10}" };

  const isPlain = text => !!String(text).trim() && !/[\\{}]/.test(text);

  function tokenize(t) {
    const out = [];
    const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*'*)|(\*\*|<=|>=|[-+*/^(),=<>]))/y;
    let m;
    while (re.lastIndex < t.length) {
      const at = re.lastIndex;
      if (!(m = re.exec(t))) {
        if (/^\s*$/.test(t.slice(at))) break;
        throw new Error(`can't read “${t.slice(at).trim()[0]}”`);
      }
      out.push(m[1] !== undefined ? { k: "num", v: m[1] } : m[2] !== undefined ? { k: "id", v: m[2] } : { k: "op", v: m[3] === "**" ? "^" : m[3] });
    }
    return out;
  }

  const word = w => (GREEK.has(w) ? "\\" + w : /^inf(ty)?$/.test(w) ? "\\infty" : w);
  const sub = parts => {
    const s = parts.filter(Boolean).map(word).join(",");
    return !s ? "" : s.length === 1 || /^\\[A-Za-z]+$/.test(s) ? "_" + s : `_{${s}}`;
  };

  // A name as one LaTeX symbol
  function name(id) {
    const primes = id.match(/'*$/)[0];
    const [head, ...rest] = id.slice(0, id.length - primes.length).split("_");
    const m = /^([A-Za-z]+?)(\d*)$/.exec(head) || [head, head, ""];
    const letters = m[1];
    const parts = [];
    let base;
    if (GREEK.has(letters)) base = "\\" + letters;
    else if (letters.length === 1) base = letters;
    else { base = letters[0]; parts.push(letters.slice(1)); }
    if (m[2]) parts.push(m[2]);
    parts.push(...rest);
    return base + primes + sub(parts);
  }

  // Recursive descent; each node is { tex, kind } so fractions and powers group correctly.
  function parse(tokens) {
    let i = 0;
    const peek = () => tokens[i];
    const isOp = v => peek() && peek().k === "op" && peek().v === v;
    const take = v => { if (!isOp(v)) throw new Error(v === ")" ? "a “(” is not closed" : `“${v}” expected`); i++; };
    const inner = n => (n.kind === "group" ? n.inner : n.tex);
    const wrap = n => `\\left(${inner(n)}\\right)`;

    function atom() {
      const t = peek();
      if (!t) throw new Error("something is missing at the end");
      if (t.k === "num") {
        i++;
        const m = /^(.*?)[eE]([+-]?\d+)$/.exec(t.v);
        if (!m) return { tex: t.v, kind: "num" };
        const exp = `10^{${String(+m[2])}}`;
        return +m[1] === 1 ? { tex: exp, kind: "num" } : { tex: `${m[1]} \\cdot ${exp}`, kind: "prod" };
      }
      if (t.k === "id") {
        i++;
        if (isOp("(")) {
          i++;
          const args = [expr()];
          while (isOp(",")) { i++; args.push(expr()); }
          take(")");
          const fn = t.v;
          if (fn === "sqrt") return { tex: `\\sqrt{${inner(args[0])}}`, kind: "atom" };
          if (fn === "abs") return { tex: `\\left|${inner(args[0])}\\right|`, kind: "atom" };
          if (FUNCS[fn]) return { tex: `${FUNCS[fn]}\\left(${args.map(inner).join(", ")}\\right)`, kind: "atom" };
          return { tex: `${name(fn)}(${args.map(inner).join(", ")})`, kind: "atom" };
        }
        return { tex: name(t.v), kind: "atom", id: t.v };
      }
      if (isOp("(")) {
        i++;
        const e = expr();
        take(")");
        return { tex: `\\left(${e.tex}\\right)`, kind: "group", inner: e.tex };
      }
      throw new Error(`“${t.v}” is not expected here`);
    }

    function power() {
      const base = atom();
      if (!isOp("^")) return base;
      i++;
      const exp = unary();
      const b = ["sum", "prod", "frac", "neg", "pow"].includes(base.kind) ? wrap(base) : base.tex;
      return { tex: `${b}^{${inner(exp)}}`, kind: "pow" };
    }

    function unary() {
      if (isOp("-") || isOp("+")) {
        const sign = peek().v;
        i++;
        const u = unary();
        return sign === "+" ? u : { tex: "-" + (u.kind === "sum" ? wrap(u) : u.tex), kind: "neg" };
      }
      return power();
    }

    // A factor that may follow without an operator: 2 x, a (b + c)
    const startsFactor = () => peek() && (peek().k !== "op" || peek().v === "(");

    // One factor; dX/dt directly after each other is a derivative.
    function factor() {
      const f = unary();
      const next = tokens[i + 1];
      // d2x/dt2: second derivative
      if (f.id && /^d2[A-Za-z]/.test(f.id) && isOp("/") && next && next.k === "id" && /^d[A-Za-z]\w*2$/.test(next.v)) {
        i += 2;
        return { tex: `\\frac{d^2${name(f.id.slice(2))}}{d${name(next.v.slice(1, -1))}^2}`, kind: "frac" };
      }
      if (f.id && /^d[A-Za-z]/.test(f.id) && isOp("/") && next && next.k === "id" && /^d[A-Za-z]/.test(next.v)) {
        i += 2;
        return { tex: `\\frac{d${name(f.id.slice(1))}}{d${name(next.v.slice(1))}}`, kind: "frac" };
      }
      return f;
    }

    // A product of factors, with everything after "/" in one denominator: a/b*c -> \frac{a c}{b}.
    // A leading minus covers the whole term: -h*A/m -> -\frac{h A}{m}.
    function term() {
      if (isOp("-") || isOp("+")) {
        const sign = peek().v;
        i++;
        const t = term();
        return sign === "+" ? t : { tex: "-" + (t.kind === "sum" ? wrap(t) : t.tex), kind: "neg" };
      }
      const num = [factor()], den = [];
      for (;;) {
        if (isOp("*")) { i++; num.push(factor()); }
        else if (isOp("/")) { i++; den.push(factor()); }
        else if (startsFactor()) num.push(factor());
        else break;
      }
      if (!den.length) return num.length === 1 ? num[0] : { tex: product(num), kind: "prod" };
      const top = num.length > 1 && num[0].kind === "num" && num[0].tex === "1" ? num.slice(1) : num;
      const side = list => (list.length === 1 ? inner(list[0]) : product(list));
      return { tex: `\\frac{${side(top)}}{${side(den)}}`, kind: "frac" };
    }

    function product(list) {
      const part = n => (n.kind === "sum" || n.kind === "neg" ? wrap(n) : n.tex);
      const ordered = [...list.filter(n => n.kind === "num"), ...list.filter(n => n.kind !== "num")]; // 2 D, not D 2
      return ordered.map(part).reduce((acc, t) => acc + (/\d$/.test(acc) && /^\d/.test(t) ? " \\cdot " : " ") + t);
    }

    function expr() {
      let node = term();
      while (isOp("+") || isOp("-")) {
        const op = peek().v;
        i++;
        const right = term();
        node = { tex: `${node.tex} ${op} ${right.kind === "neg" ? wrap(right) : right.tex}`, kind: "sum" };
      }
      return node;
    }

    const sides = [expr()];
    while (isOp("=") || isOp("<") || isOp(">") || isOp("<=") || isOp(">=")) {
      const op = { "=": "=", "<": "<", ">": ">", "<=": "\\le", ">=": "\\ge" }[peek().v];
      i++;
      sides.push(op, expr());
    }
    if (i < tokens.length) throw new Error(tokens[i].v === ")" ? "a “)” has no “(”" : `“${tokens[i].v}” is not expected here`);
    return sides.map(s => (typeof s === "string" ? ` ${s} ` : s.tex)).join("");
  }

  // { latex, error }: on an error (e.g. while still typing) the text is passed on as it is.
  function toLatex(text) {
    try { return { latex: parse(tokenize(String(text).trim())), error: null }; }
    catch (e) { return { latex: String(text).trim(), error: e.message }; }
  }

  return { isPlain, toLatex, name };
})();

// The LaTeX of what was typed in the Equation box (plain math is converted; LaTeX stays).
function typedToLatex(text) {
  return PlainMath.isPlain(text) ? PlainMath.toLatex(text) : { latex: text, error: null };
}
