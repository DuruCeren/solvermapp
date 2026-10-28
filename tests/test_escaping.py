"""Escaping test: a project whose every text field holds an HTML payload is opened and every tab is
shown; no element from the payload may appear on the page and no handler may run. Guards the
promise in SECURITY.md that text from opened files is escaped before it is shown.

    python tests/test_escaping.py            exit code 1 if anything got through
"""
import json
import sys

from browser import run_in_app

P = '<img src=x onerror="window.__pwned=(window.__pwned||0)+1" class=pwn>'
PROJECT = {
    "equations": [
        {"id": "e1", "name": "N" + P, "author": "A" + P, "year": "1" + P, "eqNumber": "2" + P, "source": "S" + P,
         "latex": "y = a x + b", "outputs": ["y"], "inputs": ["a", "x", "b"], "loopMeta": "", "assumptions": "As" + P,
         "condition": "x < 1" + P, "ioAuto": False, "typeAuto": True},
        {"id": "e2", "name": "Text in LaTeX", "latex": "z = \\text{" + P + "} + y", "outputs": ["z"], "inputs": ["y"],
         "ioAuto": False, "typeAuto": True, "typed": "z = " + P},
    ],
    "variableMeta": {"a": {"initVal": "1" + P, "units": "m" + P, "desc": "D" + P, "codeName": "c" + P, "size": "2" + P},
                     "x": {"initVal": "2", "units": "", "desc": P}, "b": {"initVal": "3", "units": "", "desc": ""}},
    "report": {"title": "T" + P, "author": "Au" + P},
    "indices": "i = 1..N" + P,
}

SCRIPT = """
const o = {};
try {
  localStorage.setItem("solverMapp_tourDone", "1");
  projectData = normalizeProject(__PROJECT__); activeId = "e1"; refreshAll();
  for (const t of ["vault", "vars", "arch", "flow", "code", "report", "guide"]) switchTab(t);
  selectEquation("e2"); switchTab("vault");
  switchTab("report"); setReportView("preview");
  switchTab("flow"); setFlowView("diagram");
  toggleFileMenu();
} catch (e) { o.threw = String(e.stack); }
o.injected = document.querySelectorAll(".pwn").length;
o.ran = window.__pwned || 0;
document.body.insertAdjacentHTML("beforeend", "<pre id='esc'>" + JSON.stringify(o).replace(/</g, "&lt;") + "</pre>");
"""


def main():
    r = run_in_app(SCRIPT.replace("__PROJECT__", json.dumps(PROJECT)), "esc", budget_ms=8000)
    ok = not r.get("threw") and r["injected"] == 0 and r["ran"] == 0
    print(f"elements injected: {r['injected']}, handlers run: {r['ran']}" + (f", page error: {r['threw']}" if r.get("threw") else ""))
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
