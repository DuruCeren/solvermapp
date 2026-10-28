// SolverMapp — The Code tab: language choice, copy and download.
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// EXPORT (tab 3)
// ================================================================
function selectExportLang(lang) {
  currentExportLang = lang;
  ["python", "matlab", "fortran"].forEach(l => {
    $("langBtn_" + l).classList.toggle("active", l === lang);
  });
  renderCodeExportView();
}

function renderCodeExportView() {
  const plan = analyzeSolverArchitecture();
  const varList = buildVariableRegistry();
  const fileLabels = { python: "solvermapp.py", matlab: "solvermapp.m", fortran: "solvermapp.f90" };
  $("codeFileNameLabel").textContent = fileLabels[currentExportLang];

  const notes = [];
  if (plan.incomplete.length) notes.push(`${plan.incomplete.length} equation(s) skipped because they have no equation or output yet.`);
  if (plan.coupledSteps.length) notes.push(`${plan.coupledSteps.length} coupled block(s) are solved by fixed-point iteration: check the starting guesses in the Start column.`);
  const arrays = [...indexedArrays(plan, varList).keys()];
  if (arrays.length) notes.push(`Indexed inputs become arrays over their sum's range: ${arrays.map(s => codeOf(s)).join(", ")}. Give a list (1, 2, 3) in the Start column, or one value for all elements.`);
  if (currentExportLang === "fortran") {
    fortranCaseClashes(varList).forEach(names => notes.push(`Fortran ignores upper/lower case, so ${names.join(" and ")} are the same variable: rename one in the Code name column.`));
  }
  $("codeNote").textContent = notes.join(" ");
  $("codeNote").hidden = notes.length === 0;

  let code = "";
  if (currentExportLang === "python") code = generatePythonCode(plan, varList);
  else if (currentExportLang === "matlab") code = generateMatlabCode(plan, varList);
  else if (currentExportLang === "fortran") code = generateFortranCode(plan, varList);
  $("codeOutputBox").textContent = code;
}

function copyGeneratedCode() {
  const btn = $("copyBtn");
  navigator.clipboard.writeText($("codeOutputBox").textContent).then(() => {
    btn.textContent = "Copied ✓";
    setTimeout(() => btn.textContent = "Copy", 1500);
  });
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function downloadGeneratedCode() {
  downloadText($("codeFileNameLabel").textContent, $("codeOutputBox").textContent);
}
