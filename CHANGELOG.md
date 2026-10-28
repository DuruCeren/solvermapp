# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-28

First public release.

### Writing a model

- One card per equation, in plain math (`Re = rho*u*D/mu`) or LaTeX, with a live preview.
- The equation type follows from the notation, so there is no menu to set:
  - explicit;
  - marching loop (`y_{n+1}`) and convergence loop (`y_{new}`);
  - summation and integral (trapezoidal rule);
  - implicit (Newton-Raphson, or a direct solve when linear);
  - first- and second-order ODEs (RK4 or Euler);
  - function definitions (`\mu(T) = ...`).
- Outputs and inputs are found automatically, and can be edited.
- *Applies when* conditions turn equations for the same output into a switch.
- Vectors and matrices: bold symbols, dot, cross and element-wise products, transpose, inverse, norm; values entered in a grid.
- Index notation (`m_i`, `k_{ij}`, `\sum_{j \ne i}`, `\sum_{i<j}`): a model with N bodies or species is written once for any N.
- Unit check of every equation (SI dimensions, prefixes, `°C`).
- Implicit equations: a root plot with every root, and `guess`, `min` and `max` to choose the physical branch.

### What you get

- Plan: the dependency graph and the order of solution, with coupled blocks and ODE systems.
- Flowchart: SVG, PNG, TikZ (standalone `.tex`) and Mermaid.
- Code: Python, MATLAB and Fortran solvers, with ODE trajectories saved as CSV on request.
- Report: a LaTeX model description (variables table, equations with sources, algorithm, flowchart) and a BibTeX file.

### Working with the app

- Guide page and a first-visit tour.
- Built-in example: the N-body problem (three bodies on the figure-eight orbit) in index notation.
- Eight example projects.
- Equation list:
  - numbering by position;
  - drag to reorder or copy;
  - copy and paste between projects;
  - multi-selection and keyboard shortcuts;
  - collapsible.
- File menu: import and export projects and single cards.
- Work is kept in the browser automatically, and many actions can be undone.
- Light and dark theme.
- Math display keeps working without a connection, by showing the LaTeX source.

### Quality

- The app is split into plain scripts with no build step. It opens from disk or from GitHub Pages.
- Tests run in headless Chrome:
  - about 65 interaction checks;
  - an HTML-escaping check;
  - snapshots of the generated code, report and flowchart for every example;
  - an export test that runs the solvers in Python, gfortran and MATLAB against the browser and against exact references.

### Known limitations

- Not supported yet:
  - ODEs above second order;
  - partial differential equations;
  - boundary value problems;
  - stiff ODEs.
- Equations of these kinds are not refused yet: they can be misread, and their exported code is wrong. See [ROADMAP.md](ROADMAP.md).

[Unreleased]: https://github.com/DuruCeren/solvermapp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/DuruCeren/solvermapp/releases/tag/v1.0.0
