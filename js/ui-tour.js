// SolverMapp — The first-visit tour.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// FIRST-VISIT TOUR: a few hints on the real screen, shown the first time the Equations page
// opens (and from the Guide). Steps whose target is not on screen are skipped.
// ================================================================
const LS_TOUR = "solverMapp_tourDone";
const TOUR_STEPS = [
  { target: "#equationList", title: "Your equations", text: "Each card is one equation. Click one to open it. <b>+ New</b> adds one." },
  { target: "#cardLatex", title: "Type the equation", text: "Plain math works: <code>Re = rho*u*D/mu</code>. LaTeX too." },
  { target: "#cardFoundRow", title: "Found for you", text: "What it solves, what it needs, and how." },
  { target: "#eqVarsPanel", title: "Fill the inputs", text: "Type the value and unit of each input. The rest is computed." },
  { target: "#grpGet", title: "Get the results", text: "Plan, flowchart, code and report are made here." }
];
let tour = null; // { k } while the tour runs

function startTour() {
  if (activeTab !== "vault") switchTab("vault");
  if (sidebarPrefs.collapsed) toggleSidebar();
  tour = { k: -1 };
  if (!$("tourSpot")) {
    document.body.insertAdjacentHTML("beforeend",
      `<div id="tourSpot" class="tour-spot" aria-hidden="true"></div>
       <div id="tourTip" class="tour-tip" role="dialog" aria-live="polite" aria-label="Tour"></div>`);
    $("tourTip").addEventListener("click", e => {
      const b = e.target.closest("[data-tour]");
      if (b) tourGo(b.dataset.tour);
    });
  }
  tourGo("next");
}

function endTour() {
  tour = null;
  $("tourSpot")?.remove();
  $("tourTip")?.remove();
  try { localStorage.setItem(LS_TOUR, "1"); } catch (e) { /* shown again next time */ }
}

const tourTarget = k => {
  const el = document.querySelector(TOUR_STEPS[k].target);
  return el && el.offsetParent && el.getBoundingClientRect().height > 0 ? el : null;
};

function tourGo(dir) {
  if (!tour) return;
  if (dir === "skip") return endTour();
  const step = dir === "back" ? -1 : 1;
  let k = tour.k + step;
  while (k >= 0 && k < TOUR_STEPS.length && !tourTarget(k)) k += step;
  if (k >= TOUR_STEPS.length) return endTour();
  if (k < 0) return;
  tour.k = k;
  tourTarget(k).scrollIntoView({ block: "nearest" });
  placeTour();
}

// Spotlight on the target, the hint beside it (right of tall things, else below or above).
function placeTour() {
  if (!tour) return;
  const el = tourTarget(tour.k);
  if (!el) return tourGo("next");
  const r = el.getBoundingClientRect();
  const pad = 6;
  Object.assign($("tourSpot").style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + 2 * pad + "px", height: r.height + 2 * pad + "px" });
  const step = TOUR_STEPS[tour.k];
  const shown = TOUR_STEPS.map((_, k) => k).filter(k => tourTarget(k));
  const n = shown.indexOf(tour.k) + 1;
  const last = n === shown.length;
  const tip = $("tourTip");
  tip.innerHTML = `<div class="tour-count">${n} / ${shown.length}</div>
    <h3>${step.title}</h3><p>${step.text}</p>
    <div class="tour-actions">
      <button class="link-btn" data-tour="skip">Skip</button>
      <span>${n > 1 ? `<button class="btn btn-small btn-quiet" data-tour="back">Back</button>` : ""}
      <button class="btn btn-small btn-primary" data-tour="next">${last ? "Done" : "Next"}</button></span>
    </div>`;
  const w = tip.offsetWidth, h = tip.offsetHeight, gap = 14;
  let left, top;
  if (r.height > innerHeight * 0.45 && r.right + gap + w < innerWidth) { left = r.right + gap; top = r.top + 20; }
  else if (r.bottom + gap + h < innerHeight) { left = r.left; top = r.bottom + gap; }
  else { left = r.left; top = r.top - gap - h; }
  tip.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + "px";
  tip.style.top = Math.max(8, Math.min(top, innerHeight - h - 8)) + "px";
}

function bindTour() {
  window.addEventListener("resize", placeTour);
  document.addEventListener("scroll", () => tour && placeTour(), true);
  document.addEventListener("keydown", e => {
    if (!tour) return;
    if (e.key === "Escape") { e.preventDefault(); endTour(); }
    else if (e.key === "ArrowRight" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) { e.preventDefault(); tourGo("next"); }
    else if (e.key === "ArrowLeft" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) { e.preventDefault(); tourGo("back"); }
  });
}

// The first time the Equations page opens, the tour starts by itself.
function maybeStartTour() {
  let done = false;
  try { done = !!localStorage.getItem(LS_TOUR); } catch (e) { done = true; }
  if (!done && !tour) setTimeout(() => { if (activeTab === "vault" && !tour) startTour(); }, 60);
}
