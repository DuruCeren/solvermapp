"""Runs every test and prints a summary. Extra arguments (e.g. --no-matlab) go to test_exports.py.

    python tests/run_all.py
    python tests/run_all.py --no-matlab
"""
import os
import subprocess
import sys
import time

TESTS = os.path.dirname(os.path.abspath(__file__))
SUITE = [
    ("Interaction (UI)", ["test_ui.py"]),
    ("Escaping", ["test_escaping.py"]),
    ("Snapshots", ["test_snapshots.py"]),
    ("Exports (Python / gfortran / MATLAB)", ["test_exports.py", *sys.argv[1:]]),
]

results = []
for title, args in SUITE:
    print(f"\n=== {title} ===", flush=True)
    t0 = time.time()
    code = subprocess.run([sys.executable, *args], cwd=TESTS).returncode
    results.append((title, code, time.time() - t0))

print("\n=== Summary ===")
for title, code, secs in results:
    print(f"{'PASS' if code == 0 else 'FAIL'}  {title}  ({secs:.0f} s)")
sys.exit(0 if all(code == 0 for _, code, _ in results) else 1)
