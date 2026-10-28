# User guide

The same content as the **Guide** page in the app, as a reference to read or print.

## The idea

**You enter:**
1. **Equations:** one card per equation.
2. **Values:** only for the *input* variables, the ones no equation computes.

**You get:**
- **Plan:** how the equations connect, and the order of solution.
- **Flowchart:** .svg, .png, TikZ .tex, Mermaid.
- **Code:** Python, MATLAB, Fortran.
- **Report:** LaTeX, with references.

The first time you open the Equations page, a short tour points out where everything is. You can
replay it with **Show me around** on the Guide.

## Writing equations

Type each equation in **plain math** or **LaTeX**; the preview shows how it was read.

**Plain math:**
- Operators: `*` `/` `^` and parentheses.
- Functions: `sqrt(x)`, `exp`, `ln`, `log10`, `sin`, …
- Names:
  - Greek words become letters: `rho` → ρ.
  - `_` starts a subscript: `c_p` → c<sub>p</sub>, `T_inf` → T<sub>∞</sub>.
  - A longer name stays one variable: `Re` → R<sub>e</sub>.
- Derivatives: `dT/dt`, `d2x/dt2`.

Sums, integrals and vectors need LaTeX.

The **type** follows from how the equation is written:

| You write | Type | Solved by |
| --- | --- | --- |
| `y = a x + b` | Explicit | direct assignment |
| `y_{n+1} = y_n + h f` | Marching loop | `N_steps` repetitions |
| `T_{new} = 0.5 T_{old} + c` | Convergence loop | until the change is below `tol` |
| `S = \sum_{i=1}^{N} x_i` | Summation | a loop over *i* |
| `W = \int_{x_1}^{x_2} F \, dx` | Integral | trapezoidal rule |
| `P V = n R T` | Implicit | Newton–Raphson for the first output |
| `\mathbf{K}\mathbf{u} = \mathbf{F}` | Implicit | a direct linear solve, when linear in the unknown |
| `\frac{dT}{dt} = -k (T - T_\infty)` | ODE | RK4 (or Euler) |
| `m \frac{d^2x}{dt^2} = -k x - c \frac{dx}{dt}` | ODE, 2nd order | RK4 on *x* and its rate ẋ; also `m \ddot{x} = …` |
| `\mu(T) = \mu_0 e^{B/T}` | Function | a function; use `\mu` or `\mu(T)` elsewhere |

An equation is **implicit** when the unknown is not alone on the left: `x = \cos x`,
`c^2 = a^2 + b^2`.
- **To change the type**, change the notation: `x_{new} = \cos x_{old}` iterates instead of using
  Newton.
- **If the outputs are wrong**, edit *Solves for* under **Outputs and inputs**. **Find again**
  undoes the edit.

## Settings (per equation)

| Type | Settings |
| --- | --- |
| Marching loop | `N_steps = 100` |
| Convergence loop | `tol = 1e-6, max_iter = 500` |
| Summation | bounds from `\sum_{i=1}^{N}` |
| Integral | bounds from `\int_a^b`, `n = 100` intervals |
| Implicit | `method = newton, tol = 1e-10, max_iter = 50`, and `guess`, `min`, `max` to pick the branch (numbers, variables or LaTeX: `min = b`). The root plot on the card shows every root; click one to use it. |
| ODE | `t = 0..t_end, steps = 100, method = rk4` (or `euler`); `save = 10` writes a CSV every 10 steps. |

**ODEs:**
- The Value of a state is its initial value.
- A second-order ODE has two states, *x* and ẋ: give both a Value.
- On the right side of that ODE, `\frac{dx}{dt}` means ẋ. Elsewhere, write `\dot{x}`.

## Switches: *Applies when*

Give two or more equations the same output and a condition each. The first condition that holds
decides which equation is used:

| Equation | Applies when |
| --- | --- |
| `f = \frac{64}{R_e}` | `R_e < 2300` |
| `\frac{1}{\sqrt{f}} = -2 \log_{10}(\dots)` | `otherwise` |

Without an `otherwise` case, the Value is kept when no condition holds.

## Variables

| Column | Meaning |
| --- | --- |
| Role | input, state, intermediate or output, from how the equations use the variable |
| Value | for inputs, initial values and guesses: `1.5`; a vector `1, 2, 3`; a matrix `1, 2; 3, 4`; the identity `I`. Arrays of known size are filled in a grid, one box per element. |
| Unit | `W/(m·K)`, `kg m^-3`, `m/s^2`, `kPa`, `°C`; `1` or `-` = dimensionless; empty = not given |
| Size | empty = scalar; `3` = vector; `3 x 3` or `N x 2` = matrix |
| Code name | the name in the exported code (empty = automatic). Fortran ignores upper / lower case: `T` and `t` clash. |

The **To check** filter lists missing units, sizes and descriptions, and bad code names.

Every equation is checked for **unit consistency**. The result shows in the Found row (✓ units),
with details when something is wrong.

## Vectors and matrices

Bold symbols are arrays: give their Size.

| Write | Meaning | Write | Meaning |
| --- | --- | --- | --- |
| `\mathbf{a} \cdot \mathbf{b}` | dot product | `\mathbf{a} \times \mathbf{b}` | cross product |
| `\mathbf{a} \odot \mathbf{b}` | element-wise product | `\mathbf{K}\mathbf{u}` | matrix product |
| `\mathbf{K}^T` | transpose | `\mathbf{K}^{-1}` | inverse |
| `\|\mathbf{a}\|` | norm | `\frac{d\mathbf{y}}{dt} = \mathbf{M}\mathbf{y}` | vector ODE |

## Index notation

Declare the indices once in the Variables tab, e.g. `i, j = 1..N; k = 1..M`. Then:

- **Elements:** `m_i`, `k_{ij}`, `x_{i+1}` are elements of the arrays *m*, *k*, *x*. With one
  index, `\mathbf{r}_i` is row *i* of **r** (Size `N x 2`).
- **For every i:** a free index on the left, as in `\frac{d\mathbf{v}_i}{dt} = \dots`, means the
  equation holds for every *i*. It becomes a loop.
- **Sums:** `\sum_j`, `\sum_{j=1}^{i}`, `\sum_{j \ne i}`, `\sum_{i<j}` (all pairs). A sum covers
  the next term; use parentheses for more. A sum over a letter that is *not* declared is an
  ordinary summation loop.

The built-in example, the N-body problem, needs only three equations for any N.

## The equation list

| Action | How |
| --- | --- |
| move · copy | drag · Ctrl+drag |
| move up / down | Alt+↑ / Alt+↓ |
| copy, cut, paste below (also into another project) | Ctrl+C, Ctrl+X, Ctrl+V |
| duplicate · delete (Undo in the message) | Ctrl+D · Del |
| select several · all | Ctrl/Shift+click · Ctrl+A |
| open the previous / next | ↑ / ↓ |
| collapse / expand the list | Ctrl+B or ☰ |
| all of the above | right-click |

The numbers **#1, #2, …** are the order in the list. The report and the flowchart use them too.
Pasting LaTeX or plain text makes new equations, one per line.

## Files

| | |
| --- | --- |
| Saved in this browser | Every change is kept automatically, on this computer and browser only. |
| File › Export project | The whole project as a `.json` file, to keep or share (Ctrl+S). |
| File › Import file | A project replaces the current one; a card is added to it (Ctrl+O). Examples are in the `examples` folder. |
| File › Export open card | One equation with its variables. |
| File › New project | An empty project with one empty card (can be undone). |
| Code | `solvermapp.py` / `.m` / `.f90`, with Newton, RK4, sums and loops written out. |

## Running the generated code

| Language | How to run |
| --- | --- |
| Python 3 | `python solvermapp.py`. NumPy is needed when the model has vectors or matrices. |
| MATLAB | Run `solvermapp.m` as a script. |
| Fortran | `gfortran -O2 -o solvermapp solvermapp.f90`, then `./solvermapp`. |

Each program prints the results. With `save = k` on an ODE, it also writes the trajectory as
`ode_system_<n>.csv`.
