// Test projects for switches, functions, ODEs and matrices. Equations are typed as LaTeX and
// detected like on the card; results go to a pre element with id testOut, as JSON (read by test_exports.py).
(function () {
  const E = (name, latex, extra = {}) => ({ name, latex, ioAuto: true, typeAuto: true, ...extra });
  const V = (initVal, units, desc, size) => ({ initVal, units, desc, ...(size ? { size } : {}) });
  const projects = {
    pipe: {
      equations: [
        E("Viscosity", "\\mu(T) = \\mu_0 \\exp\\left(\\frac{B}{T} - \\frac{B}{T_0}\\right)"),
        E("Reynolds number", "R_e = \\frac{\\rho u D}{\\mu(T)}"),
        E("Laminar friction", "f = \\frac{64}{R_e}", { condition: "R_e < 2300" }),
        E("Colebrook", "\\frac{1}{\\sqrt{f}} = -2 \\log_{10}\\left(\\frac{k_s}{3.7 D} + \\frac{2.51}{R_e \\sqrt{f}}\\right)", { condition: "\\text{otherwise}", loopMeta: "method = newton, tol = 1e-12, max_iter = 50, min = 1e-4" }),
        E("Pressure drop", "\\Delta p = f \\frac{L}{D} \\frac{\\rho u^2}{2}")
      ],
      variableMeta: {
        "\\mu_0": V("1e-3", "Pa s", "Viscosity at T_0"), "B": V("1800", "K", "Viscosity constant"), "T_0": V("293", "K", "Reference temperature"),
        "T": V("313", "K", "Temperature"), "\\rho": V("998", "kg/m^3", "Density"), "u": V("2", "m/s", "Velocity"), "D": V("0.05", "m", "Diameter"),
        "k_s": V("4.5e-5", "m", "Roughness"), "L": V("10", "m", "Length"), "f": V("0.02", "1", "Friction factor"), "R_e": V("1", "1", "Reynolds"),
        "\\Delta p": V("0", "Pa", "Pressure drop"), "\\mu": V("1e-3", "Pa s", "Viscosity")
      }
    },
    ode: {
      equations: [
        E("Heat flux", "\\dot{Q} = h A (T - T_\\infty)"),
        E("Cooling", "\\frac{dT}{dt} = -\\frac{\\dot{Q}}{m c_p}", { loopMeta: "t = 0..600, steps = 60, method = rk4" }),
        E("Forcing", "F = F_0 \\sin(\\omega t)"),
        E("Position", "\\frac{dx}{dt} = v", { loopMeta: "t = 0..3, steps = 300" }),
        E("Velocity", "\\frac{dv}{dt} = -\\omega^2 x + F", { loopMeta: "t = 0..3, steps = 300" }),
        E("Energy", "E_k = \\frac{1}{2} v^2 + \\frac{1}{2} \\omega^2 x^2")
      ],
      variableMeta: {
        "T": V("373", "K", "Temperature"), "h": V("10", "W/(m^2 K)", "Heat transfer coefficient"), "A": V("0.01", "m^2", "Area"),
        "m": V("0.1", "kg", "Mass"), "c_p": V("900", "J/(kg K)", "Heat capacity"), "T_\\infty": V("293", "K", "Ambient"), "\\dot{Q}": V("0", "W", "Heat flux"),
        "t": { ...V("0", "s", "Time"), codeName: "time" }, "x": V("1", "m", "Position"), "v": V("0", "m/s", "Velocity"), "\\omega": V("2", "1/s", "Angular frequency"),
        "F": V("0", "m/s^2", "Forcing"), "F_0": V("0.5", "m/s^2", "Forcing amplitude"), "E_k": V("0", "m^2/s^2", "Energy")
      }
    },
    matrix: {
      equations: [
        E("Stiffness system", "\\mathbf{K}\\mathbf{u} = \\mathbf{F}"),
        E("Strain energy", "E = \\frac{1}{2}\\mathbf{u}^T\\mathbf{K}\\mathbf{u}"),
        E("Inverse solve", "\\mathbf{r} = \\mathbf{K}^{-1}\\mathbf{F}"),
        E("Cross product", "\\mathbf{w} = \\mathbf{a} \\times \\mathbf{b}"),
        E("Dot product", "s = \\mathbf{a} \\cdot \\mathbf{b}"),
        E("Norm", "n_a = \\|\\mathbf{a}\\|"),
        E("Rotation ODE", "\\frac{d\\mathbf{y}}{dt} = \\mathbf{M}\\mathbf{y}", { loopMeta: "t = 0..1, steps = 50, method = rk4" }),
        E("Nonlinear vector root", "\\mathbf{z} \\odot \\mathbf{z} = \\mathbf{c}", { archetype: "implicit", typeAuto: false, loopMeta: "tol = 1e-12, max_iter = 50" }),
        E("Gram matrix", "\\mathbf{P} = \\mathbf{K}\\mathbf{K}^T"),
        E("Combination", "\\mathbf{q} = 2 \\mathbf{r} + \\mathbf{u}")
      ],
      variableMeta: {
        "\\mathbf{K}": V("4, -1; -1, 3", "N/m", "Stiffness", "2x2"), "\\mathbf{F}": V("1, 2", "N", "Load", "2"), "\\mathbf{u}": V("0", "m", "Displacement", "2"),
        "E": V("0", "J", "Energy"), "\\mathbf{r}": V("0", "m", "Same, by inverse", "2"),
        "\\mathbf{a}": V("1, 2, 3", "m", "a", "3"), "\\mathbf{b}": V("4, 5, 6", "m", "b", "3"), "\\mathbf{w}": V("0", "m^2", "a x b", "3"),
        "s": V("0", "m^2", "a . b"), "n_a": V("0", "m", "|a|"),
        "\\mathbf{y}": V("1, 0", "1", "State", "2"), "\\mathbf{M}": V("0, 1; -1, 0", "1/s", "Rotation", "2x2"), "t": V("0", "s", "Time"),
        "\\mathbf{z}": V("1", "1", "Unknown", "2"), "\\mathbf{c}": V("4, 9", "1", "Squares", "2"),
        "\\mathbf{P}": V("0", "N^2/m^2", "K K^T", "2x2"), "\\mathbf{q}": V("0", "m", "2r + u", "2")
      }
    }
  };

  projects.misc = {
    equations: [
      E("Reynolds number", "R_e = \\frac{u D}{\\nu}"),
      E("Laminar Nusselt", "N_u = 3.66", { condition: "R_e < 2300" }),
      E("Dittus-Boelter", "N_u = 0.023 R_e^{0.8} P_r^{0.4}", { condition: "R_e \\ge 2300" }),
      E("Piecewise", "c_1 = -x", { condition: "x < 0" }),
      E("Piecewise middle", "c_1 = x^2", { condition: "0 \\le x < 1" }),
      E("Piecewise top", "c_1 = 2 x - 1", { condition: "otherwise" }),
      E("Conduction", "q = k(T) \\frac{T_h - T_c}{L}"),
      E("Decay", "\\frac{dN}{dt} = -\\lambda N", { loopMeta: "t = 0..2, steps = 20, method = euler" })
    ],
    variableMeta: {
      "u": V("0.01", "m/s", "Velocity"), "D": V("0.05", "m", "Diameter"), "\\nu": V("1e-6", "m^2/s", "Kinematic viscosity"),
      "P_r": V("7", "1", "Prandtl"), "x": V("0.5", "1", "Switch input"), "T": V("300", "K", "T"),
      "k": V("0.6", "W/(m K)", "Conductivity as a function of T"), "T_h": V("350", "K", "Hot"), "T_c": V("300", "K", "Cold"), "L": V("0.1", "m", "Thickness"),
      "N": V("100", "1", "Count"), "\\lambda": V("0.5", "1/s", "Decay rate"), "t": { ...V("0", "s", "Time"), codeName: "time" }
    }
  };

  // Three-body problem, figure-eight orbit (Chenciner & Montgomery 2000), G = m = 1, one period.
  const accel = (i, j, k) => `G m_${j} \\frac{\\mathbf{r}_${j} - \\mathbf{r}_${i}}{\\|\\mathbf{r}_${j} - \\mathbf{r}_${i}\\|^3} + G m_${k} \\frac{\\mathbf{r}_${k} - \\mathbf{r}_${i}}{\\|\\mathbf{r}_${k} - \\mathbf{r}_${i}\\|^3}`;
  const settings = { loopMeta: "t = 0..6.32591398, steps = 2000, method = rk4, save = 10" };
  projects.threebody = {
    equations: [
      E("Position of body 1", "\\frac{d\\mathbf{r}_1}{dt} = \\mathbf{v}_1", settings),
      E("Position of body 2", "\\frac{d\\mathbf{r}_2}{dt} = \\mathbf{v}_2", settings),
      E("Position of body 3", "\\frac{d\\mathbf{r}_3}{dt} = \\mathbf{v}_3", settings),
      E("Velocity of body 1", `\\frac{d\\mathbf{v}_1}{dt} = ${accel(1, 2, 3)}`, settings),
      E("Velocity of body 2", `\\frac{d\\mathbf{v}_2}{dt} = ${accel(2, 1, 3)}`, settings),
      E("Velocity of body 3", `\\frac{d\\mathbf{v}_3}{dt} = ${accel(3, 1, 2)}`, settings),
      E("Total energy", "E = \\frac{1}{2} m_1 \\|\\mathbf{v}_1\\|^2 + \\frac{1}{2} m_2 \\|\\mathbf{v}_2\\|^2 + \\frac{1}{2} m_3 \\|\\mathbf{v}_3\\|^2 - \\frac{G m_1 m_2}{\\|\\mathbf{r}_1 - \\mathbf{r}_2\\|} - \\frac{G m_1 m_3}{\\|\\mathbf{r}_1 - \\mathbf{r}_3\\|} - \\frac{G m_2 m_3}{\\|\\mathbf{r}_2 - \\mathbf{r}_3\\|}")
    ],
    variableMeta: {
      "G": V("1", "m^3/(kg s^2)", "Gravitational constant (normalised)"),
      "m_1": V("1", "kg", "Mass of body 1"), "m_2": V("1", "kg", "Mass of body 2"), "m_3": V("1", "kg", "Mass of body 3"),
      "\\mathbf{r}_1": V("0.97000436, -0.24308753", "m", "Position of body 1", "2"),
      "\\mathbf{r}_2": V("-0.97000436, 0.24308753", "m", "Position of body 2", "2"),
      "\\mathbf{r}_3": V("0, 0", "m", "Position of body 3", "2"),
      "\\mathbf{v}_1": V("0.466203685, 0.43236573", "m/s", "Velocity of body 1", "2"),
      "\\mathbf{v}_2": V("0.466203685, 0.43236573", "m/s", "Velocity of body 2", "2"),
      "\\mathbf{v}_3": V("-0.93240737, -0.86473146", "m/s", "Velocity of body 3", "2"),
      "E": V("0", "J", "Total energy"), "t": V("0", "s", "Time")
    }
  };

  // ---- Index notation
  const nb = { loopMeta: "t = 0..6.32591398, steps = 2000, method = rk4, save = 10" };
  projects.nbody = {
    indices: "i, j = 1..N",
    equations: [
      E("Positions", "\\frac{d\\mathbf{r}_i}{dt} = \\mathbf{v}_i", nb),
      E("Velocities", "\\frac{d\\mathbf{v}_i}{dt} = \\sum_{j \\ne i} G m_j \\frac{\\mathbf{r}_j - \\mathbf{r}_i}{\\|\\mathbf{r}_j - \\mathbf{r}_i\\|^3}", nb),
      E("Total energy", "E = \\sum_i \\frac{1}{2} m_i \\|\\mathbf{v}_i\\|^2 - \\sum_{i<j} \\frac{G m_i m_j}{\\|\\mathbf{r}_i - \\mathbf{r}_j\\|}")
    ],
    variableMeta: {
      "N": V("3", "1", "Number of bodies"), "G": V("1", "m^3/(kg s^2)", "Gravitational constant (normalised)"),
      "m": V("1", "kg", "Masses"),
      "\\mathbf{r}": V("0.97000436, -0.24308753; -0.97000436, 0.24308753; 0, 0", "m", "Positions, one row per body", "N x 2"),
      "\\mathbf{v}": V("0.466203685, 0.43236573; 0.466203685, 0.43236573; -0.93240737, -0.86473146", "m/s", "Velocities, one row per body", "N x 2"),
      "E": V("0", "J", "Total energy"), "t": V("0", "s", "Time")
    }
  };
  projects.hilbert = {
    indices: "i, j, k = 1..n",
    equations: [
      E("Hilbert matrix", "H_{ij} = \\frac{1}{i + j - 1}"),
      E("Row sums", "b_i = \\sum_j H_{ij}"),
      E("Solve", "\\mathbf{x} = H^{-1} b"),
      E("Product", "C_{ij} = \\sum_k H_{ik} Q_{kj}"),
      E("Trace", "\\tau = \\sum_i H_{ii}"),
      E("Shifted", "d_i = \\sum_{j=1}^{i} H_{j1}")
    ],
    variableMeta: {
      "n": V("6", "1", "Size"), "H": V("0", "1", "Hilbert matrix"), "b": V("0", "1", "Row sums"),
      "\\mathbf{x}": V("0", "1", "Solution (all ones)", "n"), "Q": V("I", "1", "Second matrix (identity)"), "C": V("0", "1", "H B"),
      "\\tau": V("0", "1", "Trace"), "d": V("0", "1", "Partial column sums")
    }
  };
  projects.species = {
    indices: "i, j = 1..M",
    equations: [
      E("Species balance", "\\frac{dc_i}{dt} = \\sum_j K_{ij} c_j", { loopMeta: "t = 0..2, steps = 200, method = rk4" }),
      E("Total", "c_{tot} = \\sum_i c_i")
    ],
    variableMeta: {
      "M": V("3", "1", "Number of species"), "c": V("1, 0, 0", "mol/m^3", "Concentrations"),
      "K": V("-2, 0, 0; 1.5, -1, 0.5; 0.5, 1, -0.5", "1/s", "Rate matrix (columns sum to 0)"),
      "c_{tot}": V("0", "mol/m^3", "Total concentration"), "t": V("0", "s", "Time")
    }
  };

  const out = { errors: window.__errors || [], projects: {} };
  Object.entries(projects).forEach(([key, proj]) => {
    const r = (out.projects[key] = {});
    try {
      projectData = normalizeProject(JSON.parse(JSON.stringify(proj)));
      projectData.equations.forEach(eq => {
        const fixed = { archetype: eq.archetype, loopMeta: eq.loopMeta };
        applyDetection(eq);
        if (!eq.typeAuto) Object.assign(eq, fixed);
        else if (fixed.loopMeta) eq.loopMeta = fixed.loopMeta;
      });
      r.detected = projectData.equations.map(e => `${e.archetype.padEnd(11)} out=${e.outputs.join(",")} in=${e.inputs.join(",")} | ${e.name}`);
      const plan = analyzeSolverArchitecture();
      r.plan = plan.steps.map(s => s.units.map(u => u.kind === "eq" ? u.eq.name : u.kind === "switch" ? `switch(${u.group.eqs.map(e => e.name).join(" | ")})` : `ode(${u.system.odes.map(e => e.name).join(", ")}; alg: ${u.system.algebraic.map(a => a.kind === "eq" ? a.eq.name : a.kind).join(", ")})`).join(" + ") + (s.coupled ? " [coupled]" : ""));
      r.planNotes = plan.notes;
      r.warnings = plan.warnings.map(w => w.symbol);
      const varList = buildVariableRegistry();
      r.vars = varList.map(v => `${displaySymbol(v)} role=${v.role}${v.callable ? " callable" : ""}${v.independentOf ? " independent" : ""}${v.shape ? " shape=" + v.shape.dims.join("x") : ""}`);
      r.units = projectData.equations.map(e => `${e.name}: ${unitCheckResult(e, varList).state} ${unitCheckResult(e, varList).unsupported || ""} ${(unitCheckResult(e, varList).issues || []).map(i => i.message).join("; ")}`);
      r.python = generatePythonCode(plan, varList);
      r.matlab = generateMatlabCode(plan, varList);
      r.fortran = generateFortranCode(plan, varList);
      const sim = simulateModel(null);
      r.simError = sim.error || null;
      r.sim = Object.fromEntries(Object.entries(sim.scope).filter(([, v]) => typeof v !== "function"));
      r.roots = projectData.equations.filter(e => e.archetype === "implicit").map(e => { const a = analyzeRoots(e); return `${e.name}: ${a.state} ${a.message}`; });
      const opts = { ...REPORT_DEFAULTS, ...projectData.report };
      const m = buildReportModel(opts);
      const tex = writeReportLatex(m, opts).tex;
      r.texAlgo = tex.slice(tex.indexOf("\\begin{algorithmic}"), tex.indexOf("\\end{algorithmic}"));
      r.texEq = tex.split("\\subsection").slice(1).map(x => x.split("\\noindent").slice(-1)[0].trim().slice(0, 400));
      const div = document.createElement("div");
      div.innerHTML = writeReportPreview(m, opts);
      r.previewAlgo = [...div.querySelectorAll(".rp-algo-line")].map(x => x.textContent.replace(/\s+/g, " "));
      const { fc, size } = renderFlowchart(projectData.flowchart, m);
      r.mermaid = flowMermaid(fc, projectData.flowchart);
      r.svgOk = flowSvg(fc, size, projectData.flowchart).length > 0;
      r.tikzJumps = flowTikz(fc, projectData.flowchart).split("\n").filter(l => l.includes("J")).join("\n");
      switchTab("arch");
      r.archText = document.getElementById("executionPlanContainer").innerText.replace(/\n+/g, " | ").slice(0, 900);
      r.planWarn = document.getElementById("planWarnings").innerText;
      switchTab("vault");
      r.project = JSON.parse(JSON.stringify(projectData));
    } catch (e) {
      r.threw = e.message + "\n" + e.stack;
    }
  });
  out.errorsAfter = window.__errors;
  const pre = document.createElement("pre");
  pre.id = "testOut";
  pre.textContent = JSON.stringify(out, null, 1);
  document.body.appendChild(pre);
})();
