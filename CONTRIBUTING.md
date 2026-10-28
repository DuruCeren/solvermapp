# Contributing to SolverMapp

Thank you for helping. Contributions of every size are welcome: a bug report, a model from your field that SolverMapp reads wrongly, a better example, a fix, or a new feature.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a problem

Open an issue with:

- what you typed (the equation, as plain math or LaTeX) and what you expected;
- what happened instead (a screenshot helps);
- ideally the project file: **File -> Export project**, attached to the issue. A project file reproduces the problem exactly.

Questions about how to write a model are welcome too. Please check the [user guide](docs/USER_GUIDE.md) first.

## Setting up

There is nothing to install for the app itself:

```sh
git clone https://github.com/YOUR-GITHUB-USER/solvermapp.git
cd solvermapp
# open index.html in a browser; reload after each change
```

For the tests you need Python 3.9+ and Chrome or Chromium; NumPy for the export test; optionally gfortran and MATLAB. See [tests/README.md](tests/README.md).

## Where things are

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) maps the files and the path from a typed equation to the exported code. [docs/DESIGN_NOTES.md](docs/DESIGN_NOTES.md) explains why things are the way they are. Please read the relevant part before changing behaviour.

## How the code is written

- **No build step and no dependencies.** The app is plain HTML, CSS and JavaScript, loaded as classic scripts (not ES modules, which do not work from `file://`). Please keep it that way.
- **Load order matters for code that runs at load time.** Put start-up code in `js/main.js`. If a new file defines something another file uses at load time, load it earlier in `index.html`.
- **Match the surrounding code**: 2-space indentation, double quotes, `const` / `let`, small named functions, comments that say *why*. Names describe what a thing is (`buildVariableRegistry`,  `needsValue`).
- **Colours** come from the tokens in `css/solvermapp.css` (light and dark), never hard-coded.
- **User-facing text** is short and plain: the app is used by people who are new to it. Prefer one line to a paragraph, and a tooltip to a permanent note.
- **Escape** every piece of user text that goes into HTML (`escapeHtml`), and render math with `renderMath`.
- **Saved projects must keep opening.** A new field gets a default in `normalizeProject` / `normalizeEquation`.

## Tests

Run them before you open a pull request:

```sh
python tests/run_all.py --no-matlab
```

- **Changing the generated code, report or flowchart on purpose:** the snapshot test fails and shows the diff. Check it, run `python tests/test_snapshots.py --update`, and commit the new snapshots  with your change.
- **Adding a feature:** add a check to `tests/ui_checks.js` (interaction) or a project to `tests/export_projects.js` (detection, solving, exported code).
- **Adding a numerical method:** add a check against an exact or independent reference in `tests/test_exports.py`.

## Pull requests

- Keep each pull request to one topic, and explain the *why* in its description.
- Update the docs that describe what you changed (user guide, design notes, architecture) and add a line to the *Unreleased* section of [CHANGELOG.md](CHANGELOG.md).
- For a visible change, add a before / after screenshot.
- When you add or change an example, keep its snapshot in `tests/snapshots/` up to date.

## Adding an example

Examples in `examples/` are what new users open first, so they should be small, correct and documented. Each one should:
- give every equation a title and a source;
- give every variable a unit and a description;
- pass the unit check;
- cite the paper it comes from.

Add a line for it to the table in the README.

## Licence of contributions

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE) of this project.
