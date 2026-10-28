"""Runs a check script inside the real app (index.html) in headless Chrome and returns its result.

The app is loaded from the repository through a <base> tag, so css/ and js/ come from the working
tree. Chrome is found from the CHROME environment variable, the usual install paths, or the PATH.
"""
import html
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.join(REPO, "tests")


def find_chrome():
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        if shutil.which(name):
            return shutil.which(name)
    sys.exit("Chrome or Chromium not found: install it, or set the CHROME environment variable to its path.")


def file_url(path):
    path = os.path.abspath(path).replace("\\", "/")
    return "file://" + ("" if path.startswith("/") else "/") + path


def run_in_app(script, result_id, window_size="1500,1000", budget_ms=20000):
    """Loads index.html with `script` (JavaScript) appended; the script must write its result as
    JSON into <pre id="{result_id}">. Returns the parsed JSON. Page errors are collected in
    window.__errors for the script to report."""
    catch = ("<script>window.__errors=[];window.addEventListener('error',e=>window.__errors.push("
             "String(e.message)+' @'+(e.filename||'').split('/').pop()+':'+e.lineno));</script>")
    base = f'<base href="{file_url(REPO)}/">'
    src = open(os.path.join(REPO, "index.html"), encoding="utf-8").read()
    src = src.replace("<head>", "<head>" + base + catch, 1)
    end = src.rindex("</body>")
    src = src[:end] + "<script>\n" + script + "\n</script>\n" + src[end:]
    work = tempfile.mkdtemp(prefix="solvermapp-test-")
    page = os.path.join(work, "page.html")
    open(page, "w", encoding="utf-8").write(src)
    try:
        dom = subprocess.run([find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox", f"--user-data-dir={os.path.join(work, 'profile')}",
                              f"--window-size={window_size}", f"--virtual-time-budget={budget_ms}", "--dump-dom", file_url(page)],
                             capture_output=True, text=True, encoding="utf-8", timeout=600).stdout
    finally:
        shutil.rmtree(work, ignore_errors=True)
    # the result element is the last one with that id (the script's own text may mention the tag)
    tag = f'<pre id="{result_id}">'
    start = dom.rfind(tag)
    end = dom.find("</pre>", start)
    if start < 0 or end < 0:
        sys.exit(f"No result from the page (id {result_id}). Last part of the page:\n{dom[-1500:]}")
    return json.loads(html.unescape(dom[start + len(tag):end]))


def example(name):
    return open(os.path.join(REPO, "examples", name), encoding="utf-8").read()
