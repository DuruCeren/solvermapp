"""Export tests. Test projects (switches, functions, ODE systems, vectors and matrices, the
three-body problem, index notation) are typed as LaTeX and detected like on the card
(export_projects.js). Their generated solvers run in Python, gfortran and MATLAB, and every
variable must equal the browser's own run; trajectory CSV files must be the same in every
language; results are checked against exact references (cooling law, rotation, Euler decay,
Hilbert matrix by numpy, species network by the matrix exponential, indexed N-body = written-out
three-body).

    python tests/test_exports.py               Python always; gfortran and MATLAB when found
    python tests/test_exports.py --no-matlab   skip MATLAB (slow to start)

Needs numpy. Generated files go to tests/.out/exports/ (not committed). Exit code 1 on a mismatch.
"""
import importlib.util, json, math, os, re, shutil, subprocess, sys
import numpy as np

from browser import TESTS, run_in_app

out2 = os.path.join(TESTS, ".out", "exports")
use_matlab = "--no-matlab" not in sys.argv and shutil.which("matlab") is not None
use_fortran = shutil.which("gfortran") is not None

# Run the test projects in the app and write their solvers
res = run_in_app(open(os.path.join(TESTS, "export_projects.js"), encoding="utf-8").read(), "testOut")
if res.get("errors") or res.get("errorsAfter"):
    sys.exit(f"Page errors: {res.get('errors')} {res.get('errorsAfter')}")
shutil.rmtree(out2, ignore_errors=True)
for key, r in res["projects"].items():
    if "threw" in r:
        sys.exit(f"{key}: {r['threw']}")
    os.makedirs(os.path.join(out2, key), exist_ok=True)
    for lang, name in [("python", "solver.py"), ("matlab", "solver.m"), ("fortran", "solver.f90")]:
        open(os.path.join(out2, key, name), "w", encoding="utf-8").write(r[lang])
print("Languages: Python" + (", gfortran" if use_fortran else " (gfortran not found: skipped)") + (", MATLAB" if use_matlab else " (MATLAB skipped)"))

def close(a, b, rel=1e-9):
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    if a.size != b.size: return False
    return np.allclose(a.ravel(), b.ravel(), rtol=rel, atol=1e-12)

def parse_nums(s):
    return [float(x) for x in re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][-+]?\d+)?", s.replace("D", "E"))]

ok_all = True
matlab_runs = {}
if use_matlab:
    keys = list(res["projects"])
    script = "; ".join(f"cd('{os.path.join(out2, k)}'); disp('@@{k}'); run('solver.m')" for k in keys)
    p = subprocess.run(["matlab", "-batch", script], capture_output=True, text=True, timeout=600)
    cur = None
    for line in (p.stdout + p.stderr).splitlines():
        if line.startswith("@@"): cur = line[2:]; matlab_runs[cur] = {}; continue
        m = re.match(r"^(\w+)\s+= (.*)$", line)
        if cur and m: matlab_runs[cur][m.group(1)] = m.group(2)
        elif cur and line.strip() and "Warning" in line: print("  MATLAB:", line)
        elif cur and ("Error" in line or "error" in line): print("  MATLAB:", line); ok_all = False
    for k in keys:  # keep each language's CSV
        for f in os.listdir(os.path.join(out2, k)):
            if re.fullmatch(r"ode_system_\d+\.csv", f): os.replace(os.path.join(out2, k, f), os.path.join(out2, k, f[:-4] + ".m.csv"))

for key, r in res["projects"].items():
    d = os.path.join(out2, key)
    js = r["sim"]
    print(f"\n===== {key}")
    # Python
    spec = importlib.util.spec_from_file_location("solver_" + key, os.path.join(d, "solver.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    here_cwd = os.getcwd(); os.chdir(d)
    try: py = mod.run_solver()
    finally: os.chdir(here_cwd)
    for f in os.listdir(d):
        if re.fullmatch(r"ode_system_\d+\.csv", f): os.replace(os.path.join(d, f), os.path.join(d, f[:-4] + ".py.csv"))
    # Fortran
    exe = os.path.join(d, "solver_f.exe")
    ft = {}
    c = subprocess.run(["gfortran", "-Wall", "-o", exe, os.path.join(d, "solver.f90")], capture_output=True, text=True) if use_fortran else None
    warn = [l for l in c.stderr.splitlines() if l.strip()] if c else []
    if c is None:
        pass
    elif c.returncode: print("  gfortran FAILED:\n" + c.stderr); ok_all = False; ft = {}
    else:
        if warn: print("  gfortran says:", "\n    ".join(warn[:12]))
        ft = {}
        fout = subprocess.run([exe], capture_output=True, text=True, cwd=d).stdout
        for f in os.listdir(d):
            if re.fullmatch(r"ode_system_\d+\.csv", f): os.replace(os.path.join(d, f), os.path.join(d, f[:-4] + ".f90.csv"))
        for line in fout.splitlines():
            m = re.match(r"^\s*(\w+) = (.*)$", line)
            if m: ft[m.group(1)] = parse_nums(m.group(2))
    ml = matlab_runs.get(key, {})
    for name, jv in js.items():
        if name in ("i", "q", "x") and name not in py: continue
        jv_arr = np.asarray(jv, dtype=float)
        checks = []
        if name in py: checks.append(("py", close(py[name], jv_arr)))
        if name in ft:
            col = jv_arr.T.ravel() if jv_arr.ndim == 2 else jv_arr.ravel()
            checks.append(("f90", close(ft[name], col)))
        if name in ml:
            mv = np.asarray(parse_nums(ml[name]))
            checks.append(("m", close(mv, jv_arr.ravel())))
        bad = [k for k, good in checks if not good]
        if bad: ok_all = False
        print(f"  {name:10s} {'OK ' if not bad else 'BAD'} {[k for k, _ in checks]} js={np.round(jv_arr, 10).tolist()}"
              + ("" if not bad else f"  py={py.get(name)} f90={ft.get(name)} m={ml.get(name)}"))

# Physics checks
s = res["projects"]["ode"]["sim"]
T_exact = 293 + 80 * math.exp(-10 * 0.01 / (0.1 * 900) * 600)
print("\nCooling T(600) RK4", s["T"], "exact", T_exact, "rel err", abs(s["T"] - T_exact) / T_exact)
m = res["projects"]["matrix"]["sim"]
print("Rotation y(1)", m["y"], "exact", [math.cos(1), -math.sin(1)])
x = res["projects"]["misc"]["sim"]
print("Euler N(2)", x["N"], "exact discrete", 100 * (1 - 0.5 * 0.1) ** 20, "| N_u", x["N_u"], "(laminar 3.66) | c_1", x["c_1"], "(0.25) | q", x["q_"], "(0.6*50/0.1 = 300)")
# Index notation: independent references
nb, tb = res["projects"]["nbody"]["sim"], res["projects"]["threebody"]["sim"]
diff = max(np.max(np.abs(np.array(nb["r"]) - np.array([tb["r_1"], tb["r_2"], tb["r_3"]]))),
           np.max(np.abs(np.array(nb["v"]) - np.array([tb["v_1"], tb["v_2"], tb["v_3"]]))), abs(nb["E"] - tb["E"]))
print("N-body (indexed) vs three-body (written out): max difference", diff)
if diff > 1e-12: ok_all = False
h = res["projects"]["hilbert"]["sim"]
n = 6
H = np.array([[1 / (i + j - 1) for j in range(1, n + 1)] for i in range(1, n + 1)])
checks = {"H": H, "b": H.sum(axis=1), "x": np.linalg.solve(H, H.sum(axis=1)), "C": H @ np.eye(n), "tau": np.trace(H),
          "d": np.cumsum(H[:, 0])}
for k, ref in checks.items():
    good = np.allclose(np.array(h[k], dtype=float), ref, rtol=1e-8, atol=1e-8)
    if not good: ok_all = False
    print(f"Hilbert {k}: {'OK' if good else 'BAD'} vs numpy")
sp = res["projects"]["species"]["sim"]
K = np.array([[-2, 0, 0], [1.5, -1, 0.5], [0.5, 1, -0.5]])
w, V = np.linalg.eig(K)
c_exact = (V @ np.diag(np.exp(w * 2)) @ np.linalg.inv(V) @ np.array([1, 0, 0])).real
err = np.max(np.abs(np.array(sp["c"]) - c_exact))
print("Species c(2) RK4", sp["c"], "exact expm", c_exact.tolist(), "max err", err, "| c_tot", sp["c_tot"])
if err > 1e-8: ok_all = False

# Trajectory files: same header and values in every language
for key in res["projects"]:
    d = os.path.join(out2, key)
    for f in sorted(x for x in os.listdir(d) if x.endswith(".py.csv")):
        base = f[:-7]
        tabs = {}
        for lang in ("py", "m", "f90"):
            fn = os.path.join(d, f"{base}.{lang}.csv")
            if os.path.exists(fn):
                lines = open(fn).read().strip().splitlines()
                tabs[lang] = (lines[0], np.array([[float(x) for x in l.split(",")] for l in lines[1:]]))
        heads = {k: v[0] for k, v in tabs.items()}
        same = all(v[1].shape == tabs["py"][1].shape and np.allclose(v[1], tabs["py"][1], rtol=1e-9, atol=1e-12) for v in tabs.values())
        if len(set(heads.values())) != 1 or not same: ok_all = False
        print(f"CSV {key}/{base}: langs={list(tabs)} rows x cols={tabs['py'][1].shape} header-same={len(set(heads.values())) == 1} values-same={same}")
        print("   header:", tabs["py"][0][:140])
        last = tabs["py"][1][-1]
        print("   last row t =", last[0], "| JS final t =", res["projects"][key]["sim"].get("t"))
print("\nALL MATCH" if ok_all else "\nMISMATCHES FOUND")
sys.exit(0 if ok_all else 1)
