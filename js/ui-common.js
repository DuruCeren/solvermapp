// SolverMapp — Shared UI helpers: chips, math rendering (with the offline fallback), badges.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

const $ = id => document.getElementById(id);

// ================================================================
// SHARED UI HELPERS
// ================================================================
// Equation types are shown neutrally (symbol + word) so colour stays reserved for variable roles.
const ARCHETYPE_BADGES = {
  explicit:    { label: "Explicit",         symbol: "=" },
  marching:    { label: "Marching loop",    symbol: "↻" },
  convergence: { label: "Convergence loop", symbol: "◎" },
  summation:   { label: "Summation",        symbol: "Σ" },
  integral:    { label: "Integral",         symbol: "∫" },
  implicit:    { label: "Implicit",         symbol: "⊘" },
  ode:         { label: "ODE",              symbol: "ẏ" },
  function:    { label: "Function",         symbol: "ƒ" }
};

function typeChip(arch) {
  const ab = ARCHETYPE_BADGES[arch || "explicit"];
  return `<span class="chip chip-type">${ab.symbol} ${ab.label}</span>`;
}

function roleChip(sym, role, extra = "") {
  return `<span class="chip ${ROLE_UI[role].cls}" title="${ROLE_UI[role].label}">${renderMath(sym)}${extra}</span>`;
}

// ---------- Math display ----------
// KaTeX comes from a CDN. Without it (offline, blocked) the LaTeX source is shown in neutral
// text and a notice explains why; red is kept for real errors. KaTeX can also arrive later
// (Try again, or the connection comes back), and then everything is drawn again.
const KATEX_SRC = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min";
let mathOk = checkMath(); // decided now: the stylesheet and script in <head> have loaded or failed

// KaTeX needs both its script and its stylesheet: without the CSS each formula appears twice.
function checkMath() {
  if (typeof katex === "undefined") return false;
  const probe = document.createElement("span");
  probe.className = "katex";
  probe.innerHTML = '<span class="katex-mathml">x</span>';
  probe.style.cssText = "position:absolute;visibility:hidden";
  document.body.appendChild(probe);
  const styled = getComputedStyle(probe.firstChild).position === "absolute";
  probe.remove();
  return styled;
}

// displayMode only when exactly true: renderMath is also passed to .map(), which adds an index.
function renderMath(latexString, displayMode) {
  if (!mathOk) return `<span class="math-raw">${escapeHtml(latexString)}</span>`;
  try { return katex.renderToString(latexString, { throwOnError: false, displayMode: displayMode === true }); }
  catch (e) { return `<span class="mono" style="color:var(--danger)" title="This LaTeX could not be read">${escapeHtml(latexString)}</span>`; }
}

function renderStaticMath() {
  document.querySelectorAll("#viewGuide [data-tex]").forEach(el => { el.innerHTML = renderMath(el.dataset.tex); });
}

let mathNoticeDismissed = false;
function showMathState() {
  $("mathNotice").hidden = mathOk || mathNoticeDismissed;
}

function dismissMathNotice() {
  mathNoticeDismissed = true;
  showMathState();
}

let mathLoading = null;
function loadMath() {
  if (mathOk) return Promise.resolve(true);
  if (mathLoading) return mathLoading;
  const bust = "?retry=" + Date.now(); // a failed request is not reused from the cache
  const css = new Promise(res => {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = KATEX_SRC + ".css" + bust;
    l.onload = () => res(true); l.onerror = () => { l.remove(); res(false); };
    document.head.appendChild(l);
  });
  const js = typeof katex !== "undefined" ? Promise.resolve(true) : new Promise(res => {
    const sc = document.createElement("script");
    sc.src = KATEX_SRC + ".js" + bust;
    sc.onload = () => res(true); sc.onerror = () => { sc.remove(); res(false); };
    document.head.appendChild(sc);
  });
  mathLoading = Promise.all([css, js]).then(() => {
    mathLoading = null;
    mathOk = checkMath();
    if (mathOk) {
      renderStaticMath();
      refreshAll();
      renderGraphLegend();
    }
    showMathState();
    return mathOk;
  });
  return mathLoading;
}

function retryMath() {
  const btn = $("mathRetryBtn");
  btn.disabled = true; btn.textContent = "Loading…";
  loadMath().then(ok => {
    btn.disabled = false; btn.textContent = "Try again";
    if (ok) notify("Math display loaded.");
    else $("mathNoticeText").textContent = "Still could not load the math display (KaTeX). Check the connection and try again; everything else works.";
  });
}

function articleFlag(eq) {
  return [eq.author.trim(), eq.year.trim() && `(${eq.year.trim()})`].filter(Boolean).join(" ");
}

function cleanEqNumber(eq) {
  return eq.eqNumber.trim().replace(/^\((.*)\)$/, "$1");
}

// Fits a textarea to its text. A hidden one (card filled while another tab is shown) can't be
// measured, so it is sized when the Equations tab is shown again (switchTab → growCardFields).
function autoGrow(el) {
  if (!el.offsetParent) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + 2 + "px";
}
