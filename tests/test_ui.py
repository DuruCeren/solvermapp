"""Interaction tests: the equation list (selection, clipboard, keyboard, drag and drop, right-click
menu, collapse), the card (type badge, Found row, folded sections, Values table, array grids,
plain math), tabs, Reset / demo, and the first-visit tour. The checks are in ui_checks.js.

    python tests/test_ui.py            exit code 1 if a check fails
"""
import os
import sys

from browser import TESTS, example, run_in_app


def main():
    checks = open(os.path.join(TESTS, "ui_checks.js"), encoding="utf-8").read()
    checks = checks.replace("__TOUR__", example("equation_types_tour.json")).replace("__NBODY__", example("n_body_index_notation.json"))
    # a separate script block, so a mistake in the checks still reports (as a page error)
    script = "window.__log = [];\n" + checks + """
</script>
<script>
window.__log = window.__log || [];
__log.push(["no page errors", !window.__errors.length, window.__errors.join("; ")]);
document.body.insertAdjacentHTML("beforeend", "<pre id='uiOut'>" + JSON.stringify(__log).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>");"""
    log = run_in_app(script, "uiOut")
    failures = 0
    for name, ok, info in log:
        failures += not ok
        print(("PASS  " if ok else "FAIL  ") + name + (f"   [{info}]" if info and not ok else ""))
    print(f"\n{len(log) - failures} passed, {failures} failed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
