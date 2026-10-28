# Tests

The tests load the real app (`index.html`) in headless Chrome and drive it with scripts.

| Test | Checks |
| --- | --- |
| `test_ui.py` | Interaction, about 65 checks: the equation list (numbering, selection, copy / cut / paste, drag and drop, right-click menu, keyboard), the card (type badge, Found row, folded sections, Values table), array grids, plain math input, tabs, New project / demo, the tour. The checks are in `ui_checks.js`. |
| `test_escaping.py` | A project with an HTML payload in every text field: nothing from it may reach the page. |
| `test_snapshots.py` | For every project in `examples/`: the generated Python, MATLAB and Fortran, the LaTeX report and the flowchart (TikZ, Mermaid) must equal `snapshots/<example>/`. |
| `test_exports.py` | Test projects (`export_projects.js`) are exported and run in Python, gfortran and MATLAB. Every variable must equal the browser's own run, trajectory CSV files must match between languages, and results are checked against exact references (cooling law, rotation, Euler decay, Hilbert system and products by NumPy, species network by the matrix exponential, indexed N-body = written-out three-body). |

## Running

```sh
python tests/run_all.py                # everything
python tests/run_all.py --no-matlab    # everything except the MATLAB runs
python tests/test_ui.py                # one test
```

Each test exits with code 1 on a failure.

## Requirements

| Needed for | What |
| --- | --- |
| all tests | Python 3.9+ and Chrome or Chromium. Chrome is found from the `CHROME` environment variable, the usual install folders or the `PATH`. |
| `test_exports.py` | NumPy (`pip install numpy`). gfortran and MATLAB are used when found, otherwise skipped (and reported). |

## When a snapshot test fails

A changed snapshot is not always a bug. If you changed the generated code, report or flowchart on
purpose:

1. Read the diff that `test_snapshots.py` prints.
2. Run `python tests/test_snapshots.py --update`.
3. Commit the new snapshots with your change, so reviewers see what changed in the output.

Generated files from `test_exports.py` go to `tests/.out/`, which is not committed.
