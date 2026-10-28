// SolverMapp — The expression engine (`Expr`: parse neutral code, shapes, emit Python / MATLAB /
// Fortran, evaluate) and the model run in the browser (`simulateModel`, root analysis).
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// NUMERIC EVALUATION IN THE BROWSER
// Evaluates the expressions written for the Python export (** powers, f[i] elements, math
// functions) and runs the model like the exported code, so implicit equations can be explored
// on the card: residual, roots, and which root the Newton iteration reaches from each guess.
// ================================================================
// Expressions written by latexToCode use Python syntax plus four markers: · (\cdot), × (\times),
// ⊙ (\odot, element-wise) and ᵀ (transpose). Expr parses them into a tree that knows scalars,
// vectors and matrices: it writes Python (numpy), MATLAB and Fortran, and evaluates in the browser.
const Expr = (function () {
  const ELEMENTWISE = { sqrt: Math.sqrt, exp: Math.exp, log: Math.log, log10: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs };
  const CONSTS = { inf: Infinity };
  const CMP = ["<", "<=", ">", ">=", "==", "!="];

  function tokenize(src) {
    const re = /\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_]\w*)|(\*\*|<=|>=|==|!=|[-+*/()[\],<>·×⊙ᵀ]))/y;
    const tokens = [];
    while (re.lastIndex < src.length && /\S/.test(src.slice(re.lastIndex))) {
      const at = re.lastIndex;
      const m = re.exec(src);
      if (!m) throw new Error(`cannot read “${src.slice(at).trim().slice(0, 12)}”`);
      if (m[1] !== undefined) tokens.push({ num: m[1] });
      else if (/^(and|or|not)$/.test(m[2] || "")) tokens.push({ op: m[2] });
      else if (m[2] !== undefined) tokens.push({ name: m[2] });
      else tokens.push({ op: m[3] });
    }
    return tokens;
  }

  // Python precedence: or < and < not < comparisons < + - < * / · × ⊙ < unary - < ** < ᵀ [] calls
  function parse(src) {
    const t = tokenize(String(src));
    let i = 0;
    const peek = (...ops) => t[i] && ops.includes(t[i].op);
    const expect = op => { if (!peek(op)) throw new Error(`“${op}” expected`); i++; };
    const left = (next, ops) => () => {
      let a = next();
      while (peek(...ops)) { const op = t[i++].op; a = { k: "bin", op, a, b: next() }; }
      return a;
    };
    const or = left(() => and(), ["or"]);
    const and = left(() => not(), ["and"]);
    function not() {
      if (peek("not")) { i++; return { k: "un", op: "not", a: not() }; }
      return cmp();
    }
    function cmp() {
      const first = add();
      const pairs = [];
      let a = first;
      while (peek(...CMP)) { const op = t[i++].op; const b = add(); pairs.push({ k: "bin", op, a, b }); a = b; }
      return pairs.length ? pairs.reduce((x, y) => ({ k: "bin", op: "and", a: x, b: y })) : first;
    }
    const add = left(() => mul(), ["+", "-"]);
    const mul = left(() => unary(), ["*", "/", "·", "×", "⊙"]);
    function unary() {
      if (peek("-")) { i++; return { k: "un", op: "-", a: unary() }; }
      if (peek("+")) { i++; return unary(); }
      const base = postfix();
      if (!peek("**")) return base;
      i++;
      return { k: "pow", a: base, b: unary() };
    }
    function postfix() {
      let a = atom();
      for (;;) {
        if (peek("[")) { i++; const idx = or(); expect("]"); a = { k: "index", a, i: idx }; }
        else if (peek("ᵀ")) { i++; a = { k: "tr", a }; }
        else return a;
      }
    }
    function atom() {
      const tok = t[i++];
      if (!tok) throw new Error("expression ends too early");
      if (tok.num !== undefined) return { k: "num", text: tok.num, v: parseFloat(tok.num) };
      if (tok.name !== undefined) {
        if (!peek("(")) return { k: "var", name: tok.name };
        i++;
        const args = peek(")") ? [] : [or()];
        while (peek(",")) { i++; args.push(or()); }
        expect(")");
        return { k: "call", name: tok.name, args };
      }
      if (tok.op === "(") { const a = or(); expect(")"); return a; }
      throw new Error(`unexpected “${tok.op}”`);
    }
    const tree = or();
    if (i < t.length) throw new Error(`unexpected “${t[i].op || t[i].name || t[i].num}”`);
    return tree;
  }

  // ---------- Shapes: { rank: 0 | 1 | 2, row, dims } from the Size column ----------
  // dims (code of each dimension) are known for variables and what is built from them.
  const S0 = { rank: 0 };
  function shapeOf(n, shapes) {
    switch (n.k) {
      case "num": return S0;
      case "var": return shapes[n.name] ? { rank: shapes[n.name].rank, row: false, dims: shapes[n.name].dims } : S0;
      case "un": return n.op === "not" ? S0 : shapeOf(n.a, shapes);
      case "tr": {
        const s = shapeOf(n.a, shapes);
        if (s.rank === 1) return { ...s, row: !s.row };
        return s.rank === 2 ? { ...s, dims: s.dims && [s.dims[1], s.dims[0]] } : s;
      }
      case "index": return S0;
      case "call": {
        if (n.name === "at") {
          const b = shapeOf(n.args[0], shapes);
          const k = n.args.length - 1;
          return b.rank > k ? { rank: b.rank - k, row: false, dims: b.dims && b.dims.slice(k) } : S0;
        }
        if (n.name === "isum") return shapeOf(n.args[4], shapes);
        return n.name === "norm" || n.name === "min" || n.name === "max" || !ELEMENTWISE[n.name] ? S0 : shapeOf(n.args[0], shapes);
      }
      case "pow": {
        const s = shapeOf(n.a, shapes);
        if (s.rank === 2) return s;
        return S0; // scalar power, or v^2 = v · v
      }
      case "bin": {
        if (CMP.includes(n.op) || n.op === "and" || n.op === "or") return S0;
        const a = shapeOf(n.a, shapes), b = shapeOf(n.b, shapes);
        if (n.op === "+" || n.op === "-") return a.rank >= b.rank ? a : b;
        const kind = productKind(n, a, b, shapes);
        const d = (x, k) => x.dims && x.dims[k];
        const matmul = a.rank === 2 && b.rank === 2 ? { rank: 2, dims: d(a, 0) && d(b, 1) && [d(a, 0), d(b, 1)] }
          : a.rank === 2 ? { rank: 1, row: false, dims: d(a, 0) && [d(a, 0)] } : { rank: 1, row: true, dims: d(b, 1) && [d(b, 1)] };
        return { scale: a.rank ? a : b, div: a, elem: a, cross: { rank: 1, row: false, dims: ["3"] }, dot: S0,
          outer: { rank: 2, dims: d(a, 0) && d(b, 0) && [d(a, 0), d(b, 0)] }, matmul, solve: b }[kind];
      }
    }
    return S0;
  }

  const isInverse = (n, shapes) => n.k === "pow" && shapeOf(n.a, shapes).rank === 2 && numberOf(n.b) === -1;
  const numberOf = n => (n.k === "num" ? n.v : n.k === "un" && n.op === "-" && n.a.k === "num" ? -n.a.v : null);

  // How a product of two operands is computed.
  function productKind(n, a, b, shapes) {
    if (n.op === "/") return "div";
    if (!a.rank || !b.rank) return "scale";
    if (n.op === "⊙") return "elem";
    if (n.op === "×" && a.rank === 1 && b.rank === 1) return "cross";
    if (isInverse(n.a, shapes)) return "solve";
    if (a.rank === 1 && b.rank === 1) return n.op === "*" && !a.row && b.row ? "outer" : "dot";
    return "matmul";
  }

  function usesArrays(n, shapes) {
    if (!n || typeof n !== "object") return false;
    if (n.k === "var" && shapes[n.name]) return true;
    if (n.k === "tr" || (n.k === "call" && (n.name === "norm" || n.name === "at" || n.name === "isum"))) return true;
    return ["a", "b", "i"].some(key => usesArrays(n[key], shapes)) || (n.args || []).some(x => usesArrays(x, shapes));
  }

  function mentions(n, name) {
    if (!n || typeof n !== "object") return false;
    if (n.k === "var" && n.name === name) return true;
    return ["a", "b", "i"].some(key => mentions(n[key], name)) || (n.args || []).some(x => mentions(x, name));
  }

  // ---------- Writing code ----------
  const P = { or: 1, and: 2, not: 3, cmp: 4, add: 5, mul: 6, neg: 7, pow: 8, post: 9, atom: 10 };
  const LOGIC = {
    python: { and: "and", or: "or", not: "not ", ne: "!=" },
    matlab: { and: "&&", or: "||", not: "~", ne: "~=" },
    fortran: { and: ".and.", or: ".or.", not: ".not. ", ne: "/=" }
  };

  // ctx: { lang, shapes, number(text), used: Set of helpers (numpy, solve, inv, cross3),
  //        indexLetters, inIndex (writing an index or a range bound), pre (statements before the
  //        current one: MATLAB / Fortran sums), counter: { sum, temps, loopVars } }
  function emit(n, ctx) { return write(n, ctx)[0]; }

  // An index written for Python's 0-based arrays: i -> i - 1, i + 1 -> i, 2 -> 1
  function pyIndex(a, ctx) {
    const k = numberOf(a);
    if (k !== null) return String(k - 1);
    if (a.k === "bin" && (a.op === "+" || a.op === "-") && a.b.k === "num") {
      const off = (a.op === "+" ? a.b.v : -a.b.v) - 1;
      const base = emit(a.a, ctx);
      return off === 0 ? base : off > 0 ? `${base} + ${off}` : `${base} - ${-off}`;
    }
    return `${emit(a, ctx)} - 1`;
  }

  // Zero of a shape, to start a sum in Fortran (an array must have its size).
  function fortranZero(shape) {
    const int = d => (/^\d+$/.test(d) ? d : `int(${d})`);
    if (!shape.rank) return "0.0_dp";
    if (!shape.dims || shape.dims.some(x => !x)) throw new Error("the size of a summed vector is not known: give the Size of the variables in the sum");
    if (shape.rank === 1) return `spread(0.0_dp, 1, ${int(shape.dims[0])})`;
    return `reshape(spread(0.0_dp, 1, ${int(shape.dims[0])} * ${int(shape.dims[1])}), [${int(shape.dims[0])}, ${int(shape.dims[1])}])`;
  }

  function write(n, ctx) {
    const { lang, shapes } = ctx;
    const wrap = ([s, p], min) => (p < min ? `(${s})` : s);
    const sh = x => shapeOf(x, shapes);
    const plainVector = x => (x.k === "tr" && sh(x.a).rank === 1 ? x.a : x); // 1-D arrays have no orientation
    switch (n.k) {
      case "num": return [ctx.number && !ctx.inIndex ? ctx.number(n.text) : n.text, P.atom];
      case "var": {
        const isIndex = ctx.indexLetters && ctx.indexLetters.has(n.name);
        // Fortran: an index used as a number is converted (1 / (i + j - 1) is not integer division);
        // a real variable used as an index or bound is converted to an integer.
        if (lang === "fortran" && isIndex && !ctx.inIndex) return [`real(${n.name}, dp)`, P.atom];
        if (ctx.inIndex && !isIndex && lang !== "matlab") return [`int(${n.name})`, P.atom];
        return [n.name, P.atom];
      }
      case "index": return [`${wrap(write(n.a, ctx), P.post)}[${emit(n.i, ctx)}]`, P.post];
      case "un":
        if (n.op === "not") return [`${LOGIC[lang].not}${wrap(write(n.a, ctx), P.not)}`, P.not];
        return [`-${wrap(write(n.a, ctx), P.neg)}`, P.neg];
      case "tr": {
        const s = sh(n.a);
        if (lang === "matlab") return [`${wrap(write(n.a, ctx), P.post)}.'`, P.post];
        if (s.rank < 2) return write(n.a, ctx);
        return lang === "python" ? [`${wrap(write(n.a, ctx), P.post)}.T`, P.post] : [`transpose(${emit(n.a, ctx)})`, P.atom];
      }
      case "call": {
        if (n.name === "at") {
          const base = n.args[0].name;
          const rank = sh(n.args[0]).rank;
          const idx = n.args.slice(1);
          const ix = idx.map(a => emit(a, { ...ctx, inIndex: true }));
          if (lang === "python") return [`${base}[${idx.map(a => pyIndex(a, { ...ctx, inIndex: true })).join(", ")}]`, P.post];
          if (rank === 2 && idx.length === 1) return lang === "matlab" ? [`${base}(${ix[0]}, :).'`, P.post] : [`${base}(${ix[0]}, :)`, P.atom];
          return [`${base}(${ix.join(", ")})`, P.atom];
        }
        if (n.name === "isum") {
          const [jn, loN, hiN, condN, bodyN] = n.args;
          const j = jn.name;
          const ictx = { ...ctx, inIndex: true };
          const lo = emit(loN, ictx), hi = emit(hiN, ictx);
          const cond = numberOf(condN) === 1 ? null : emit(condN, ictx);
          if (lang === "python") {
            return [`sum(${emit(bodyN, ctx)} for ${j} in range(${lo}, ${hi} + 1)${cond ? ` if ${cond}` : ""})`, P.atom];
          }
          if (!ctx.pre) throw new Error("a sum can only be used in an equation's right-hand side");
          const counter = ctx.counter;
          counter.sum = (counter.sum || 0) + 1;
          const name = `s_sum${counter.sum}`;
          const innerPre = [];
          const body = emit(bodyN, { ...ctx, pre: innerPre });
          const pad = lang === "matlab" ? "    " : "  ";
          const deep = cond ? pad + pad : pad;
          const add = `${deep}${name} = ${name} + (${body})${lang === "matlab" ? ";" : ""}`;
          const inner = [...innerPre.map(l => deep + l), add];
          if (lang === "matlab") {
            ctx.pre.push(`${name} = 0;`, `for ${j} = ${lo}:${hi}`, ...(cond ? [`${pad}if ${cond}`, ...inner, `${pad}end`] : inner), `end`);
          } else {
            (counter.temps = counter.temps || new Map()).set(name, sh(bodyN).rank);
            (counter.loopVars = counter.loopVars || new Set()).add(j);
            ctx.pre.push(`${name} = ${fortranZero(sh(bodyN))}`, `do ${j} = ${lo}, ${hi}`, ...(cond ? [`${pad}if (${cond}) then`, ...inner, `${pad}end if`] : inner), `end do`);
          }
          return [name, P.atom];
        }
        const args = n.args.map(a => emit(n.name === "norm" ? plainVector(a) : a, ctx)).join(", ");
        if (n.name === "norm") {
          if (lang === "python") { ctx.used.add("numpy"); return [`np.linalg.norm(${args})`, P.atom]; }
          return [lang === "matlab" ? `norm(${args})` : `norm2(${args})`, P.atom];
        }
        if (lang === "python" && ELEMENTWISE[n.name] && n.args.some(a => sh(a).rank)) ctx.used.add("numpy");
        return [`${n.name}(${args})`, P.atom];
      }
      case "pow": {
        const s = sh(n.a);
        const k = numberOf(n.b);
        if (s.rank === 2) {
          if (k === -1) {
            if (lang === "python") { ctx.used.add("numpy"); return [`np.linalg.inv(${emit(n.a, ctx)})`, P.atom]; }
            if (lang === "fortran") ctx.used.add("inv");
            return [`inv(${emit(n.a, ctx)})`, P.atom];
          }
          if (lang === "python") { ctx.used.add("numpy"); return [`np.linalg.matrix_power(${emit(n.a, ctx)}, ${emit(n.b, ctx)})`, P.atom]; }
          if (lang === "matlab") return [`${wrap(write(n.a, ctx), P.post)}^${wrap(write(n.b, ctx), P.post)}`, P.pow];
          ctx.used.add("matpow");
          return [`matpow(${emit(n.a, ctx)}, ${emit(n.b, ctx)})`, P.atom];
        }
        if (s.rank === 1) return write({ k: "bin", op: "·", a: n.a, b: n.a }, ctx); // |v|^2 = v · v
        const base = wrap(write(n.a, ctx), P.post);
        const exp = n.b.k === "num" && /^\d+$/.test(n.b.text) ? n.b.text
          : n.b.k === "num" || n.b.k === "var" || n.b.k === "call" ? emit(n.b, ctx) : `(${emit(n.b, ctx)})`;
        return [`${base}${lang === "matlab" ? "^" : "**"}${exp}`, P.pow];
      }
      case "bin": {
        const op = n.op;
        if (op === "and" || op === "or") {
          const p = op === "and" ? P.and : P.or;
          return [`${wrap(write(n.a, ctx), p)} ${LOGIC[lang][op]} ${wrap(write(n.b, ctx), p + 1)}`, p];
        }
        if (CMP.includes(op)) {
          const o = op === "!=" ? LOGIC[lang].ne : op;
          return [`${wrap(write(n.a, ctx), P.cmp + 1)} ${o} ${wrap(write(n.b, ctx), P.cmp + 1)}`, P.cmp];
        }
        if (op === "+" || op === "-") return [`${wrap(write(n.a, ctx), P.add)} ${op} ${wrap(write(n.b, ctx), P.add + 1)}`, P.add];
        const a = sh(n.a), b = sh(n.b);
        const kind = productKind(n, a, b, shapes);
        const A = () => wrap(write(n.a, ctx), P.mul), B = () => wrap(write(n.b, ctx), P.mul + 1);
        const call = (py, m, f) => {
          if (lang === "python") ctx.used.add("numpy");
          return [lang === "python" ? py : lang === "matlab" ? m : f, P.atom];
        };
        const va = () => emit(plainVector(n.a), ctx), vb = () => emit(plainVector(n.b), ctx);
        switch (kind) {
          case "div":
            if (b.rank) throw new Error("division by a vector or matrix: multiply by the inverse instead");
            return [`${A()} / ${B()}`, P.mul];
          case "scale": return [`${A()} * ${B()}`, P.mul];
          case "elem": return [`${A()} ${lang === "matlab" ? ".*" : "*"} ${B()}`, P.mul];
          case "cross":
            if (lang === "fortran") ctx.used.add("cross3");
            return call(`np.cross(${va()}, ${vb()})`, `cross(${va()}, ${vb()})`, `cross3(${va()}, ${vb()})`);
          case "dot": return call(`np.dot(${va()}, ${vb()})`, `dot(${va()}, ${vb()})`, `dot_product(${va()}, ${vb()})`);
          case "outer":
            return call(`np.outer(${va()}, ${vb()})`, `(${emit(n.a, ctx)} * ${emit(n.b, ctx)})`,
              `spread(${va()}, 2, size(${vb()})) * spread(${vb()}, 1, size(${va()}))`);
          case "solve": {
            const M = emit(n.a.a, ctx);
            if (lang === "fortran") ctx.used.add(b.rank === 1 ? "solve" : "inv");
            return call(`np.linalg.solve(${M}, ${emit(n.b, ctx)})`, `(${M} \\ ${emit(n.b, ctx)})`,
              b.rank === 1 ? `solve(${M}, ${vb()})` : `matmul(inv(${M}), ${emit(n.b, ctx)})`);
          }
          default: { // matmul
            if (lang === "python") { ctx.used.add("numpy"); return [`${wrap(write(plainVector(n.a), ctx), P.mul)} @ ${wrap(write(plainVector(n.b), ctx), P.mul + 1)}`, P.mul]; }
            if (lang === "matlab") return [`${A()} * ${B()}`, P.mul];
            return [`matmul(${emit(a.rank === 1 ? plainVector(n.a) : n.a, ctx)}, ${emit(b.rank === 1 ? plainVector(n.b) : n.b, ctx)})`, P.atom];
          }
        }
      }
    }
    throw new Error("cannot write this expression");
  }

  // ---------- Evaluating in the browser ----------
  const isMat = x => Array.isArray(x) && Array.isArray(x[0]);
  const isVec = x => Array.isArray(x) && !isMat(x);
  const rowOf = (v, row) => { const c = v.slice(); c.row = row; return c; };
  const map1 = (x, f) => (isMat(x) ? x.map(r => r.map(f)) : isVec(x) ? rowOf(x.map(f), x.row) : f(x));
  function map2(a, b, f) {
    if (!Array.isArray(a) && !Array.isArray(b)) return f(a, b);
    if (!Array.isArray(a)) return map1(b, y => f(a, y));
    if (!Array.isArray(b)) return map1(a, x => f(x, b));
    if (isMat(a) !== isMat(b) || a.length !== b.length || (isMat(a) && a[0].length !== b[0].length)) throw new Error("sizes do not match");
    return isMat(a) ? a.map((r, i) => r.map((x, j) => f(x, b[i][j]))) : rowOf(a.map((x, i) => f(x, b[i])), a.row);
  }
  const transpose = x => (isMat(x) ? x[0].map((_, j) => x.map(r => r[j])) : isVec(x) ? rowOf(x, !x.row) : x);
  const dot = (a, b) => { if (a.length !== b.length) throw new Error("sizes do not match"); return a.reduce((s, x, i) => s + x * b[i], 0); };
  function matmul(a, b) {
    if (isMat(a) && isMat(b)) { if (a[0].length !== b.length) throw new Error("sizes do not match"); return a.map(r => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0))); }
    if (isMat(a)) { if (a[0].length !== b.length) throw new Error("sizes do not match"); return rowOf(a.map(r => dot(r, b)), false); }
    if (b.length !== a.length) throw new Error("sizes do not match");
    return rowOf(b[0].map((_, j) => a.reduce((s, x, k) => s + x * b[k][j], 0)), true);
  }
  // Gaussian elimination with partial pivoting; B a vector or a matrix of right-hand sides.
  function solve(A, B) {
    const n = A.length;
    if (!isMat(A) || A[0].length !== n) throw new Error("the matrix must be square");
    const vec = !isMat(B);
    const M = A.map((r, i) => [...r, ...(vec ? [B[i]] : B[i])]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (M[p][c] === 0) throw new Error("the matrix is singular");
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k < M[r].length; k++) M[r][k] -= f * M[c][k];
      }
    }
    const X = M.map((r, i) => r.slice(n).map(x => x / M[i][i]));
    return vec ? rowOf(X.map(r => r[0]), false) : X;
  }
  const eye = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
  const inv = A => solve(A, eye(A.length));

  function product(op, a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return op === "/" ? map2(a, b, (x, y) => x / y) : map2(a, b, (x, y) => x * y);
    if (op === "/") throw new Error("division by a vector or matrix");
    if (op === "⊙") return map2(a, b, (x, y) => x * y);
    if (isVec(a) && isVec(b)) {
      if (op === "×") {
        if (a.length !== 3 || b.length !== 3) throw new Error("the cross product needs 3-vectors");
        return rowOf([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], false);
      }
      if (op === "*" && !a.row && b.row) return a.map(x => b.map(y => x * y));
      return dot(a, b);
    }
    return matmul(a, b);
  }

  function evaluate(n, s) {
    switch (n.k) {
      case "num": return n.v;
      case "var":
        if (n.name in CONSTS) return CONSTS[n.name];
        if (!(n.name in s)) throw new Error(`${n.name} has no value`);
        return s[n.name];
      case "index": {
        const v = evaluate(n.a, s)[evaluate(n.i, s)];
        if (v === undefined) throw new Error("array index out of range");
        return v;
      }
      case "un": { const a = evaluate(n.a, s); return n.op === "not" ? +!truthy(a) : map1(a, x => -x); }
      case "tr": return transpose(evaluate(n.a, s));
      case "pow": {
        const a = evaluate(n.a, s), b = evaluate(n.b, s);
        if (isMat(a)) {
          if (b === -1) return inv(a);
          let r = eye(a.length);
          for (let k = 0; k < b; k++) r = matmul(r, a);
          return r;
        }
        if (isVec(a)) return dot(a, a);
        return Math.pow(a, b);
      }
      case "call": {
        if (n.name === "at") {
          const base = evaluate(n.args[0], s);
          const ix = n.args.slice(1).map(a => Math.round(evaluate(a, s)) - 1);
          const v = isMat(base) && ix.length === 1 ? (base[ix[0]] && rowOf(base[ix[0]], false)) : ix.length === 2 ? (base[ix[0]] || [])[ix[1]] : base[ix[0]];
          if (v === undefined) throw new Error(`index out of range in ${n.args[0].name}`);
          return v;
        }
        if (n.name === "isum") {
          const [jn, loN, hiN, condN, bodyN] = n.args;
          const local = Object.create(s);
          let acc = 0;
          for (let v = Math.round(evaluate(loN, s)), hi = Math.round(evaluate(hiN, s)); v <= hi; v++) {
            local[jn.name] = v;
            if (truthy(evaluate(condN, local))) acc = map2(acc, evaluate(bodyN, local), (x, y) => x + y);
          }
          return acc;
        }
        const args = n.args.map(a => evaluate(a, s));
        if (n.name === "norm") return Math.sqrt(isMat(args[0]) ? args[0].flat().reduce((t, x) => t + x * x, 0) : dot(args[0], args[0]));
        if (ELEMENTWISE[n.name]) return map1(args[0], ELEMENTWISE[n.name]);
        if (n.name === "min" || n.name === "max") return Math[n.name](...args);
        if (typeof s[n.name] === "function") return s[n.name](...args);
        throw new Error(`unknown function ${n.name}`);
      }
      case "bin": {
        if (n.op === "and") return +(truthy(evaluate(n.a, s)) && truthy(evaluate(n.b, s)));
        if (n.op === "or") return +(truthy(evaluate(n.a, s)) || truthy(evaluate(n.b, s)));
        const a = evaluate(n.a, s), b = evaluate(n.b, s);
        switch (n.op) {
          case "+": return map2(a, b, (x, y) => x + y);
          case "-": return map2(a, b, (x, y) => x - y);
          case "<": return +(a < b);
          case "<=": return +(a <= b);
          case ">": return +(a > b);
          case ">=": return +(a >= b);
          case "==": return +(a === b);
          case "!=": return +(a !== b);
          default: return product(n.op, a, b);
        }
      }
    }
    throw new Error("cannot evaluate");
  }
  const truthy = x => (Array.isArray(x) ? x.length > 0 : !!x);

  function compile(src) {
    const tree = parse(src);
    return scope => evaluate(tree, scope);
  }

  return { parse, compile, evaluate, emit, shapeOf, usesArrays, mentions, productKind, isMat, isVec, solve, transpose, eye, map2, map1 };
})();

// Kept for the root analysis and the model run: compile(code) -> scope => value
const CodeExpr = { compile: Expr.compile };

// Code of a neutral expression (from latexToCode) in one language. Scalar expressions keep the
// plain form used before vectors existed; anything with a vector or matrix goes through Expr.
// extra: { pre, counter } for sums (MATLAB / Fortran write them as loops before the statement).
function langCode(code, lang, shapes = shapeTable(), used = new Set(), extra = {}) {
  let tree = null;
  try { tree = Expr.parse(code); } catch (e) { /* not parseable: written as is */ }
  const indexLetters = new Set(indexRanges().keys());
  const usesIndex = [...indexLetters].some(l => new RegExp(`\\b${l}\\b`).test(code));
  if (tree && (Expr.usesArrays(tree, shapes) || usesIndex || /\b(?:and|or|not)\b|[<>]=?|[!=]=/.test(code))) {
    return Expr.emit(tree, { lang, shapes, used, number: lang === "fortran" ? fortranNumbers : null,
      indexLetters, pre: extra.pre, counter: extra.counter || {} });
  }
  const scalar = toScalarCode(code);
  return lang === "matlab" ? scalar.replace(/\*\*/g, "^") : lang === "fortran" ? fortranNumbers(scalar) : scalar;
}

// Vector markers read as plain products for scalar code.
const toScalarCode = code => String(code).replace(/\s*[·×⊙]\s*/g, " * ").replace(/ᵀ/g, "");

// Same iteration as the exported code: central-difference derivative, steps that would leave
// the branch [min, max] are halved back towards the bound.
function newtonSolve(R, x0, { tol, maxIter, min, max }) {
  let x = x0;
  if (min !== undefined) x = Math.max(x, min);
  if (max !== undefined) x = Math.min(x, max);
  for (let it = 1; it <= maxIter; it++) {
    const h = 1e-6 * Math.max(Math.abs(x), 1e-6);
    const dr = (R(x + h) - R(x - h)) / (2 * h);
    if (dr === 0) return { ok: false, x, it, why: "zero derivative" };
    let next = x - R(x) / dr;
    if (!Number.isFinite(next)) return { ok: false, x, it, why: "the residual is not defined here" };
    if (min !== undefined && next < min) next = 0.5 * (x + min);
    if (max !== undefined && next > max) next = 0.5 * (x + max);
    if (Math.abs(next - x) < tol * (1 + Math.abs(x))) return { ok: true, x: next, it };
    x = next;
  }
  return { ok: false, x, it: maxIter, why: "no convergence" };
}

const NUM_WORK_LIMIT = 300000; // expression evaluations per model run in the browser

// Multivariate Newton with a central-difference Jacobian, as in the export.
function newtonVector(R, x0, { tol, maxIter }) {
  let x = x0.slice();
  const maxAbs = v => Math.max(...v.map(Math.abs));
  for (let it = 1; it <= maxIter; it++) {
    const r = R(x);
    const J = r.map(() => new Array(x.length));
    for (let j = 0; j < x.length; j++) {
      const h = 1e-6 * Math.max(Math.abs(x[j]), 1e-6);
      const xp = x.slice(), xm = x.slice();
      xp[j] += h; xm[j] -= h;
      const rp = R(xp), rm = R(xm);
      r.forEach((_, i) => { J[i][j] = (rp[i] - rm[i]) / (2 * h); });
    }
    let dx;
    try { dx = Expr.solve(J, r); } catch (e) { return { ok: false, x, it, why: "singular Jacobian" }; }
    const next = x.map((v, i) => v - dx[i]);
    if (!next.every(Number.isFinite)) return { ok: false, x, it, why: "the residual is not defined here" };
    const done = maxAbs(next.map((v, i) => v - x[i])) < tol * (1 + maxAbs(x));
    x = next;
    if (done) return { ok: true, x, it };
  }
  return { ok: false, x, it: maxIter, why: "no convergence" };
}

const maxAbsDiff = (a, b) => {
  const d = Expr.map2(a, b, (x, y) => Math.abs(x - y));
  return Array.isArray(d) ? Math.max(...d.flat()) : d;
};

// A vector or matrix from its Start value and Size (dims evaluated with `value`).
function arrayValue(v, value) {
  const s = arrayStart(v);
  const d = v.shape.dims.map(x => Math.round(value(x)));
  const num = t => value(t);
  if (s.kind === "eye") return Expr.eye(d[0]);
  if (s.kind === "rows") return s.rows.map(r => r.map(num));
  if (s.kind === "list") {
    const flat = s.values.map(num);
    return v.shape.rank === 2 ? Array.from({ length: d[0] }, (_, i) => flat.slice(i * d[1], i * d[1] + d[1])) : flat;
  }
  const x = num(s.value);
  return v.shape.rank === 2 ? Array.from({ length: d[0] }, () => new Array(d[1]).fill(x)) : new Array(d[0]).fill(x);
}

// Runs the model in the order of solution, like the exported Python, and stops just before
// `stopEq`. Values not computed yet are their Start values. Returns { scope, error, computed }.
function simulateModel(stopEq) {
  const plan = analyzeSolverArchitecture();
  const varList = buildVariableRegistry();
  const arrays = indexedArrays(plan, varList);
  const scope = {};
  const computed = new Set();
  const compiled = new Map();
  let work = 0;
  const tree = code => {
    let t = compiled.get(code);
    if (!t) compiled.set(code, (t = Expr.parse(code)));
    return t;
  };
  const evalIn = (code, s) => {
    if (++work > NUM_WORK_LIMIT) throw new Error("the model takes too long to run in the browser");
    const v = Expr.evaluate(tree(String(code)), s);
    return Array.isArray(v) ? v : +v;
  };
  const value = code => evalIn(code, scope);
  const count = code => Math.round(value(String(code)));
  const start = v => {
    try {
      if (v.shape && !v.shape.error) return arrayValue(v, value);
      if (!arrays.has(v.symbol)) return value(String(v.initVal || "1.0"));
      const { lo, hi } = arrays.get(v.symbol);
      const list = listValues(v.initVal);
      return list ? list.map(value) : new Array(Math.max(0, count(hi) - count(lo) + 1)).fill(value(String(v.initVal || "1.0")));
    } catch (e) { return NaN; }
  };
  const order = [...varList.filter(v => !arrays.has(v.symbol) && !v.shape), ...varList.filter(v => arrays.has(v.symbol) || v.shape)];
  order.forEach(v => {
    if (!v.callable) { scope[v.codeVar] = start(v); return; }
    const c = start(v); // a function given only by name: its Start value for now
    scope[v.codeVar] = () => c;
  });

  class Stop extends Error {}
  // Index notation: the array of a free-index equation, filled element by element (like the export)
  const zerosLike = x => (Array.isArray(x) ? x.map(zerosLike) : 0);
  const indexedValue = (p, like) => {
    const shape = shapeTable()[like !== undefined ? null : p.out];
    let arr;
    if (like !== undefined) arr = zerosLike(like);
    else {
      const dims = (shape && shape.dims ? shape.dims : p.free.map(f => indexRangeSize(f.letter))).map(d => Math.round(value(d)));
      arr = dims.length === 2 ? Array.from({ length: dims[0] }, () => new Array(dims[1]).fill(0)) : new Array(dims[0]).fill(0);
    }
    const local = Object.create(scope);
    const fill = (k, idx) => {
      if (k === p.free.length) {
        const v = evalIn(p.code, local);
        if (idx.length === 2) arr[idx[0] - 1][idx[1] - 1] = v;
        else arr[idx[0] - 1] = Array.isArray(v) ? Array.from(v) : v;
        return;
      }
      const f = p.free[k];
      for (let v = Math.round(value(f.lo)), hi = Math.round(value(f.hi)); v <= hi; v++) {
        local[f.letter] = v;
        fill(k + 1, [...idx, v]);
      }
    };
    fill(0, []);
    return arr;
  };

  const runEq = p => {
    if (p.eq === stopEq) throw new Stop();
    const { arch, out } = p;
    const code = p.code;
    if (arch === "marching") {
      for (let k = count(p.steps); k > 0; k--) scope[out] = value(code);
    } else if (arch === "convergence") {
      for (let k = count(p.maxIter); k > 0; k--) {
        const next = value(code);
        const done = maxAbsDiff(next, scope[out]) < +p.tol;
        scope[out] = next;
        if (done) break;
      }
    } else if (arch === "summation") {
      let sum = 0;
      for (let k = count(p.lo), hi = count(p.hi); k <= hi; k++) { scope[p.index] = k; sum = Expr.map2(sum, value(code), (a, b) => a + b); }
      scope[out] = sum;
    } else if (arch === "integral") {
      const lo = value(p.lo), hi = value(p.hi), n = count(p.n), dx = (hi - lo) / n;
      let sum = 0;
      for (let q = 0; q <= n; q++) {
        scope[p.x] = lo + q * dx;
        const w = (q === 0 || q === n ? 0.5 : 1) * dx;
        sum = Expr.map2(sum, value(code), (a, b) => a + w * b);
      }
      scope[out] = sum;
    } else if (arch === "implicit") {
      if (p.linear) {
        scope[out] = Expr.solve(Expr.evaluate(p.linear.A, scope), Expr.evaluate(p.linear.b, scope));
      } else {
        const R = x => { scope[out] = x; return value(p.residual); };
        const x0 = p.inCoupled ? scope[out] : p.guessFromStart ? start(varOf(p.eq.outputs[0])) : value(p.guess);
        const settings = { tol: +p.tol, maxIter: count(p.maxIter) };
        if (p.vector) {
          scope[out] = newtonVector(R, x0, settings).x;
        } else {
          const bound = c => (c ? value(c) : undefined);
          scope[out] = newtonSolve(R, x0, { ...settings, min: bound(p.min), max: bound(p.max) }).x;
        }
      }
    } else if (arch === "function") {
      // The function sees the model's values when it is called, like the exported code.
      scope[out] = (...args) => {
        const local = Object.create(scope);
        p.params.forEach((name, k) => { local[name] = args[k]; });
        return evalIn(code, local);
      };
    } else if (arch !== "ode") {
      scope[out] = p.free && p.free.length ? indexedValue(p) : value(code);
    }
    computed.add(out);
  };

  const runSystem = sys => {
    if (sys.cards.includes(stopEq) || sys.algebraic.some(u => unitEqs(u).includes(stopEq))) throw new Stop();
    const s = sys.settings;
    const t = codeOf(s.independent);
    const states = sys.odes.map(eq => { const plan = equationPlan(eq); return { y: codeOf(eq.outputs[0]), code: plan.code, plan }; });
    scope[t] = value(odeBound(s.from));
    const n = count(s.steps), h = (value(odeBound(s.to)) - scope[t]) / n;
    const axpy = (a, b, f) => Expr.map2(a, b, (x, y) => x + f * y);
    const algebra = () => sys.algebraic.forEach(u => runUnit(u, false));
    const rates = () => states.map(x => (x.plan.free.length ? indexedValue(x.plan, scope[x.y]) : value(x.code)));
    for (let step = 0; step < n; step++) {
      if (s.method === "euler") {
        algebra();
        const r = rates();
        scope[t] = scope[t] + h;
        states.forEach((x, k) => { scope[x.y] = axpy(scope[x.y], r[k], h); });
        continue;
      }
      const { weights: W, nodes: C } = ODE_METHODS.rk4;
      const t0 = scope[t], y0 = states.map(x => scope[x.y]);
      let acc = states.map(() => 0);
      for (let stage = 0; stage < 4; stage++) {
        algebra();
        const r = rates();
        acc = acc.map((a, k) => axpy(a, r[k], W[stage]));
        if (stage < 3) {
          scope[t] = t0 + C[stage] * h;
          states.forEach((x, k) => { scope[x.y] = axpy(y0[k], r[k], C[stage] * h); });
        }
      }
      scope[t] = t0 + h;
      states.forEach((x, k) => { scope[x.y] = axpy(y0[k], acc[k], h / 6); });
    }
    algebra();
    states.forEach(x => computed.add(x.y));
    computed.add(t);
  };

  const runUnit = (unit, inCoupled) => {
    if (unit.kind === "ode") return runSystem(unit.system);
    if (unit.kind === "switch") {
      if (unit.group.eqs.includes(stopEq)) throw new Stop();
      const chosen = unit.group.eqs.find(eq => !conditionText(eq) || value(conditionToCode(eq.condition)));
      if (chosen) runEq({ ...equationPlan(chosen, arrays), inCoupled });
      return;
    }
    runEq({ ...equationPlan(unit.eq, arrays), inCoupled });
  };

  try {
    for (const step of plan.steps) {
      if (!step.coupled) {
        step.units.forEach(u => runUnit(u, false));
        continue;
      }
      for (let it = 0; it < 200; it++) {
        const prev = step.computes.map(s => scope[codeOf(s)]);
        try {
          step.units.forEach(u => runUnit(u, true));
        } catch (e) {
          if (e instanceof Stop) return { scope, computed, coupled: true };
          throw e;
        }
        if (Math.max(...step.computes.map((s, k) => maxAbsDiff(scope[codeOf(s)], prev[k]))) < 1e-8) break;
      }
    }
  } catch (e) {
    if (e instanceof Stop) return { scope, computed };
    return { scope, computed, error: e.message };
  }
  return { scope, computed };
}

const unitEqs = unit => (unit.kind === "eq" ? [unit.eq] : unit.kind === "switch" ? unit.group.eqs : [...unit.system.cards, ...unit.system.algebraic.flatMap(unitEqs)]);

// ---------- Root analysis of one implicit equation ----------
let rootAnalysis = null; // last analysis shown on the card (for hover and "Use this branch")

const fmtNum = x => {
  if (!Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  return a !== 0 && (a < 1e-3 || a >= 1e6) ? x.toExponential(4).replace(/\.?0+e/, "e") : String(+x.toPrecision(6));
};

// Numbers, vectors [1, 2, 3] and matrices [1, 2; 3, 4] for display.
const formatValue = v => (Expr.isMat(v) ? `[${v.map(r => r.map(fmtNum).join(", ")).join("; ")}]`
  : Array.isArray(v) ? `[${v.map(fmtNum).join(", ")}]` : typeof v === "function" ? "function" : fmtNum(v));

// A vector unknown: no scan, just the solve from the guess (or the direct linear solve).
function analyzeVectorRoot(eq, p) {
  const sim = simulateModel(eq);
  const scope = { ...sim.scope };
  const result = { eq, p, sim, roots: [], notes: [], vector: true };
  try {
    if (p.linear) {
      const x = Expr.solve(Expr.evaluate(p.linear.A, scope), Expr.evaluate(p.linear.b, scope));
      return { ...result, state: "ok", message: `Linear in ${p.out}: solved directly.`, value: x };
    }
    const residual = Expr.parse(p.residual);
    const R = x => { scope[p.out] = x; return Expr.evaluate(residual, scope); };
    const x0 = p.guessFromStart ? arrayValue(varOf(eq.outputs[0]), c => +Expr.evaluate(Expr.parse(String(c)), scope)) : Expr.evaluate(Expr.parse(p.guess), scope);
    const s = newtonVector(R, x0, { tol: +p.tol || 1e-10, maxIter: Math.round(+Expr.evaluate(Expr.parse(p.maxIter), scope)) || 50 });
    return s.ok
      ? { ...result, state: "ok", message: `Newton–Raphson converges from the guess in ${s.it} iterations.`, value: s.x }
      : { ...result, state: "error", message: `Newton–Raphson does not converge from the guess (${s.why}).`, value: s.x };
  } catch (e) {
    return { ...result, state: "error", message: `The equation can't be evaluated here: ${e.message}.` };
  }
}

function analyzeRoots(eq) {
  const p = equationPlan(eq);
  if (p.vector) return analyzeVectorRoot(eq, p);
  const sim = simulateModel(eq);
  const scope = { ...sim.scope };
  const result = { eq, p, sim, roots: [], notes: [] };
  let residual;
  const evalCode = code => CodeExpr.compile(code)(scope);
  try {
    residual = CodeExpr.compile(p.residual);
    scope[p.out] = evalCode(p.guess);
    residual(scope);
  } catch (e) {
    return { ...result, state: "error", message: `The equation can't be evaluated here: ${e.message}.` };
  }
  const R = x => {
    scope[p.out] = x;
    try { return residual(scope); } catch (e) { return NaN; }
  };
  const settings = { tol: +p.tol || 1e-10, maxIter: Math.max(1, Math.round(evalCode(p.maxIter)) || 50) };
  try {
    if (p.min) settings.min = evalCode(p.min);
    if (p.max) settings.max = evalCode(p.max);
  } catch (e) { result.notes.push(`Branch limits can't be evaluated: ${e.message}.`); }
  const guess = evalCode(p.guess);
  const inBranch = x => !(x < settings.min) && !(x > settings.max);

  // 1. Find roots on the whole real line: sign changes on a log-spaced grid (±1e-12 … ±1e12)
  //    plus a linear grid around the guess, refined by bisection. Poles (sign change where
  //    |R| grows) are dropped.
  const xs = [0];
  for (let k = -480; k <= 480; k++) { const m = Math.pow(10, k / 40); xs.push(m, -m); }
  const span = Math.max(Math.abs(guess), 1e-6);
  for (let k = -200; k <= 200; k++) xs.push(guess + (k / 100) * span);
  [settings.min, settings.max].filter(Number.isFinite).forEach(b => xs.push(b));
  xs.sort((a, b) => a - b);
  const rs = xs.map(R);
  const found = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    let a = xs[k], b = xs[k + 1], ra = rs[k], rb = rs[k + 1];
    if (!Number.isFinite(ra) || !Number.isFinite(rb) || a === b) continue;
    if (ra === 0) { found.push(a); continue; }
    if (ra * rb > 0) continue;
    const scale = Math.max(Math.abs(ra), Math.abs(rb));
    for (let n = 0; n < 200 && b - a > 1e-15 * Math.max(Math.abs(a), Math.abs(b), 1e-300); n++) {
      const m = 0.5 * (a + b), rm = R(m);
      if (!Number.isFinite(rm)) break;
      if (rm === 0) { a = b = m; break; }
      if (ra * rm < 0) { b = m; rb = rm; } else { a = m; ra = rm; }
    }
    const x = 0.5 * (a + b);
    if (Math.abs(R(x)) <= scale) found.push(x);
  }
  let roots = found.filter((x, k) => !k || Math.abs(x - found[k - 1]) > 1e-7 * Math.max(Math.abs(x), 1e-12));
  result.total = roots.length;
  // Keep the roots nearest to the guess
  roots = roots.map(x => ({ x, d: Math.abs(x - guess) })).sort((a, b) => a.d - b.d).slice(0, 5).map(r => r.x).sort((a, b) => a - b);
  result.roots = roots.map((x, k) => ({ x, n: k + 1, inBranch: inBranch(x), share: 0 }));
  const rootOf = x => result.roots.find(r => Math.abs(r.x - x) <= 1e-6 * Math.max(Math.abs(r.x), 1e-9) + 1e-12);

  // 2. Plot window: the roots and the guess, with a margin
  const pts = [...roots, guess];
  let lo = Math.min(...pts), hi = Math.max(...pts);
  const pad = hi > lo ? 0.12 * (hi - lo) : Math.max(Math.abs(lo), 1) * 0.5;
  lo -= pad; hi += pad;
  result.window = { lo, hi };

  // 3. Guess sensitivity: where Newton goes from guesses across the window, and from the guess
  const BASIN_CELLS = 120;
  result.basins = Array.from({ length: BASIN_CELLS }, (_, k) => {
    const x0 = lo + (k + 0.5) / BASIN_CELLS * (hi - lo);
    const s = newtonSolve(R, x0, settings);
    const root = s.ok ? rootOf(s.x) : null;
    if (root) root.share++;
    return root ? root.n : 0;
  });
  result.roots.forEach(r => { r.share /= BASIN_CELLS; });
  result.guess = guess;
  result.solve = newtonSolve(R, guess, settings);
  result.root = result.solve.ok ? rootOf(result.solve.x) : null;
  // A 10 % change of the guess (both ways) must reach the same root
  const nudged = [0.9, 1.1].map(f => newtonSolve(R, guess === 0 ? (f - 1) : guess * f, settings));
  result.fragile = result.solve.ok && nudged.some(s => !s.ok || Math.abs(s.x - result.solve.x) > 1e-6 * Math.max(Math.abs(s.x), 1e-9));
  result.settings = settings;
  result.R = R;
  result.rootOf = rootOf;

  const branchRoots = result.roots.filter(r => r.inBranch);
  if (!result.solve.ok) {
    result.state = "error";
    result.message = `Newton–Raphson does not converge from the guess ${fmtNum(guess)} (${result.solve.why}).`;
  } else if (branchRoots.length > 1) {
    result.state = "warn";
    result.message = `${branchRoots.length} roots on this branch: the initial guess decides which one is found.`;
  } else if (result.fragile) {
    result.state = "warn";
    result.message = "Sensitive to the initial guess: a 10 % change reaches a different result.";
  } else {
    result.state = "ok";
    result.message = result.roots.length > 1
      ? `One root on this branch (${result.total} in all); the guess converges to it in ${result.solve.it} iterations.`
      : `One root; the guess converges to it in ${result.solve.it} iterations.`;
  }
  if (!ROOT_METHODS[p.method]) result.notes.push(`Method “${p.method}” is not available yet: Newton–Raphson is used.`);
  if (sim.error) result.notes.push(`The model could not run up to this equation (${sim.error}): Start values stand in for the inputs.`);
  if (sim.coupled) result.notes.push("Part of a coupled block: inputs are the values of the first pass.");
  if (result.total > result.roots.length) result.notes.push(`${result.total} roots in all; the ${result.roots.length} nearest to the guess are shown.`);
  return result;
}

// Plot of the residual (symmetric log scale) with the roots, the guess, the branch limits and
// the guess map underneath: the colour under each starting point is the root Newton reaches.
function rootPlotSvg(a) {
  const W = 520, PH = 120, TOP = 6, STRIP_Y = TOP + PH + 8, STRIP_H = 12, H = STRIP_Y + STRIP_H + 18;
  const { lo, hi } = a.window;
  const X = x => 8 + (x - lo) / (hi - lo) * (W - 16);
  const N = 260;
  const samples = Array.from({ length: N + 1 }, (_, k) => { const x = lo + k / N * (hi - lo); return [x, a.R(x)]; });
  const mags = samples.map(s => Math.abs(s[1])).filter(v => Number.isFinite(v) && v > 0).sort((x, y) => x - y);
  const scale = (mags[Math.floor(mags.length / 2)] || 1) / 20;
  const ys = samples.map(s => Math.asinh(s[1] / scale));
  const finite = ys.filter(Number.isFinite).map(Math.abs).sort((x, y) => x - y);
  const top = finite[Math.floor(finite.length * 0.97)] || 1;
  const Y = y => TOP + PH / 2 - Math.max(-1, Math.min(1, y / top)) * (PH / 2 - 4);
  a.plot = { W, lo, hi, X };

  let d = "", pen = false;
  samples.forEach((s, k) => {
    const y = ys[k];
    if (!Number.isFinite(y)) { pen = false; return; }
    const jump = k && Number.isFinite(ys[k - 1]) && Math.sign(y) !== Math.sign(ys[k - 1]) && Math.min(Math.abs(y), Math.abs(ys[k - 1])) > 0.5 * top; // a pole, not a root
    d += `${pen && !jump ? "L" : "M"}${X(s[0]).toFixed(1)},${Y(y).toFixed(1)}`;
    pen = true;
  });

  const out = [`<svg class="root-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Residual of the equation over ${escapeHtml(a.p.out)}, with its roots">`];
  const shade = (x1, x2) => x2 > x1 && out.push(`<rect class="rp-out" x="${X(x1)}" y="${TOP}" width="${X(x2) - X(x1)}" height="${PH}"><title>Outside the branch</title></rect>`);
  if (a.settings.min > lo) shade(lo, Math.min(a.settings.min, hi));
  if (a.settings.max < hi) shade(Math.max(a.settings.max, lo), hi);
  out.push(`<line class="rp-axis" x1="8" x2="${W - 8}" y1="${Y(0)}" y2="${Y(0)}"/>`);
  if (lo < 0 && hi > 0) out.push(`<line class="rp-axis" x1="${X(0)}" x2="${X(0)}" y1="${TOP}" y2="${TOP + PH}"/>`);
  out.push(`<path class="rp-curve" d="${d}"/>`);
  if (a.guess >= lo && a.guess <= hi) out.push(`<line class="rp-guess" x1="${X(a.guess)}" x2="${X(a.guess)}" y1="${TOP}" y2="${TOP + PH}"><title>Initial guess ${fmtNum(a.guess)}</title></line>`);
  a.roots.forEach(r => {
    out.push(`<g><title>Root ${r.n}: ${escapeHtml(a.p.out)} = ${fmtNum(r.x)}</title><circle class="rp-root rc-${Math.min(r.n, 5)}" cx="${X(r.x)}" cy="${Y(0)}" r="7"/>` +
      `<text class="rp-num" x="${X(r.x)}" y="${Y(0) + 3.5}" text-anchor="middle">${r.n}</text></g>`);
  });
  // Guess map: one cell per starting point, coloured by the root reached (grey: none)
  const cw = (W - 16) / a.basins.length;
  a.basins.forEach((n, k) => out.push(`<rect class="${n ? "rc-" + Math.min(n, 5) : "rp-none"}" x="${(8 + k * cw).toFixed(1)}" y="${STRIP_Y}" width="${(cw + 0.3).toFixed(1)}" height="${STRIP_H}"/>`));
  out.push(`<text class="rp-tick" x="8" y="${H - 3}">${fmtNum(lo)}</text><text class="rp-tick" x="${W - 8}" y="${H - 3}" text-anchor="end">${fmtNum(hi)}</text>`);
  out.push(`<text class="rp-tick" x="${W / 2}" y="${H - 3}" text-anchor="middle">initial guess of ${escapeHtml(a.p.out)} → root reached</text>`);
  out.push(`<line class="rp-cross" x1="0" x2="0" y1="${TOP}" y2="${STRIP_Y + STRIP_H}" visibility="hidden"/>`);
  out.push(`<rect class="rp-hit" x="0" y="0" width="${W}" height="${H}"/>`);
  out.push(`</svg>`);
  return out.join("");
}
