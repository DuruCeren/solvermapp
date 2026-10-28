# Design notes

Decisions behind SolverMapp and their reasons, roughly in the order the features were built. For how
the code is laid out, see [ARCHITECTURE.md](ARCHITECTURE.md); for what it does, the
[README](../README.md) and the [user guide](USER_GUIDE.md).

## Intention

SolverMapp (first called SolverBlueprint) is a browser-based **engineering mapping tool**: an
engineer collects the equations of a model, usually from papers, and the tool maps how they connect
so that a numerical solver can be written from them, and documented.

The workflow has one rule for a new user: **you enter** equations and values, **you get**
everything else (plan, flowchart, code, report). The app opens on the **Guide**, which says
exactly that, with a cheatsheet folded below.

## Built-in demo and logo

- **Demo** (built in, `defaultData`, also the project of a first start): the N-body problem in
  index notation with N = 3 (figure-eight orbit), the same as `n_body_index_notation.json`: three
  equations (positions, velocities, energy) whatever N is. The written-out three-body version is
  `three_body_figure_eight.json`. "See an example" on the Guide opens it on the
  Equations tab.
- **Logo**: −sin drawn as a curve makes the S (continuous); five samples of the same −sin
  (1, 0, −1, 0, 1) drawn as stems make the M (discrete): from the continuous model to the discrete
  solver. Inline SVG in `currentColor` (follows the theme), also the tab icon (SVG data URI).

## Decisions

### Plain scripts, several files, no build step
The app began as one self-contained `index.html`. For the open-source release it was split into
`index.html`, `css/solvermapp.css` and plain scripts in `js/`, one per part, so the code can be
read and reviewed. The split is mechanical: the generated code, report and flowchart of every
example were byte-identical before and after it (now pinned by `tests/test_snapshots.py`).
Classic scripts (not ES modules) keep the page working from `file://`. Code ported from an earlier
modular prototype (`Latex`, `Units`, `UnitCheck`) stays wrapped in IIFEs so its internal helper
names don't clash with the app's. See [ARCHITECTURE.md](ARCHITECTURE.md).

### Dependency graph (ported from an earlier prototype)
- **Replaces the Mermaid flowchart**; Mermaid is no longer loaded.
- **Ordering uses strongly connected components** (Tarjan) + topological sort (Kahn) instead of the
  old "known variables" loop. Equations in a cycle become one *coupled block* instead of being
  reported as "could not place". Each step of the solver plan is one block.
- The old planner treated state variables as known at the start, so an equation that *used* a state
  variable could be ordered before the equation that *updates* it. The new ordering always runs the
  producer first (self-dependencies, e.g. `y_{n+1} = y_n + 1`, are ignored as edges).
- Layout: layered, **top → bottom** (like the old Mermaid `flowchart TD`), no library. Equations sit
  in layers by dependency level; variables sit just below the equation that computes them (inputs
  just above first use). Barycenter sweeps reduce crossings. Nodes are HTML (KaTeX renders inside),
  edges are SVG.
- Legibility: the graph opens at 100% (no auto-shrink) with large nodes; Fit/zoom are manual.
  An edge that skips layers gets a waypoint in each layer it crosses, so it is routed between nodes,
  never through them. Each node side spreads its edges over separate ports.
- Loops (dashed): a state variable fed back into its equation, or coupled equations. A loop leaves
  the variable at the top and enters the equation at the bottom, as a curve whose ports sit right of
  the forward arrow between the same two nodes, so the pair never crosses. A loop spanning several
  layers (rare) goes through the gaps between layers and up its own lane on the right.
- Node colours use the app's **existing four role colours** (input / state / intermediate / output),
  not the example's three kinds, so the graph matches the variables table.
- Interaction kept from the example: click a node to trace upstream/downstream lineage, double-click
  (or "Open") an equation to edit it, zoom −/+/100%/Fit. Inputs are always shown (the example's
  show/hide toggle was removed).
- The example's `LoopFinder` was **not** ported: the app already classifies loops by equation type
  (marching, convergence, summation, integral); those types are shown as tags on graph nodes.

### Code export (Python / MATLAB / Fortran)
Verified by running all three on test projects (Python, MATLAB R2024a, gfortran): same numbers.
- **One plan per equation** (`equationPlan`): type, output, loop settings, sum range, integral
  bounds; each language only writes it out, so the three stay consistent.
- **Loop settings come from the card** (`N_steps = 100`, `tol = 1e-6, max_iter = 500`,
  `n_quad = 200`); a count may be a variable (`N_steps = N`). Defaults: 100 steps, 1e-6 / 500,
  100 intervals.
- **Integrals**: trapezoidal rule over n intervals, with the integration variable (the x of `dx`)
  defined at each node, so integrands that use x work.
- **Convergence loops and coupled blocks warn when they don't converge** (Python `for … else`,
  MATLAB `converged` flag, Fortran `it > max_iter`). Coupled blocks: fixed-point iteration with a
  convergence test on the block's outputs in all three languages; starting guesses from *Start*.
- **Sums over indexed inputs**: an input whose subscript is the sum index (`f_i` in
  `\sum_{i=1}^{N} f_i`) becomes an array over the sum's range. *Start* can be a list (`1, 2, 3`)
  or one value for all elements. Python indexes from 0, MATLAB from 1, Fortran allocates `lo:hi`.
- **Fortran**: double-precision literals (`0.02_dp`), declarations only for what is used, long
  lines continued, results printed. Fortran ignores case, so `T` and `t` clash: the export note and
  the variables table ("To check") say so; renaming is left to the user (Code name column).
- MATLAB prints results with `mat2str`. Code comments use the readable role names.
- The LaTeX table left Export; LaTeX is now its own Report tab.

### Implicit equations (root finding)
- **New type `implicit`** (⊘). Detected when a left-side symbol also appears on the right
  (`x = \cos x`, Colebrook), when the left side is an expression rather than one symbol
  (`(p + a/v^2)(v - b) = R_u T_g`, `x^3 - 2x + c = 0`), or when the left side is a number
  (`0 = …`). The unknown is the symbol on both sides, else the most frequent one; it is the
  only output, everything else is an input. `x_1 = 2`, `E = m c^2` stay explicit.
- **Solved on the residual** R = left side − right side (`residualCode`). Method: Newton–Raphson
  (`method = newton`, the default and for now the only one; `ROOT_METHODS` is where others go).
  Derivative by central difference, h = 1e-6·max(|x|, 1e-6). Converged when
  |Δx| < tol·(1 + |x|). Defaults: tol = 1e-10, max_iter = 50.
- **Initial guess**: `guess = …` in the loop settings, else the unknown's Start value (the Start
  cell of an implicit unknown is therefore active, not dimmed). Inside a coupled block it starts
  from the previous pass.
- **Branch selection**: `min` / `max` keep the iteration on one branch: a step that would leave
  [min, max] is halved back towards the bound (safeguarded Newton), and the guess is clamped first.
  guess / min / max may be numbers, variables or LaTeX expressions (`min = b`,
  `guess = R_u T_g / p`).
- **Export**: Python nested `def res_x(x)`, MATLAB anonymous function, Fortran internal function
  after `contains` (host association gives it the program's variables). Same iteration in all
  three; warnings for zero derivative and no convergence. Verified with Python, MATLAB R2024a and
  gfortran (`-Wall` clean): identical results, and identical to the browser.
- **Root analysis on the card** (implicit only): the model is run in the browser up to that
  equation (`simulateModel`, evaluating the Python-syntax expressions with `CodeExpr`; capped at
  300k evaluations), so the inputs have the values they will have there. Then:
  roots of R on the whole real line (sign changes on a ±1e-12…1e12 log grid plus a linear grid
  around the guess, bisection, poles dropped); a plot of R (symmetric-log scale) with numbered
  roots, guess and out-of-branch shading; a **guess map** (which root Newton reaches from each
  starting point across the plot); the root reached from the current guess; and a sensitivity test
  (±10 % on the guess must reach the same root). States: one root (ok), several roots on the branch
  or guess-sensitive (warn), no convergence (error). **"Use this root"** sets guess = root and
  min / max halfway to the neighbouring roots; a limit written as an expression (`min = b`) is
  kept as a physical limit.
- Report: sentence on the method, guess and branch; pseudocode `\Repeat` with the Newton step;
  flowchart: guess → Newton step → "step < tol ?" loop.
- LaTeX → code is now brace-aware (`texGroupsToCode`): nested `\frac`/`\sqrt`, `\sqrt[n]{}`,
  `x^{a+b}` → `x**(a + b)`, `\log_{10}` → `log10`, `)(` and `2(` as products, `\cos x` → `cos(x)`.
  Output for the old simple cases is unchanged.
- Vector unknown: multivariate Newton with a central-difference Jacobian (min / max ignored).
  Linear in a vector unknown (`K u = F`, residual `A x - b` with A free of x): solved directly
  (`np.linalg.solve`, MATLAB `\`, Fortran `solve`), no iteration.

### Symbols (detection)
- Symbols are read with the `Latex` module (`latexSymbols`), not a regex: `\dot{m}`, `\mathbf{x}`,
  `\mathrm{Re}`, `T^{n+1}`, `\Delta x` are one symbol each, and the `d` of `dx` / `\frac{dy}{dt}`
  is not a symbol (this fixed the old "`d` as an input" bug). `A^T` on a vector/matrix is a
  transpose, so `T` is not picked up.
- A symbol keeps the spelling the project already uses (`preferredSpelling`: `T_\infty` vs
  `T_{\infty}`), so re-detecting never loses its unit, start value or description. Code conversion
  normalizes subscripts on both sides (`normalizeSubscripts`).
- Marching needs a step suffix on the left (`y_{n+1} = y_n + 1`); `F = F_0 \sin(\omega t)` is explicit.
- Implicit also when the left side is a product of several symbols (`K u = F`, `P V = n R T`);
  on a tie in occurrences the last factor is the unknown (u, x in `A x = b`).
- Code names: `\mathbf{u}` → `u`, `\dot{m}` → `m_dot`, `\hat{x}` → `x_hat`.

### Conditions and switches ("Applies when")
- New equation field `condition` (LaTeX): `R_e < 2300`, `2300 \le R_e < 4000` (chains),
  `\land` / `\lor` / `\lnot` (or and / or / not), `\le \ge \ne`; `otherwise` (or `\text{otherwise}`)
  or empty = the else case.
- Equations with the same (first) output where at least one has a condition form one **switch**
  node in the dependency analysis (`dependencyNodes`): its inputs are all members' inputs plus the
  condition's symbols. Cases are tried in card order, conditional ones first, `otherwise` last.
  Each case keeps its own type, e.g. laminar `f = 64/Re` (explicit) and Colebrook (implicit).
- Export: `if / elif / else` (MATLAB `if/elseif/else/end`, Fortran `if (...) then / else if`).
  No `otherwise` case: a warning and the start value. Conditions are written through `Expr`
  (`and`/`&&`/`.and.`, `!=`/`~=`/`/=`, chains expanded to `and`).
- Duplicate-output warnings are not raised for switch members.

### Independent / dependent variables
- **Function definition** (type `function`): `\mu(T) = \mu_0 \exp(...)` (whole left side
  `symbol(args)`). Exported as a function: Python nested `def mu(T)`, MATLAB `mu = @(T) ...`,
  Fortran internal function after `contains` (host association gives it the program's
  variables). The definition card's inputs exclude its arguments.
- Using it: `\mu(T)` becomes `mu(T)`; a bare `\mu` becomes `mu(T)` with the declared arguments.
- An input written as `\mu(T)` that no equation computes is exported as a stub function returning
  its Start value (TODO comment; the report says so).
- **ODE** (type `ode`): `\frac{dy}{dt} = f(...)` (also `\mathrm{d}`); y is a state (Start = initial
  value) and is shown as y(t); t is the independent variable (tagged "indep.", not set in stage 0).
  Writing `y(t)` in an equation means the value y. Second-order ODEs are rewritten as two
  first-order ones (see "Recent additions").
- Displayed as `displaySymbol(v)`: μ(T), y(t) in the table, graph and chips.

### ODE integration (RK4 by default)
- Settings: `t = 0..10, steps = 100, method = rk4` (bounds may be variables or LaTeX); `euler` also.
- An ODE "provides" its independent variable: equations that use t get an edge from the ODE.
  So ODEs that depend on each other, and algebraic equations they need inside each stage
  (`q = h A (T - T_\infty)`, `F = F_0 \sin(\omega t)`), end up in one strongly connected
  component → one **ODE system** unit: the algebraic equations (in dependency order, ODE edges
  ignored) are evaluated at every stage, then all rates; the algebraic equations are evaluated
  once more at the final time. ODEs with no coupling are each their own system.
- One stage loop in all three languages, no derivative function: per state `y_rk0`, `y_rate`,
  `y_acc`; weights 1, 2, 2, 1 and nodes ½, ½, 1; `y = y_rk0 + h/6 · y_acc`. Works the same for
  scalar and vector states.
- Checked: cooling vs the analytic solution (rel. error 1e-11), rotation `dy/dt = M y` vs
  (cos t, −sin t), Euler vs its exact discrete solution.
- **Trajectory output**: setting `save = k` writes `ode_system_<n>.csv` (header `t,r_1[1],r_1[2],…`,
  vectors and matrices flattened row by row) at the start and every k steps, from every language
  (Python `ode_row` helper, MATLAB `fprintf`, Fortran `write(u, '(*(g0.17, :, ","))')`). Off by
  default. The three languages write the same values.
- **Three-body problem** (`examples/three_body_figure_eight.json`): six 2-D vector ODEs
  `d r_i/dt = v_i`, `d v_i/dt = Σ G m_j (r_j − r_i)/‖r_j − r_i‖³` and the total energy; one 12-state
  RK4 system. Figure-eight orbit (Chenciner & Montgomery 2000), 2000 steps over one period: the
  bodies return to their start within 4e-8, energy drift 8e-12; Python, MATLAB, Fortran and the
  browser agree on every value and on the CSV trajectory. Written out per body here; the general
  N-body form, a sum over j ≠ i, is written with index notation (below).
- Fortran keeps integer exponents as integers (`norm2(d)**3`, not `**3.0_dp`).

### Vectors and matrices
- Size column in the Variables table: empty = scalar, `n` / `N` = vector, `n x m` = matrix
  (numbers or variables). Start: `1, 2, 3`, rows `1, 2; 3, 4`, `I` (identity) or one value for all.
  Bold/arrow symbols without a size are flagged in **To check**.
- `latexToCode` writes neutral code with markers: `·` (\cdot), `×` (\times), `⊙` (\odot),
  `ᵀ` (transpose: `^\top` always, `^T` when the base is a vector/matrix or T is not a variable),
  `norm(x)` for `\|x\|`, `abs(x)` for `|x|`. Scalar expressions are written as before
  (`toScalarCode`), so scalar projects export byte-identical code.
- `Expr` (replaces `CodeExpr`) parses that code into a tree with shapes (rank 0/1/2, row/column)
  and writes it per language: juxtaposition = matrix product (`@`, `*`, `matmul`), vector·vector =
  dot (`np.dot`, `dot`, `dot_product`), column·row = outer, `×` = cross, `⊙` = element-wise,
  `A^{-1} b` = solve, `A^{-1}` = inverse, `v^2` = v·v. Python imports numpy only when needed.
  Fortran: allocatable arrays (auto-allocation on assignment) and helper routines after
  `contains` when used: `solve` (Gaussian elimination, partial pivoting), `inv`, `cross3`, `eye`,
  `matpow`. MATLAB vectors are columns.
- The browser evaluates the same trees with real linear algebra (`Expr.evaluate`), so the model
  run (`simulateModel`), root panel and checks work with vectors too.

### Index notation
- Declared once per project in the **Indices** field of the Variables tab:
  `i, j = 1..N; k = 1..M` (`projectData.indices`; bounds may be numbers or variables, which become
  inputs). Changing it re-runs automatic detection. Without a declaration nothing changes.
- On a symbol, a subscript made of declared indices is an element: `m_i`, `k_{ij}`, `x_{i+1}`,
  `H_{j1}` (index j, column 1); on a matrix with one index it is a row (`\mathbf{r}_i` of an N x 2
  array = body i). At least one index letter is needed, so `m_1` stays its own name. The index
  letters are not variables. Detection reads `m_i` as the array `m` (`latexSymbols` → `indexed`).
- Sizes: an array used with indices and no Size gets one dimension per index range (`m_i` → N,
  `k_{ij}` → N x N). A bold symbol with an index (a vector per index) must have its Size (`N x 2`);
  **To check** flags it.
- A free index on the left (`x_{ij} = …`, `\frac{d\mathbf{v}_i}{dt} = …`) means the equation holds
  for every value: exported as loops (`assignLines`: Python 1-based loops with `x[i - 1]`, MATLAB
  `x(i, :) = (…).'` for rows, Fortran `x(i, :)`), the array created first. ODE rates of indexed
  states are filled the same way inside the RK4 stages, so the whole array is one state.
- Sums: `\sum_j` (whole range), `\sum_{j=1}^{i}`, `\sum_{j \ne i}`, `\sum_{j<i}`, `\sum_{i<j}` (both free:
  all pairs). A sum covers the term after it, up to the next + or −; nest with parentheses.
  Neutral code `isum(j, lo, hi, cond, body)` and `at(x, i, j)` (`indexNotationPass`, `sumLoops`).
  Python: generator `sum(… for j in range(lo, hi + 1) if j != i)`; MATLAB / Fortran: accumulator
  loops written before the statement (`s_sum1`; Fortran starts vector sums with a zero of the
  right size, so the summed variables need known sizes). Fortran converts an index used as a number
  (`real(i, dp)`, no integer division in `1/(i + j - 1)`).
- Index values in formulas work (`H_{ij} = \frac{1}{i + j - 1}`). Sums are supported in explicit
  equations and ODE right-hand sides (not inside an implicit residual or a marching update yet).
- Unit check: index subscripts are dropped (`m_j` has the unit of m), index letters are
  dimensionless.
- Start values are written scalars first (an array's size can depend on N).
- CSV trajectories: the header is written at run time (`t, r[1], …, r[6]`, rows flattened), so it
  also fits sizes given by a variable.
- Checked (`examples/*index_notation.json`): N-body (2 equations + energy with `\sum_{i<j}`) equals
  the written-out three-body project to 2e-16; Hilbert matrix, row sums, H x = b (x = 1), products,
  trace and partial sums equal numpy; the species network `dc_i/dt = \sum_j K_{ij} c_j` equals the
  matrix exponential to 1e-10 and conserves the total. Python, MATLAB and Fortran agree with the
  browser on every value and on the CSV files.

### Verification
- Four test projects (pipe switch + μ(T), two ODE systems, vectors/matrices, piecewise/Euler/stub)
  typed as LaTeX and detected like on the card; Python, MATLAB R2024a and gfortran (`-Wall`, no
  warnings) give the same values as the browser for every variable.
- The original demo exports are unchanged except the Python header line.
- Fortran ignores case: `T` (temperature) and `t` (time) clash; give one a code name (the
  examples use `time`). The **To check** filter flags it.

### Enter / Get: the simplified interface
- One rule for a new user: **you enter** equations and values, **you get** everything else.
  The top bar groups the tabs that way: Guide · ENTER Equations, Variables · GET Plan, Flowchart,
  Code, Report. Get pages carry a "Generated" tag; their descriptions are one line.
- **Card**: title, the equation (LaTeX) and its preview stay open. Below it a read-only **Found**
  row: type and method, solves, needs, unit status. Everything optional is folded (`<details>`),
  each showing its current value: Settings, Applies when, Source, Outputs and inputs (with the unit
  check switch), Notes. The unit panel only opens when something is wrong.
- **Values** under the card: Variable, Value, Unit (Size only for arrays). Rows that need a value
  (inputs, ODE initial values, Newton guesses: `needsValue`) come first with a visible box; the
  rest say "computed". Code names, descriptions and sizes live in the Variables tab.
- User-facing names: Start → **Value**, Loop settings → **Settings**, Solver plan → **Plan**,
  Export → **Code**, Reset → **New project** (in the File menu). Data fields are unchanged (`initVal`, `loopMeta`).
- Guide: "You enter → You get" in two boxes and three buttons; the cheatsheet is folded below.
- **Array values as a grid**: an array input with a known size (numbers, or variables with a
  number as value, e.g. `N x 2` with N = 3) is edited one box per element: a vector as a numbered
  column, a matrix as a numbered grid (Enter / ↑ / ↓ move between rows). The grid writes the usual
  text back (`1, 2, 3` or `1, 2; 3, 4`); `I` and single values are shown expanded. Over 144 cells,
  or with a "text" switch per variable, it stays one text box. Changing N or a Size redraws it.
- **Plain math input** (`PlainMath`): the Equation box takes `Re = rho*u*D/mu` as well as LaTeX
  (text with a backslash or braces is LaTeX). A small parser turns it into LaTeX: `*` products,
  `/` one fraction per term (`a/b*c` → `\frac{a c}{b}`), `^`/`**` powers, a leading minus in front
  of the fraction, `1e-3` → `10^{-3}`, `sqrt abs exp ln log log10 sin cos tan sinh cosh tanh`,
  any other `name(args)` is a function (`mu(T)`), `dX/dt` a derivative. Names: Greek words →
  letters, `_` a subscript, trailing digits a subscript (`mu0` → `\mu_0`), `inf` → `\infty`, a
  multi-letter name keeps one symbol (`Re` → `R_e`, `Tsur` → `T_{sur}`). What was typed is kept in
  the new equation field `typed` (only when it differs from the LaTeX); `latex` is what everything
  else uses, so exports are unchanged. Under the box: "As LaTeX: …", or why it can't be read yet
  (unclosed parenthesis, …). Pasted plain lines are converted too. Checked: 19 conversions
  (detected types and outputs) and 8 computed values equal hand calculations.
- **First-visit tour**: the first time the Equations page opens (also "Show me around" on the
  Guide), five hints with a spotlight on the real screen: the equation list ("Each card is one
  equation", aimed at users who missed it on the demo), the Equation box, the Found row, Values,
  and the Get menu. Hidden targets are skipped (an empty card shows 3). Next / Back / Skip, Esc,
  ← →. Remembered in this browser (`solverMapp_tourDone`).
- **Steps bar**: Guide · *You enter* (1 Equations, 2 Variables) → *You get* (3 Plan, 4 Flowchart,
  5 Code, 6 Report), always visible. The group colour says who makes a page (green: you, purple:
  the app) and the numbers give the order. (Folding the groups was tried first and dropped: hidden
  pages were not found.)
- The equation list shows number, title, equation and type only; shortcuts are in the Guide and
  the right-click menu.

### Layout and interaction
- **Name**: SolverMapp. Saved data in the browser moves over from the old `solverBlueprint_*`
  storage keys on first start; `.card.json` files are written as `solvermapp-card` and the old
  `solverblueprint-card` still opens. Exports are named `solvermapp.py/.m/.f90` (Fortran
  `program solvermapp`).
- **Equation list** (left): resizable (drag its right edge, 200–560 px) and collapsible to a rail of
  `#n` and type symbols (☰ button left of the title, double-click the edge, drag it shut, or Ctrl+B). Width and state
  are a browser preference (`solverMapp_sidebar`), not part of the project.
- **Numbering**: an equation's number is its position, `#1`, `#2`, …, shown in the list, on the
  card, in the preview `(n)`, the graph, the report and the flowchart, so it is always in order and
  follows every move. The article's own number (Eq. 14.5) is part of the source flag.
- **Ordering, copy and paste**: drag to move, Ctrl+drag to copy (a drop line shows the gap);
  Alt+↑/↓ moves; right-click menu (copy, cut, paste below, duplicate, move up/down/top/bottom,
  export card, delete). Ctrl/Shift+click selects several, Ctrl+A all; every action works on the
  selection as one block. Keyboard: Ctrl+C / X / V / D, Del, ↑/↓ to open the previous/next.
  Shortcuts act when no text field is being edited and no text is selected (on the Equations tab
  or with the focus in the list), so Ctrl+C in a field still copies text.
- **Clipboard**: copied equations are JSON (`solvermapp-cards`: equations, their variable details,
  indices), so they paste into another project or browser tab; existing variable details win.
  Pasting plain LaTeX (one equation per line, `$…$` stripped) creates new equations, typed by
  detection. Paste, cut and delete can be undone.
- **Type**: the type selector was removed. Detection gives the stored type for every equation of
  the demo and the examples, and also handles the case that once needed it
  (`\mathbf{z} \odot \mathbf{z} = \mathbf{c}` → implicit), so the card shows a read-only badge
  with how it is solved (Newton–Raphson / linear solve, RK4 / Euler, trapezoidal rule, …); its
  tooltip lists the notation of each type. To change a type, change the notation (`x = \cos x` is
  Newton; `x_{new} = \cos x_{old}` is a fixed-point loop). `typeAuto` now only means "loop settings
  are the detected defaults"; settings typed for one type are remembered while the type flips during
  editing. Projects saved with a hand-chosen type get the detected type on load.
- **Variables**: their own tab (full width, columns for the equations that compute and use each
  variable, as `#n` buttons that open them) instead of a narrow column; the card keeps a table of
  its own variables (outputs first). Both tables edit the same data.
- **Solver plan**: dependency graph (3/5) and order of solution (2/5) side by side, each scrolling
  in its own panel at screen height; stacked below 1180 px.
- Checked with scripted events in headless Chrome (33 checks: keyboard, paste, drag and drop,
  context menu, collapse, tabs, layout), and the export regression (all projects, three languages)
  still matches.

- **Reset** starts a new, empty project with one empty card (undo in the message). The demo is
  opened from the Guide ("Open the demo project").
- **Guide** content is static HTML in the page; its formulas are `data-tex` attributes rendered by
  KaTeX at start. Keep it in step with the app when notation or settings change.

### Variables table filters (ported from an earlier prototype)
Search (symbol, code name, unit, description, equation) and filter chips with counts: All, the
four roles, and **To check**: missing or invalid unit, invalid or duplicate code name, case-only
clash (Fortran), missing description (the report needs it). A "!" marker shows the issues.

### Report tab (LaTeX)
- **Model → writers.** `buildReportModel` collects plain data (variable groups, equations with
  labels/sources/"where" lists, algorithm tree, references). `writeReportLatex` and
  `writeReportPreview` turn it into LaTeX and an HTML preview; sentences are shared through a small
  format object (`text`, `math`, `num`, `unit`, `cite`, `eqRef`). **A Markdown writer only needs
  its own format object and section layout.**
- Sections (each optional): variables table (grouped by role, or Latin then Greek alphabetically,
  with optional start values), governing equations (numbered, `\label`/`\eqref`, source, "where"
  table, loop type, coupling, assumptions), solution algorithm (`algpseudocode`, loops and coupled
  blocks as `\For` / `\Repeat … \Until`), references.
- **References**: one BibTeX `@misc` entry per distinct author + year + Reference text (the
  Reference field is free text, so it goes into `note`); cited as `\cite{key}` in the equations.
- **Output**: standalone document (preamble included, `.bib` embedded with `filecontents*`, compile
  pdflatex → bibtex → pdflatex ×2) or a fragment for `\input` (packages listed at its top, `.bib`
  downloaded separately).
- Text is escaped (`_ & % # $ { } ~ ^`, Unicode subscripts, Greek letters, `·`, `°`); units go
  through `siunitx` (`\si{W/(m.K)}`); dimensionless shows as `--`.
- Options are saved in the project (`report` object).
- Not yet compiled with a real TeX installation (none on the development machine).

### Unit check (ported from an earlier prototype)
- Units are global (one per variable in the shared table), unlike the example where each card had
  its own copy — so there are no per-card unit conflicts to resolve.
- Unit syntax: `W/(m·K)`, `kg m^-3`, `m/s^2`, `kPa`, `µm`, `°C`. `1` or `-` means dimensionless.
  **Empty means "unit not given"** (the check then lists it as missing). Previously the table showed
  `-` for empty; now the placeholder says "unit, or 1".
- On by default for every equation, with a per-equation switch (`unitCheck` field) to turn it off.
- Symbol matching bridges the two parsers:
  - Step suffixes map to the state variable: `T_{new}`, `T_{old}`, `y_{n+1}`, `y_n` → `T`, `y`.
  - An integration/differential variable that isn't a tracked variable takes the unit of its
    bounds: `\int_{x_1}^{x_2} … dx` uses the unit of `x_1`.
  - `\Delta x` falls back to the unit of `x`.
- Result shown under the equation preview (consistent / scale differs / mismatch / incomplete), with
  a one-click "dimensionless" fix for missing units, and as a small badge in the equation list and on
  graph nodes.
- Known limitation: old saved projects may hold `-` units that were created as an invisible default
  when another field was edited; they now count as dimensionless.

### Flowchart tab
- **Built from the report's algorithm model** (`buildFlowchart(opts, model)`), so the flowchart,
  the pseudocode and the equation numbers always agree.
- Shapes: start/end (rounded), read inputs / write results (parallelogram), process (rectangle),
  decision (diamond). Loops follow the equation type:
  - marching: `n = 0` → update, `n = n + 1` → `n < N_steps ?` (yes loops back);
  - convergence: update → `change < tol ?` (no loops back; "or max_iter iterations");
  - coupled block: initial guesses → body → `… converged?` (no loops back to the block start).
  Loops nest; inner loops take the inner lane on the right.
- One column, top to bottom; loop-back arrows run on the right, each lane outside the loops it
  contains. "Write results" lists the outputs, or every computed variable when there are none.
- **One label model, three writers.** Labels are lines of parts (`text`, `math` LaTeX, `ref` to
  an equation):
  - SVG (screen, `.svg`, `.png`): plain SVG text; math is drawn as italic letters with
    sub/superscripts and Unicode Greek (`mathToRuns`), measured with a canvas. Exported SVG
    uses fixed colours and no external resources, so it opens anywhere and rasterizes to PNG.
  - TikZ (`flowTikz`): real LaTeX math; `\usetikzlibrary{positioning,shapes.geometric,
    shapes.misc,arrows.meta}`; `.tex` download is a `standalone` document.
  - Mermaid (`flowMermaid`): plain text labels, `flowchart TD`, for Markdown (next step).
- Options (saved in the project, `flowchart` object): equation numbers, equation titles.
- In the Report: optional "Flowchart" section, a TikZ figure in an `adjustbox` (shrinks to fit the
  page) with `\eqref` links to the equations.

### Data format
Saved projects stay compatible. The `implicit`, `ode` and `function` types use the existing fields (`archetype`, `loopMeta`). New equation fields: `unitCheck` (bool, default `true`), `condition` (string, default empty). New variable field: `variableMeta[symbol].size` (empty = scalar). New project field: `indices` (string, default empty). New equation field: `typed` (optional, the plain math as typed).
`variableMeta[symbol].units` empty string = no unit. New project fields: `report` (Report tab
options) and `flowchart` (Flowchart tab options), defaults filled in on load.

### Recent additions
- **Second-order ODEs**: `m \frac{d^2x}{dt^2} = F` or `m \ddot{x} = F` (order from `odeOrder`) is
  rewritten for every solver as the first-order pair `dx/dt = \dot{x}`, `d\dot{x}/dt = F / m`
  (`firstOrderOdes`); a coefficient in front of a first-order derivative is divided out. The new rate
  state gets its value, unit, size and description from its state once (`prefillRateMeta`). When an
  equation with a derivative is not read as an ODE, the card says why (`derivativeHint`).
- **Math display without a connection**: KaTeX is loaded from a CDN. If it cannot load, equations
  are shown as LaTeX source, a notice explains it and offers to retry, and the app retries by itself
  when the connection returns (`loadMath`, `showMathState`). Nothing else depends on KaTeX.
- **File menu** in the top bar: Import file (a project, or a card to add), Export project (named
  after the report title), Export open card, then, set apart and marked, the two actions that replace
  the project: Open the example, New project. Ctrl+O and Ctrl+S.
- **Escaping**: text from opened files is escaped before it is shown; `tests/test_escaping.py` opens
  a project with an HTML payload in every field and checks that nothing gets through.
