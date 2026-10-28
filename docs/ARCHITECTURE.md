# Architecture

SolverMapp is a static web page: HTML, one stylesheet and plain JavaScript files. There is no build
step, no framework and no server. KaTeX (math display) is the only dependency and is loaded from a
CDN. The page opens straight from disk (`file://`) as well as from a web server such as GitHub Pages.

## Why plain scripts, in several files

- **Several files** so the code can be read, reviewed and changed one part at a time, with diffs
  that make sense.
- **Classic scripts** (`<script src>`), not ES modules, because browsers block modules on `file://`.
  Keeping double-click-to-open matters for an academic tool used offline and in teaching.

The consequences:
- Every file shares one global scope: a top-level `function` or `const` in one file is visible in
  the others.
- **Load order matters for code that runs at load time.** Functions may call functions from any
  file, because by the time they run every file is loaded. But a top-level statement (e.g.
  `let projectData = loadProject();`) can only use what earlier files defined.
- Start-up code (binding events, the first render) lives in `main.js`, which loads last.
- Inline handlers in `index.html` (`onclick="switchTab('vault')"`) call these global functions.

## Files, in load order

| File | Contents |
| --- | --- |
| `js/demo.js` | The built-in demo project as data (`defaultData`). |
| `js/state.js` | Storage keys, theme, project defaults and `normalizeProject`, loading, auto-save, undo. |
| `js/plain-math.js` | Plain math → LaTeX (`PlainMath`, `typedToLatex`). |
| `js/detect.js` | Reading an equation: symbols, step suffixes, sums, integrals, ODEs (first and second order), functions, implicit unknowns; `detectFromLatex` gives type, outputs, inputs. |
| `js/registry.js` | `buildVariableRegistry`: every symbol with its role, size, code name, where it is used. |
| `js/latex-symbols.js` | `Latex`: symbol reader used by the unit check. |
| `js/units.js` | `Units`: unit parsing and SI dimensions. |
| `js/unit-check.js` | `UnitCheck`, `unitCheckResult`: dimensional consistency of an equation. |
| `js/plan.js` | Dependency analysis (Tarjan SCC, topological order) and `analyzeSolverArchitecture`: steps, switches, ODE systems, coupled blocks. |
| `js/latex-to-code.js` | `latexToCode`: LaTeX → neutral code (products, fractions, functions, vectors, index notation, sums). |
| `js/codegen.js` | `generatePythonCode`, `generateMatlabCode`, `generateFortranCode`. |
| `js/evaluate.js` | `Expr`, the expression engine: parses neutral code with scalar / vector / matrix shapes, emits Python, MATLAB and Fortran, and evaluates in the browser. `simulateModel` (the model run) and `analyzeRoots` (root plot of implicit equations). |
| `js/ui-common.js` | `$`, chips, `renderMath` (with the fallback when KaTeX cannot load), badges. |
| `js/ui-list.js` | Equation list: numbering, selection, collapse and resize, drag and drop, right-click and File menus, shortcuts, clipboard, list actions. |
| `js/ui-card.js` | Equation card: fields, Found row, folded sections, unit check panel, root plot, templates, Values table. |
| `js/ui-variables.js` | Variables tab, array grid editor. |
| `js/ui-plan.js` | Plan tab: order of solution, dependency graph (layered layout, zoom, tracing). |
| `js/ui-code.js` | Code tab. |
| `js/ui-report.js` | Report tab: `buildReportModel`, `writeReportLatex`, HTML preview, BibTeX. |
| `js/ui-flowchart.js` | Flowchart tab: `buildFlowchart`, layout, SVG / PNG, TikZ, Mermaid. |
| `js/ui-files.js` | Import and export of projects and cards. |
| `js/ui-tour.js` | First-visit tour. |
| `js/main.js` | `switchTab`, `refreshAll`, and start-up. Loads last. |

`css/solvermapp.css` holds all styles. Colours are tokens on `:root` (light) and
`[data-theme="dark"]`, so components do not hard-code colours.

## From a typed equation to code

```
typed text ──PlainMath──▶ LaTeX ──detectFromLatex──▶ type, outputs, inputs        (per equation)
                                      │
all equations + variableMeta ──buildVariableRegistry──▶ roles, sizes, code names (whole project)
                                      │
                         analyzeSolverArchitecture ──▶ ordered steps: equations, switches,
                                      │                ODE systems, coupled blocks
                                      ▼
            latexToCode ──▶ neutral code ──Expr──▶ Python / MATLAB / Fortran expressions
                                      │
         generate{Python,Matlab,Fortran}Code ──▶ solver with loops, Newton, RK4, CSV output
```

The same plan feeds the report (`buildReportModel`), whose algorithm model also drives the
flowchart. That is why the code, the pseudocode in the report and the flowchart always agree.
`simulateModel` evaluates the same neutral code in the browser. The root plot of implicit equations
uses it, and so does `tests/test_exports.py`, which checks the exported solvers against it.

## Data format

A project is plain JSON (File → Export project):

```jsonc
{
  "equations": [{
    "id": "eq_1", "name": "Velocities",
    "author": "", "year": "", "eqNumber": "", "source": "",  // the source article
    "latex": "\\frac{d\\mathbf{v}_i}{dt} = ...",              // what everything works with
    "typed": "…",                // optional: plain math as typed, when it differs from latex
    "archetype": "ode",          // found from the notation
    "outputs": ["\\mathbf{v}"], "inputs": ["G", "m", "\\mathbf{r}", "t"],
    "loopMeta": "t = 0..6.3, steps = 2000, method = rk4",   // Settings
    "condition": "",             // Applies when
    "assumptions": "",
    "ioAuto": true,              // outputs / inputs follow the equation
    "typeAuto": true,            // Settings are still the detected defaults
    "unitCheck": true
  }],
  "variableMeta": { "\\mathbf{r}": { "initVal": "…", "units": "m", "size": "N x 2", "codeName": "", "desc": "" } },
  "indices": "i, j = 1..N",
  "report": { /* Report tab options */ },
  "flowchart": { "numbers": true, "titles": true }
}
```

`normalizeProject` fills in missing fields, so older files keep opening. When you add a field,
give it a default there.

## Browser storage

| Key | Holds |
| --- | --- |
| `solverMapp_v06` | the current project |
| `solverMapp_active` | the open equation |
| `solverMapp_theme`, `solverMapp_sidebar` | appearance |
| `solverMapp_tourDone` | the tour has been seen |

Keys from the earlier name (`solverBlueprint_*`) are copied over once at start.

## Tests

See [tests/README.md](../tests/README.md). The snapshot test pins the generated code, report and
flowchart of every example. The export test runs the solvers in three languages against the browser
and against exact references.
