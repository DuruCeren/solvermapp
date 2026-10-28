// SolverMapp — Units: parsing and SI dimensions (`Units`), ported from example_project/js/units.js.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// UNITS (ported from example_project/js/units.js)
// A unit is { d: [kg, m, s, K, mol, A, cd] exponents, f: scale factor to SI }.
// Accepted: W/(m·K)  kg m^-3  m/s^2  J/(kg*K)  m²  s-1  kPa  µm  1 or - (dimensionless)
// ================================================================
const Units = (() => {
  const BASE = ["kg", "m", "s", "K", "mol", "A", "cd"];
  const make = (f, exps) => ({ d: BASE.map(b => exps[b] || 0), f });

  const ONE = Object.freeze(make(1, {}));
  const PA = { kg: 1, m: -1, s: -2 };
  const JOULE = { kg: 1, m: 2, s: -2 };

  // name -> [unit, accepts SI prefix]
  const UNITS = {
    m: [make(1, { m: 1 }), true],
    g: [make(1e-3, { kg: 1 }), true],
    kg: [make(1, { kg: 1 }), false],
    s: [make(1, { s: 1 }), true],
    K: [make(1, { K: 1 }), true],
    mol: [make(1, { mol: 1 }), true],
    A: [make(1, { A: 1 }), true],
    cd: [make(1, { cd: 1 }), true],
    rad: [make(1, {}), true],
    sr: [make(1, {}), false],
    Hz: [make(1, { s: -1 }), true],
    N: [make(1, { kg: 1, m: 1, s: -2 }), true],
    Pa: [make(1, PA), true],
    J: [make(1, JOULE), true],
    W: [make(1, { kg: 1, m: 2, s: -3 }), true],
    C: [make(1, { s: 1, A: 1 }), true],
    V: [make(1, { kg: 1, m: 2, s: -3, A: -1 }), true],
    "Ω": [make(1, { kg: 1, m: 2, s: -3, A: -2 }), true],
    ohm: [make(1, { kg: 1, m: 2, s: -3, A: -2 }), true],
    S: [make(1, { kg: -1, m: -2, s: 3, A: 2 }), true],
    F: [make(1, { kg: -1, m: -2, s: 4, A: 2 }), true],
    H: [make(1, { kg: 1, m: 2, s: -2, A: -2 }), true],
    Wb: [make(1, { kg: 1, m: 2, s: -2, A: -1 }), true],
    T: [make(1, { kg: 1, s: -2, A: -1 }), true],
    L: [make(1e-3, { m: 3 }), true],
    l: [make(1e-3, { m: 3 }), true],
    min: [make(60, { s: 1 }), false],
    h: [make(3600, { s: 1 }), false],
    d: [make(86400, { s: 1 }), false],
    day: [make(86400, { s: 1 }), false],
    bar: [make(1e5, PA), true],
    atm: [make(101325, PA), false],
    eV: [make(1.602176634e-19, JOULE), true],
    cal: [make(4.184, JOULE), true],
    degC: [make(1, { K: 1 }), false],
    "°C": [make(1, { K: 1 }), false],
    "%": [make(0.01, {}), false],
    ppm: [make(1e-6, {}), false]
  };

  const PREFIXES = [
    ["da", 1e1], ["Y", 1e24], ["Z", 1e21], ["E", 1e18], ["P", 1e15], ["T", 1e12], ["G", 1e9], ["M", 1e6],
    ["k", 1e3], ["h", 1e2], ["d", 1e-1], ["c", 1e-2], ["m", 1e-3], ["µ", 1e-6], ["μ", 1e-6], ["u", 1e-6],
    ["n", 1e-9], ["p", 1e-12], ["f", 1e-15]
  ];

  const DIMENSIONLESS_WORDS = new Set(["1", "-", "–", "—", "dimensionless", "unitless", "none"]);
  const SUPERSCRIPT_DIGITS = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };

  const mul = (a, b) => ({ d: a.d.map((x, i) => x + b.d[i]), f: a.f * b.f });
  const div = (a, b) => ({ d: a.d.map((x, i) => x - b.d[i]), f: a.f / b.f });
  const pow = (a, p) => ({ d: a.d.map(x => x * p), f: Math.pow(a.f, p) });
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  const sameDims = (a, b) => a.d.every((x, i) => near(x, b.d[i]));
  const sameScale = (a, b) => near(a.f / b.f, 1);
  const isDimensionless = a => a.d.every(x => near(x, 0));

  function lookup(name) {
    if (Object.prototype.hasOwnProperty.call(UNITS, name)) return UNITS[name][0];
    for (const [prefix, factor] of PREFIXES) {
      if (!name.startsWith(prefix) || name.length === prefix.length) continue;
      const rest = name.slice(prefix.length);
      const entry = Object.prototype.hasOwnProperty.call(UNITS, rest) && UNITS[rest];
      if (entry && entry[1]) return { d: entry[0].d, f: entry[0].f * factor };
    }
    throw new Error(`Unknown unit "${name}"`);
  }

  function tokenize(text) {
    const s = text
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, m => "^" + [...m].map(c => SUPERSCRIPT_DIGITS[c]).join(""))
      .replace(/\*\*/g, "^")
      .replace(/[{}]/g, "")
      .replace(/\\cdot|[·⋅×*]/g, " * ")
      .replace(/([A-Za-zµμΩ°%)])\.(?=[A-Za-zµμΩ°(])/g, "$1 * ");
    const tokens = [];
    const re = /\s*(?:([A-Za-zµμΩ°%]+)|(\d+(?:\.\d+)?(?:e[-+]?\d+)?)|(\S))/gy;
    let m;
    while (re.lastIndex < s.length && (m = re.exec(s))) {
      if (m[1]) tokens.push({ type: "name", value: m[1] });
      else if (m[2]) tokens.push({ type: "num", value: Number(m[2]) });
      else if (m[3]) tokens.push({ type: "op", value: m[3] });
    }
    return tokens;
  }

  // Returns a unit, or null when the text is empty (unit not given). Throws on invalid units.
  function parse(text) {
    const raw = String(text == null ? "" : text).trim();
    if (!raw) return null;
    if (DIMENSIONLESS_WORDS.has(raw.toLowerCase())) return ONE;

    const tokens = tokenize(raw);
    let i = 0;
    const peek = () => tokens[i];
    const isOp = (tok, v) => !!tok && tok.type === "op" && tok.value === v;

    function exponent() {
      let sign = 1;
      if (isOp(peek(), "-") || isOp(peek(), "+")) { sign = peek().value === "-" ? -1 : 1; i++; }
      if (isOp(peek(), "(")) {
        i++;
        let inner = 1;
        if (isOp(peek(), "-")) { inner = -1; i++; }
        const num = peek();
        if (!num || num.type !== "num") throw new Error("Expected a number in the exponent");
        i++;
        let value = num.value;
        if (isOp(peek(), "/")) {
          i++;
          const den = peek();
          if (!den || den.type !== "num" || den.value === 0) throw new Error("Invalid fractional exponent");
          i++;
          value /= den.value;
        }
        if (!isOp(peek(), ")")) throw new Error('Missing ")" in the exponent');
        i++;
        return sign * inner * value;
      }
      const num = peek();
      if (!num || num.type !== "num") throw new Error('Expected a number after "^"');
      i++;
      return sign * num.value;
    }

    function atom() {
      const tok = peek();
      if (!tok) throw new Error("Unit ends unexpectedly");
      if (tok.type === "name") { i++; return lookup(tok.value); }
      if (tok.type === "num") { i++; return make(tok.value, {}); }
      if (isOp(tok, "(")) {
        i++;
        const inner = expr();
        if (!isOp(peek(), ")")) throw new Error('Missing ")"');
        i++;
        return inner;
      }
      throw new Error(`Unexpected "${tok.value}"`);
    }

    function term() {
      const wasName = peek() && peek().type === "name";
      let u = atom();
      if (isOp(peek(), "^")) {
        i++;
        u = pow(u, exponent());
      } else if (wasName) {
        // m2, s-1 written without "^"
        const tok = peek();
        const next = tokens[i + 1];
        if (tok && tok.type === "num") u = pow(u, exponent());
        else if (isOp(tok, "-") && next && next.type === "num") u = pow(u, exponent());
      }
      return u;
    }

    function expr() {
      let u = term();
      for (;;) {
        const tok = peek();
        if (!tok || isOp(tok, ")")) return u;
        if (isOp(tok, "*")) { i++; u = mul(u, term()); }
        else if (isOp(tok, "/")) { i++; u = div(u, term()); }
        else if (tok.type === "name" || tok.type === "num" || isOp(tok, "(")) u = mul(u, term());
        else throw new Error(`Unexpected "${tok.value}"`);
      }
    }

    const result = expr();
    if (i < tokens.length) throw new Error(`Unexpected "${tokens[i].value}"`);
    return result;
  }

  const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };

  function formatExponent(p) {
    if (near(p, 1)) return "";
    for (let den = 1; den <= 12; den++) {
      const num = Math.round(p * den);
      if (near(num / den, p)) return den === 1 ? String(num).replace(/./g, c => SUP[c]) : `^(${num}/${den})`;
    }
    return "^" + p.toPrecision(3);
  }

  // SI base-unit form: kg·m⁻¹·s⁻²
  function format(u) {
    if (!u) return "?";
    const parts = BASE.map((b, i) => [b, u.d[i]]).filter(([, p]) => !near(p, 0));
    if (!parts.length) return "1";
    parts.sort((a, b) => (b[1] > 0) - (a[1] > 0));
    return parts.map(([b, p]) => b + formatExponent(p)).join("·");
  }

  const NAMED = [
    ["N", make(1, { kg: 1, m: 1, s: -2 })], ["Pa", make(1, PA)], ["J", make(1, JOULE)],
    ["W", make(1, { kg: 1, m: 2, s: -3 })], ["C", make(1, { s: 1, A: 1 })], ["V", make(1, { kg: 1, m: 2, s: -3, A: -1 })],
    ["Ω", make(1, { kg: 1, m: 2, s: -3, A: -2 })]
  ];

  // Base form plus a recognised derived unit, e.g. "kg·m⁻¹·s⁻² (Pa)"
  function describe(u) {
    if (!u) return "?";
    const base = format(u);
    if (base === "1") return "1 (dimensionless)";
    const named = NAMED.find(([, n]) => sameDims(n, u));
    return named ? `${base} (${named[0]})` : base;
  }

  return { parse, mul, div, pow, ONE, sameDims, sameScale, isDimensionless, describe };
})();

const UNIT_SUGGESTIONS = [
  "1", "m", "s", "kg", "K", "mol", "A", "cd", "rad",
  "N", "Pa", "J", "W", "Hz", "C", "V", "Ω",
  "m^2", "m^3", "m/s", "m/s^2", "m^2/s", "kg/m^3", "kg/s", "Pa·s",
  "J/kg", "J/(kg·K)", "J/mol", "J/(mol·K)", "W/m^2", "W/(m·K)", "W/(m^2·K)", "W/m^3", "N/m", "1/s"
];

// '' if the unit text is usable (or empty), otherwise the parser's message.
function unitError(text) {
  try { Units.parse(text); return ""; } catch (e) { return e.message; }
}
