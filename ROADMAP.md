# Roadmap

Ideas and known limits, roughly by priority. Nothing here is promised. If one of these matters for
your work, say so in an issue: that moves it up. Pull requests are welcome; please open an issue
first for larger items.

## Next (1.0.x)

- **Refuse what is not supported:** an equation with `\partial`, `\nabla` or a derivative above second order should be marked *Not supported yet* and left out of the plan, code, report and flowchart. In 1.0 such equations can be misread, and their exported code is wrong.

## 1.1: ODEs of any order

- `\frac{d^n x}{dt^n}`, `\dddot{x}`, and perhaps `x'''` / `x^{(n)}`, rewritten as a chain of n first-order equations, the way second-order ODEs already are.
  - States: x, \dot{x}, \ddot{x}, then numbered names.
  - Each state needs an initial value, and its unit follows automatically (m, m/s, m/s^2, ...).
- Tests against exact solutions (e.g. x''' = -x).

## 1.2: Partial differential equations (1-D, method of lines)

- **Notation:** `\frac{\partial u}{\partial t}`, `\frac{\partial^2 u}{\partial x^2}`, `\nabla^2`.
- **A grid declaration:** `x = 0..L, N = 101`.
- **Conditions:** boundary conditions (fixed value, fixed gradient, periodic) and an initial condition `u(x, 0) = f(x)`.
- **Discretisation:** second-order central differences, and upwinding for advection.
- **Time stepping:** the existing RK4, with the stable step computed and shown; then an implicit method (backward Euler / Crank-Nicolson) for diffusion.
- **Steady problems** (Poisson in 1-D) as linear systems.
- **Verification:** exact solutions, and a grid-convergence check (second order).
- **Later, on request:** 2-D rectangular grids. Irregular geometries (finite elements) are out of scope.

## Also planned

- **Boundary value problems by shooting:** guess the missing initial values, integrate, and let Newton-Raphson match the far boundary (e.g. a beam).
- **Markdown report**: a second report writer next to LaTeX. The report model is already separate from the LaTeX writer, so this needs only a new writer.
- **A "ready" indicator**: one line saying what is still missing ("2 values, 1 unit"), linking to each item, then "Ready".
- **Plainer words for roles and types** in the interface (*known* / *result*, *repeats until it settles*), keeping the technical names in the report.
- **Fortran case clashes renamed automatically**: Fortran ignores upper / lower case, so `T` and `t` clash. Today the *To check* filter flags this, and the user gives one a code name.

## Solving

- More root finders next to Newton-Raphson: secant, bisection, Brent. The settings already have a `method` key.
- Sums inside implicit residuals and marching updates. Today sums work in explicit equations and ODE right-hand sides.
- Adaptive ODE step size (RK45) and an implicit method for stiff systems.
- More than two indices per symbol.

## Using it

- KaTeX bundled with the app, so math display needs no connection at all.
- Import of equations from a LaTeX document: collect every `equation` environment.
- A shareable link that holds a small project.
- Translations of the interface.

## Known limitations

- **Unit check:** it checks dimensions, not units in the exported code. The solvers compute in the units you give.
- **Plain math:** it covers products, fractions, powers, functions, derivatives and subscripts. Sums, integrals and vectors need LaTeX.
- **Browser storage:** projects live in the browser's local storage until they are exported. Clearing the browser's site data removes them.
