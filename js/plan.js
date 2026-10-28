// SolverMapp — Dependency analysis (strongly connected components, topological order) and the
// solver plan: switches, ODE systems, coupled blocks (`analyzeSolverArchitecture`).
// Classic script, loaded in order by index.html (see docs/ARCHITECTURE.md): top-level names are
// shared with the other files.

// ================================================================
// DEPENDENCY ANALYSIS (ported from example_project/js/dependency-graph.js)
// Equation A feeds B when A computes a variable that B uses. Equations in a cycle form a
// coupled block (strongly connected component) that must be solved together; blocks are
// ordered topologically. A self-dependency (y_{n+1} = y_n + 1) is not an edge.
// ================================================================

// Strongly connected components (Tarjan). Each component is a sorted list of node indices.
function stronglyConnected(succ) {
  const n = succ.length;
  const index = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const onStack = new Array(n).fill(false);
  const stack = [];
  const comps = [];
  let counter = 0;

  function visit(v) {
    index[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = true;
    for (const w of succ[v]) {
      if (index[w] < 0) {
        visit(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v], index[w]);
      }
    }
    if (low[v] === index[v]) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack[w] = false;
        comp.push(w);
      } while (w !== v);
      comps.push(comp.sort((a, b) => a - b));
    }
  }

  for (let v = 0; v < n; v++) if (index[v] < 0) visit(v);
  return comps;
}

// Returns ordered steps [{ eqs, coupled, computes, level }], the level of each equation
// (longest dependency chain from a source, by id) and warnings.
function analyzeDependencies(eqs) {
  const n = eqs.length;
  const producers = {};
  const users = {};
  eqs.forEach((eq, i) => {
    eq.outputs.forEach(s => (producers[s] = producers[s] || new Set()).add(i));
    eq.inputs.forEach(s => (users[s] = users[s] || new Set()).add(i));
  });

  const succ = Array.from({ length: n }, () => new Set());
  Object.keys(producers).forEach(s => {
    producers[s].forEach(d => (users[s] || []).forEach(u => { if (d !== u) succ[d].add(u); }));
  });
  // An ODE varies its independent variable t: equations using t (other ODEs aside) follow it.
  eqs.forEach((eq, d) => (eq.provides || []).forEach(s => (users[s] || []).forEach(u => {
    if (d !== u && !eqs[u].provides?.length) succ[d].add(u);
  })));

  const comps = stronglyConnected(succ);
  const compOf = new Array(n);
  comps.forEach((c, ci) => c.forEach(v => { compOf[v] = ci; }));

  // Condensed graph of blocks, ordered topologically (Kahn); level = longest path from a source.
  const blockSucc = comps.map(() => new Set());
  const indegree = comps.map(() => 0);
  for (let v = 0; v < n; v++) {
    succ[v].forEach(w => {
      const a = compOf[v], b = compOf[w];
      if (a !== b && !blockSucc[a].has(b)) {
        blockSucc[a].add(b);
        indegree[b]++;
      }
    });
  }
  const level = comps.map(() => 0);
  const order = [];
  const ready = comps.map((_, i) => i).filter(i => indegree[i] === 0);
  while (ready.length) {
    ready.sort((a, b) => level[a] - level[b] || comps[a][0] - comps[b][0]);
    const c = ready.shift();
    order.push(c);
    blockSucc[c].forEach(d => {
      level[d] = Math.max(level[d], level[c] + 1);
      if (--indegree[d] === 0) ready.push(d);
    });
  }

  // Levels never decrease along `order`, so independent blocks of one level are adjacent
  // and are merged into one step: they can run in any order.
  const steps = [];
  order.forEach(ci => {
    const members = comps[ci];
    const coupled = members.length > 1;
    let target = steps[steps.length - 1];
    if (coupled || !target || target.coupled || target.level !== level[ci]) {
      target = { eqs: [], coupled, computes: [], level: level[ci] };
      steps.push(target);
    }
    members.forEach(i => {
      target.eqs.push(eqs[i]);
      eqs[i].outputs.forEach(s => { if (!target.computes.includes(s)) target.computes.push(s); });
    });
  });

  const warnings = Object.keys(producers)
    .filter(s => producers[s].size > 1)
    .map(s => ({ symbol: s, eqs: [...producers[s]].map(i => eqs[i]) }));

  const levelOf = new Map(eqs.map((eq, i) => [eq.id, level[compOf[i]]]));
  return { steps, levelOf, warnings };
}

// ================================================================
// SOLVER PLAN
// ================================================================
function analyzeSolverArchitecture() {
  const varList = buildVariableRegistry();
  const globalInputs = varList.filter(v => v.role === "Global Input" && isGiven(v)).map(v => v.symbol);
  const stateVars = varList.filter(v => v.role === "State Var (y₀)").map(v => v.symbol);
  const finalOutputs = varList.filter(v => v.role === "Final Output").map(v => v.symbol);

  const dep = planDependencies(projectData.equations.filter(isComplete));
  const incomplete = projectData.equations.filter(eq => !isComplete(eq));
  return {
    globalInputs, stateVars, finalOutputs, incomplete,
    steps: dep.steps,
    coupledSteps: dep.steps.filter(s => s.coupled),
    warnings: dep.warnings,
    notes: dep.notes
  };
}

// Symbols of an "Applies when" condition (none for "otherwise"; and / or / not are words).
function conditionSymbols(eq) {
  return latexSymbols(conditionText(eq).replace(/\b(?:and|or|not)\b/g, " ")).symbols.map(preferredSpelling);
}

// "Applies when" text, empty for "always" / "otherwise".
function conditionText(eq) {
  const t = String(eq.condition || "").trim();
  return /^(?:\\text\{\s*)?(?:otherwise|else)\s*\}?$/i.test(t) ? "" : t;
}

// Dependency nodes: one per equation, except that the equations giving one output under
// conditions form one switch node (if / else if / else). An ODE "provides" its independent
// variable, so equations that use t are solved inside its integration.
function dependencyNodes(eqs) {
  const byOutput = new Map();
  eqs.forEach(eq => {
    const s = eq.outputs[0];
    if (s) byOutput.set(s, [...(byOutput.get(s) || []), eq]);
  });
  const switchOf = new Map();
  byOutput.forEach((list, symbol) => {
    if (!list.some(conditionText)) return;
    const cases = [...list.filter(conditionText), ...list.filter(e => !conditionText(e))];
    const group = { id: "switch:" + symbol, symbol, eqs: cases, otherwise: cases.find(e => !conditionText(e)) || null };
    cases.forEach(e => switchOf.set(e.id, group));
  });
  const nodes = [];
  const added = new Set();
  eqs.forEach(eq => {
    const group = switchOf.get(eq.id);
    if (group && added.has(group)) return;
    const members = group ? group.eqs : [eq];
    if (group) added.add(group);
    nodes.push({
      id: group ? group.id : eq.id, members, switch: group || null,
      outputs: [...new Set(members.flatMap(e => e.outputs))],
      inputs: [...new Set(members.flatMap(e => [...e.inputs, ...conditionSymbols(e), ...(latexSymbols(e.latex).usesIndices ? indexRangeSymbols() : [])]))],
      provides: members.filter(e => e.archetype === "ode").map(e => odeVariables(e).independent)
    });
  });
  return nodes;
}

// Steps of the plan with their units: { kind: "eq", eq }, { kind: "switch", group } or
// { kind: "ode", system } — an ODE system integrates its ODEs together and evaluates the
// algebraic equations it needs (q = h (T - T_inf), Q(t)) inside every stage.
function planDependencies(eqs) {
  const nodes = dependencyNodes(eqs);
  const dep = analyzeDependencies(nodes);
  const notes = [];
  const unitOf = node => (node.switch ? { kind: "switch", group: node.switch } : { kind: "eq", eq: node.members[0] });
  const steps = dep.steps.map(step => {
    const odeNodes = step.eqs.filter(n => n.provides.length);
    let units;
    let coupled = step.coupled;
    if (odeNodes.length && step.coupled) {
      // One system: algebraic nodes in dependency order, states given at each stage
      const algebraic = step.eqs.filter(n => !n.provides.length);
      const order = [];
      const left = new Set(algebraic);
      while (left.size) {
        const ready = [...left].find(a => ![...left].some(b => b !== a && b.outputs.some(s => a.inputs.includes(s))));
        if (!ready) {
          notes.push(`The equations ${[...left].flatMap(n => n.members).map(e => e.name || "Untitled").join(", ")} depend on each other inside an ODE system: they are evaluated once per stage, in card order.`);
          order.push(...left);
          break;
        }
        order.push(ready);
        left.delete(ready);
      }
      units = [{ kind: "ode", system: odeSystem(odeNodes.flatMap(n => n.members), order.map(unitOf), notes) }];
      coupled = false;
    } else {
      units = step.eqs.map(n => (n.provides.length ? { kind: "ode", system: odeSystem(n.members, [], notes) } : unitOf(n)));
    }
    return { ...step, coupled, units, eqs: step.eqs.flatMap(n => n.members) };
  });
  const grouped = new Set(nodes.filter(n => n.switch).map(n => n.switch.symbol));
  const levelOf = new Map(nodes.flatMap(n => n.members.map(e => [e.id, dep.levelOf.get(n.id)])));
  return { steps, levelOf, notes, warnings: dep.warnings.filter(w => !grouped.has(w.symbol)), sccCoupled: new Set(dep.steps.filter(s => s.coupled).flatMap(s => s.eqs.flatMap(n => n.members.map(e => e.id)))) };
}

const ODE_METHODS = {
  rk4: { label: "classical fourth-order Runge–Kutta", short: "RK4", weights: [1, 2, 2, 1], nodes: [0.5, 0.5, 1] },
  euler: { label: "explicit Euler", short: "Euler", weights: [1], nodes: [] }
};

// Settings of an ODE card: "t = 0..10, steps = 100, method = rk4" (bounds may be variables).
function odeSettings(eq) {
  const { independent } = odeVariables(eq);
  const s = loopSettings(eq);
  const range = /(?:^|[,;])\s*[^=,;]+?\s*=\s*([^,;]+?)\s*\.\.\s*([^,;]+)/.exec(eq.loopMeta || "");
  const method = (s.method || "rk4").trim().toLowerCase();
  return {
    independent,
    from: range ? range[1].trim() : "0", to: range ? range[2].trim() : "10",
    steps: (s.steps || s.n_steps || s.n || "100").trim(),
    method: ODE_METHODS[method] ? method : "rk4",
    unknownMethod: ODE_METHODS[method] ? "" : method,
    save: Math.max(0, Math.round(+(s.save || 0)) || 0) // write t and the states to a CSV file every `save` steps
  };
}

// cards: the ODE cards as written; odes: the first-order equations integrated (a second-order
// card gives two); states: the integrated variables, one per first-order equation.
function odeSystem(cards, algebraic, notes) {
  const settings = odeSettings(cards[0]);
  const odes = cards.flatMap(firstOrderOdes);
  cards.slice(1).forEach(e => {
    const s = odeSettings(e);
    if (s.independent !== settings.independent || s.from !== settings.from || s.to !== settings.to || s.steps !== settings.steps || s.method !== settings.method) {
      notes.push(`“${e.name || "Untitled"}” is integrated together with “${cards[0].name || "Untitled"}”, so it uses that card's range, steps and method.`);
    }
  });
  return { cards, odes, algebraic, settings, states: odes.map(e => e.outputs[0]) };
}
