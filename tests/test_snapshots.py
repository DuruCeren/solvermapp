"""Snapshot tests: for every project in examples/, the generated solver (Python, MATLAB, Fortran),
the LaTeX report and the flowchart (TikZ, Mermaid) must equal the files in tests/snapshots/.

    python tests/test_snapshots.py            compare; exit code 1 on a difference
    python tests/test_snapshots.py --update   accept the current output as the new snapshots

A difference is not always a bug: when you change the generated output on purpose, review the
diff, run with --update and commit the new snapshots with your change.
"""
import difflib
import glob
import json
import os
import sys

from browser import REPO, TESTS, run_in_app

FILES = {"python": "solver.py", "matlab": "solver.m", "fortran": "solver.f90",
         "report": "report.tex", "tikz": "flowchart.tex", "mermaid": "flowchart.mmd"}

SCRIPT = """
const S = { projects: {} };
try {
  localStorage.setItem("solverMapp_tourDone", "1");
  for (const [name, p] of Object.entries(__PROJECTS__)) {
    const r = {};
    projectData = normalizeProject(JSON.parse(JSON.stringify(p)));
    activeId = projectData.equations[0].id;
    refreshAll();
    switchTab("code");
    for (const lang of ["python", "matlab", "fortran"]) { selectExportLang(lang); r[lang] = $("codeOutputBox").textContent; }
    switchTab("report"); setReportView("source"); r.report = $("reportSource").textContent;
    switchTab("flow"); setFlowView("tikz"); r.tikz = $("flowSource").textContent;
    setFlowView("mermaid"); r.mermaid = $("flowSource").textContent;
    S.projects[name] = r;
  }
} catch (e) { S.threw = e.stack; }
S.errors = window.__errors;
document.body.insertAdjacentHTML("beforeend", "<pre id='snap'>" + JSON.stringify(S).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>");
"""


def main():
    update = "--update" in sys.argv
    projects = {os.path.splitext(os.path.basename(f))[0]: json.load(open(f, encoding="utf-8"))
                for f in sorted(glob.glob(os.path.join(REPO, "examples", "*.json")))}
    result = run_in_app(SCRIPT.replace("__PROJECTS__", json.dumps(projects)), "snap")
    if result.get("threw") or result.get("errors"):
        sys.exit(f"The page failed: {result.get('threw') or result.get('errors')}")
    changed = 0
    for name, outputs in result["projects"].items():
        folder = os.path.join(TESTS, "snapshots", name)
        os.makedirs(folder, exist_ok=True)
        for key, file in FILES.items():
            path = os.path.join(folder, file)
            new = outputs[key].replace("\r\n", "\n")
            old = open(path, encoding="utf-8", newline="").read().replace("\r\n", "\n") if os.path.exists(path) else None
            if update:
                if new != old:
                    open(path, "w", encoding="utf-8", newline="\n").write(new)
                    print(f"updated  {name}/{file}")
                continue
            if old is None:
                changed += 1
                print(f"MISSING  {name}/{file}  (run with --update to create it)")
            elif new != old:
                changed += 1
                print(f"CHANGED  {name}/{file}")
                diff = difflib.unified_diff(old.splitlines(), new.splitlines(), "snapshot", "now", lineterm="", n=1)
                print("\n".join(list(diff)[:40]))
            else:
                print(f"same     {name}/{file}")
    if not update:
        print(f"\n{len(result['projects']) * len(FILES) - changed} same, {changed} different")
        sys.exit(1 if changed else 0)


if __name__ == "__main__":
    main()
