import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { getPlotUpdateCoordinator } from '../src/analysis/plotUpdateCoordinator.js';
import { setAnalysisConfiguration } from '../src/projectState.js';

// Exercise the controller with its real coordinator and capacity calculations,
// substituting only the browser view and Plotly renderer.
const controllerUrl = new URL('../src/analysis/DemandChecks.js', import.meta.url).href;
const plotlyUrl = `data:text/javascript,${encodeURIComponent(`
  export const draws = [];
  export default { restyle(...args) { draws.push(args); return Promise.resolve(); } };
`)}`;
const panelUrl = `data:text/javascript,${encodeURIComponent(`
  export let callbacks;
  export function createDemandChecksPanel(host, next) {
    callbacks = next;
    return { setSelected() {}, dispose() {} };
  }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === controllerUrl) {
      if (specifier === 'plotly.js-dist-min') return { url: plotlyUrl, shortCircuit: true };
      if (specifier === './DemandChecksPanel.js') return { url: panelUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
const { initializeDemandChecks, demandPlotTraces } = await import(controllerUrl);
const { draws } = await import(plotlyUrl);
const panel = await import(panelUrl);
hooks.deregister();

const demands = [
  { id: 'a', name: 'First', P: -500, M2: 50, M3: 0 },
  { id: 'b', name: 'Second', P: -200, M2: 0, M3: 25 }
];
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

function generatedBicone() {
  return Object.fromEntries(Array.from({ length: 13 }, (_, index) => {
    const angle = index * 15;
    const branch = direction => Array.from({ length: 51 }, (_, i) => {
      const P = -1000 + 40 * i;
      const radius = 1 - Math.abs(P) / 1000;
      const radians = (angle + direction) * Math.PI / 180;
      return [P, radius * 200 * Math.cos(radians), radius * 100 * Math.sin(radians)];
    });
    const points = [...branch(0), ...branch(180).reverse().slice(1, -1)];
    return [angle, Object.fromEntries(['phiP', 'phiMx', 'phiMy'].map((key, i) => [key, [points.map(point => point[i])]]))];
  }));
}

function fixture(t, { hidden = false, results = generatedBicone() } = {}) {
  draws.length = 0;
  setAnalysisConfiguration({ demandCases: demands });
  const view = new EventTarget();
  view.requestAnimationFrame = callback => setTimeout(callback, 0);
  view.cancelAnimationFrame = clearTimeout;
  const plot = new EventTarget();
  Object.assign(plot, {
    ownerDocument: { defaultView: view }, isConnected: true,
    clientWidth: hidden ? 0 : 800, clientHeight: 400, data: demandPlotTraces()
  });
  const coordinator = getPlotUpdateCoordinator(plot);
  const section = { PMMXYresults: results, setActiveDemand() {} };
  const controller = initializeDemandChecks(section, {}, plot);
  t.after(() => {
    controller.dispose();
    coordinator.dispose();
    setAnalysisConfiguration();
  });
  return { plot, coordinator, controller, callbacks: panel.callbacks };
}

async function completesWhileHidden(operation) {
  let timeout;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Demand controls waited for a hidden plot.')), 1500); })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

for (const invalidSurface of [false, true]) {
  test(`demand checks finish while PMM is hidden (${invalidSurface ? 'unresolved' : 'valid'} capacity)`, async t => {
    const { plot, coordinator, callbacks } = fixture(t, { hidden: true, ...(invalidSurface ? { results: {} } : {}) });
    const checked = await completesWhileHidden(callbacks.onCheck(demands));
    assert.equal(checked.length, demands.length);
    assert.ok(checked.every(result => result.status === (invalidSurface ? 'unresolved' : 'within')));
    await completesWhileHidden(Promise.resolve(callbacks.onSelect('b')));
    assert.equal(draws.length, 0);
    plot.clientWidth = 800;
    await coordinator.enqueue('shown', () => {});
    await coordinator.whenIdle();
    assert.equal(draws.length, 1, 'Only the latest hidden demand update is drawn.');
    assert.deepEqual(draws[0][1].marker[0].size, [7, 10]);
  });
}

test('demand refresh shares the plot coordinator and renders the latest edits after an active draw', async t => {
  const { plot, coordinator, callbacks } = fixture(t);
  await coordinator.whenIdle();
  draws.length = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started = false;
  const active = coordinator.enqueue('surface', async () => { started = true; await gate; });
  while (!started) await nextTurn();
  const edited = demands.map(demand => ({ ...demand, P: -100, M2: demand.M2 + 20 }));
  callbacks.onCasesChange(edited);
  callbacks.onMethodChange('origin');
  callbacks.onSelect('b');
  await nextTurn();
  assert.equal(draws.length, 0, 'Demand restyle cannot overlap another plot mutation.');
  release();
  await active;
  await coordinator.whenIdle();
  assert.equal(draws.length, 1);
  assert.equal(draws[0][0], plot);
  assert.deepEqual(draws[0][1].x[0], [70, 20]);
  assert.deepEqual(draws[0][1].marker[0].size, [7, 10]);
  assert.deepEqual(draws[0][1].z[2], [0, -100], 'The ray uses the latest method and selection.');
});

test('disposing demand checks prevents its pending redraw when the plot becomes visible', async t => {
  const { plot, coordinator, controller, callbacks } = fixture(t, { hidden: true });
  callbacks.onSelect('b');
  controller.dispose();
  plot.clientWidth = 800;
  await coordinator.enqueue('shown', () => {});
  await coordinator.whenIdle();
  assert.equal(draws.length, 0);
});
