# Security policy

## How SolverMapp handles data

SolverMapp runs entirely in the browser. It has no server, no accounts and no analytics:

- Projects are kept in the browser's local storage and written to files only when you export them.
- The only network request loads KaTeX (math display) from the jsDelivr CDN, pinned to version 0.16.9. Without it the app still works and shows equations as LaTeX source.
- Opened project and card files are parsed as JSON data, and their text is escaped before it is shown. Treat files from unknown sources with the usual care all the same (see below).

## Generated code

The exported solvers (Python, MATLAB, Fortran) are generated from the project's equations and names. Read generated code before running it, as you would any code. In particular, check a solver generated from a project file you received from someone else.

## Reporting a vulnerability

If you find a way for a project file, a pasted text or a generated solver to run code you did not expect, or any other security problem, please **do not open a public issue**. Write to **duruceren1952@gmail.com** with the steps to reproduce it, and if possible the file involved. You will get an answer within two weeks. A fix will be released before the problem is made public, and you will be credited unless you prefer not to be.

## Supported versions

Only the latest release is supported.
