// SolverMapp — LaTeX symbol reader (`Latex`), ported from example_project/js/latex-variables.js.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// LATEX SYMBOL READER (ported from example_project/js/latex-variables.js)
// Used by the unit check, which needs token positions. Symbol detection for
// inputs/outputs stays with detectFromLatex above.
// ================================================================
const Latex = (() => {
  const GREEK = new Set((
    "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa varkappa " +
    "lambda mu nu xi omicron rho varrho sigma varsigma tau upsilon phi varphi chi psi omega " +
    "Gamma Delta Theta Lambda Xi Sigma Upsilon Phi Psi Omega"
  ).split(" "));
  // Commands whose single argument forms one symbol name.
  const SYMBOL_WRAPPERS = new Set([
    "hat", "widehat", "bar", "overline", "dot", "ddot", "vec", "tilde", "widetilde",
    "mathbf", "boldsymbol", "bm", "mathcal", "mathbb", "mathsf", "mathit", "mathrm"
  ]);
  const RELATIONS = new Set(["approx", "equiv", "simeq", "coloneqq", "triangleq", "propto"]);
  const FRACS = new Set(["frac", "dfrac", "tfrac", "cfrac"]);
  // Commands with braced arguments; those braces are arguments, not symbol groups.
  const ARITY = new Map([
    ["frac", 2], ["dfrac", 2], ["tfrac", 2], ["cfrac", 2], ["binom", 2],
    ["sqrt", 1], ["overset", 2], ["underset", 2], ["stackrel", 2]
  ]);
  const CONSTANTS_UPRIGHT = new Set(["d", "e"]); // \mathrm{d} differential, \mathrm{e} Euler
  // Function names typed without a backslash ("sin x" instead of "\sin x").
  const BARE_FUNCTIONS = /^(?:arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|exp|log|ln|lim|max|min|det|sgn)(?![A-Za-z])/;
  const LETTER = /\p{L}/u;

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      const start = i;
      if (c === "\\") {
        const m = /^\\(?:[A-Za-z]+|.)/.exec(src.slice(i));
        if (!m) { i++; continue; }
        i += m[0].length;
        tokens.push({ type: "cmd", value: m[0].slice(1), start, end: i });
      } else if (/\s/.test(c)) {
        i++;
      } else if (LETTER.test(c)) {
        const prev = src[i - 1];
        const fn = (!prev || !LETTER.test(prev)) && BARE_FUNCTIONS.exec(src.slice(i));
        if (fn) {
          i += fn[0].length;
          tokens.push({ type: "fn", value: fn[0], start, end: i });
        } else {
          i++;
          tokens.push({ type: "letter", value: c, start, end: i });
        }
      } else {
        i++;
        tokens.push({ type: /[0-9]/.test(c) ? "digit" : "char", value: c, start, end: i });
      }
    }
    return tokens;
  }

  const isChar = (tok, ch) => !!tok && tok.type === "char" && tok.value === ch;

  function isSymbolStart(tok) {
    return !!tok && (tok.type === "letter" ||
      (tok.type === "cmd" && (GREEK.has(tok.value) || SYMBOL_WRAPPERS.has(tok.value))));
  }

  function sliceSrc(tokens, src, from, to) {
    return from < to ? src.slice(tokens[from].start, tokens[to - 1].end) : "";
  }

  // A braced group or a single token. Returns inner token range and the index after it.
  function readArg(tokens, i, limit) {
    if (i >= limit) return null;
    if (!isChar(tokens[i], "{")) return { innerFrom: i, innerTo: i + 1, next: i + 1 };
    let depth = 0;
    for (let j = i; j < limit; j++) {
      if (isChar(tokens[j], "{")) depth++;
      else if (isChar(tokens[j], "}") && --depth === 0) return { innerFrom: i + 1, innerTo: j, next: j + 1 };
    }
    return { innerFrom: i + 1, innerTo: limit, next: limit }; // unclosed brace
  }

  // Map of token index -> command name, for every '{' that opens a command argument.
  function findArgOpeners(tokens) {
    const openers = new Map();
    tokens.forEach((tok, i) => {
      const arity = tok.type === "cmd" ? ARITY.get(tok.value) : 0;
      if (!arity) return;
      let j = i + 1;
      if (tok.value === "sqrt" && isChar(tokens[j], "[")) {
        while (j < tokens.length && !isChar(tokens[j], "]")) j++;
        j++;
      }
      for (let k = 0; k < arity && j < tokens.length; k++) {
        if (isChar(tokens[j], "{")) openers.set(j, tok.value);
        j = readArg(tokens, j, tokens.length).next;
      }
    });
    return openers;
  }

  function analyze(latex) {
    const src = String(latex || "");
    const tokens = tokenize(src);
    return { src, tokens, openers: findArgOpeners(tokens) };
  }

  // Superscripts that mark a time level / iterate rather than a power: T^{n+1}, u^{*}
  function isIndexSuperscript(text, subscripted) {
    const t = String(text).replace(/\s+/g, "");
    return /^\*+$/.test(t) ||
      /^\(?[nkm][+-](?:\d+(?:\/\d+)?|\\frac\{?1\}?\{?2\}?)\)?$/.test(t) ||
      /^\([nkm]\)$/.test(t) ||
      (subscripted && /^[nkm]$/.test(t));
  }

  // Reads one symbol starting at i. Returns { name, next }, name null for constants, or null if no symbol.
  function readSymbol(ctx, i, limit) {
    const { tokens, src } = ctx;
    const tok = tokens[i];
    let name;
    let next = i + 1;

    if (tok.type === "letter") {
      if (tok.value === "e" && isChar(tokens[next], "^")) return { name: null, next }; // Euler's number
      name = tok.value;
    } else if (tok.type === "cmd" && GREEK.has(tok.value)) {
      name = "\\" + tok.value;
      const following = tokens[next];
      if ((tok.value === "Delta" || tok.value === "delta") && following && following.type === "letter") {
        name += " " + following.value;
        next++;
      }
    } else if (tok.type === "cmd" && SYMBOL_WRAPPERS.has(tok.value)) {
      const arg = readArg(tokens, next, limit);
      if (!arg) return null;
      next = arg.next;
      const inner = sliceSrc(tokens, src, arg.innerFrom, arg.innerTo).trim();
      if (!inner || (tok.value === "mathrm" && CONSTANTS_UPRIGHT.has(inner))) return { name: null, next };
      name = "\\" + tok.value + "{" + inner + "}";
    } else if (isChar(tok, "{") && !ctx.openers.has(i)) {
      // {RT}: a standalone braced group of letters/digits is one multi-letter symbol
      const arg = readArg(tokens, i, limit);
      const inner = tokens.slice(arg.innerFrom, arg.innerTo);
      if (!inner.length || inner[0].type !== "letter" ||
          !inner.every(t => t.type === "letter" || t.type === "digit")) return null;
      next = arg.next;
      const word = inner.map(t => t.value).join("");
      name = inner.length === 1 ? word : "{" + word + "}";
    } else {
      return null;
    }

    while (isChar(tokens[next], "'")) { name += "'"; next++; }
    let subscripted = false;
    for (let pass = 0; pass < 2; pass++) {
      if (!subscripted && isChar(tokens[next], "_")) {
        const arg = readArg(tokens, next + 1, limit);
        if (!arg) break;
        const sub = sliceSrc(tokens, src, arg.innerFrom, arg.innerTo).trim();
        if (sub) name += "_{" + sub + "}";
        next = arg.next;
        subscripted = true;
      } else if (isChar(tokens[next], "^")) {
        // Time-level superscripts belong to the symbol (T^{n+1} is still T); powers do not.
        const arg = readArg(tokens, next + 1, limit);
        if (!arg) break;
        const sup = sliceSrc(tokens, src, arg.innerFrom, arg.innerTo);
        if (!isIndexSuperscript(sup, subscripted || isChar(tokens[arg.next], "_"))) break;
        next = arg.next;
      } else {
        break;
      }
    }
    while (isChar(tokens[next], "'")) { name += "'"; next++; }
    return { name, next };
  }

  function isDifferential(ctx, i) {
    const { tokens } = ctx;
    const tok = tokens[i];
    if (!tok || tok.type !== "letter" || tok.value !== "d") return false;
    const following = tokens[i + 1];
    const prev = tokens[i - 1];
    // Start of a \frac argument: \frac{dT}{dx}, \frac{d^2u}{dx^2}, \frac{d}{dt}
    if (isChar(prev, "{") && FRACS.has(ctx.openers.get(i - 1))) {
      return isSymbolStart(following) || isChar(following, "^") || isChar(following, "}");
    }
    // After a thin space, as in \int f(x)\,dx
    return isSymbolStart(following) &&
      !!prev && prev.type === "cmd" && (prev.value === "," || prev.value === ";" || prev.value === "!");
  }

  // Indices of top-level relation tokens.
  function findRelations(ctx) {
    const found = [];
    let depth = 0;
    ctx.tokens.forEach((tok, i) => {
      if (isChar(tok, "{")) depth++;
      else if (isChar(tok, "}")) depth--;
      else if (depth === 0 && (isChar(tok, "=") || (tok.type === "cmd" && RELATIONS.has(tok.value)))) found.push(i);
    });
    return found;
  }

  // Whitespace cleanup and short subscripts without braces: c_{p} -> c_p
  function tidy(name) {
    return String(name || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*([{}_^'])\s*/g, "$1")
      .replace(/_\{([\p{L}0-9])\}/gu, "_$1");
  }

  // Canonical form of a symbol, so "T_\infty" and "T_{\infty}" compare equal.
  function canonical(symbol) {
    let src = String(symbol || "").trim();
    const bare = /^[A-Za-z][A-Za-z0-9]+(?=[_']|$)/.exec(src);
    if (bare) src = "{" + bare[0] + "}" + src.slice(bare[0].length);
    const ctx = analyze(src);
    if (ctx.tokens.length) {
      const sym = readSymbol(ctx, 0, ctx.tokens.length);
      if (sym && sym.name && sym.next === ctx.tokens.length) return tidy(sym.name);
    }
    return tidy(src);
  }

  return { analyze, readSymbol, readArg, isChar, isSymbolStart, sliceSrc, isDifferential, findRelations, FRACS, canonical };
})();
