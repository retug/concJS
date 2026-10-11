import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { getPlotUpdateCoordinator } from '../src/analysis/plotUpdateCoordinator.js';

// Keep the real section methods, lifecycle, trace builder, and coordinator.
// Only browser entry points and the actual Plotly renderer are substituted.
const sectionUrl = new URL('../src/analysis/AnalyzableConcreteSection.js', import.meta.url).href;
const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;
const plotlyUrl = moduleUrl(`
  export const calls = [];
  let deleteGate;
  export function waitForDelete(gate) { deleteGate = gate; }
  export function reset() { calls.length = 0; deleteGate = null; }
  export default {
    async deleteTraces(plot, indices) {
      calls.push({ kind: 'delete', indices });
      if (deleteGate) await deleteGate;
      plot.data = plot.data.filter((_, index) => !indices.includes(index));
    },
    async addTraces(plot, traces) {
      calls.push({ kind: 'add', traces });
      plot.data.push(...traces);
    }
  };
`);
const browserStubs = new Map([
  ['../main.js', moduleUrl('export const scene = null, controls = null, camera = null, renderer = null;')],
  ['../threeJSscenefunctions.js', moduleUrl('export function setupRaycastingForResults() {}')],
  ['./DemandChecks.js', moduleUrl('export function demandPlotTraces() { return []; } export function initializeDemandChecks() {}')]
]);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'plotly.js-dist-min') return { url: plotlyUrl, shortCircuit: true };
    if (context.parentURL === sectionUrl && browserStubs.has(specifier)) {
      return { url: browserStubs.get(specifier), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
const { AnalyzableConcreteSection } = await import(sectionUrl);
const plotly = await import(plotlyUrl);
hooks.deregister();

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));
const resultAt = axialLoad => ({
  axialLoad,
  points: [0, 90, 180, 270, 360].map(angle => ({
    angle,
    nominal: { Mx: 100 * Math.cos(angle * Math.PI / 180), My: 80 * Math.sin(angle * Math.PI / 180) },
    phi: { Mx: 70 * Math.cos(angle * Math.PI / 180), My: 56 * Math.sin(angle * Math.PI / 180) }
  }))
});

function fixture(t, { hidden = false, existingSlice = false } = {}) {
  plotly.reset();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const view = new EventTarget();
  view.requestAnimationFrame = callback => setTimeout(callback, 0);
  view.cancelAnimationFrame = clearTimeout;
  const plot = new EventTarget();
  const surface = { name: 'PMM surface', meta: { isPMMSurface: true } };
  Object.assign(plot, {
    ownerDocument: { defaultView: view }, isConnected: true,
    clientWidth: hidden ? 0 : 800, clientHeight: 400,
    data: [surface, ...(existingSlice ? [{ meta: { isMomentMomentSlice: true }, name: 'Old slice' }] : [])]
  });
  const section = new AnalyzableConcreteSection(null);
  globalThis.document = { getElementById: id => id === 'pmPlot' ? plot : null };
  globalThis.window = { activeAnalysisSection: section };
  t.after(() => {
    getPlotUpdateCoordinator(plot).dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  return { section, plot, surface };
}

test('MM slice renders without any prior plot mutation queue initialization', async t => {
  const { section, plot, surface } = fixture(t);
  assert.equal(section.pmmPlotUpdates, null);
  assert.equal(section.pmmPlotMutation, undefined);
  const result = resultAt(-300);
  section.currentMomentMomentResult = result;
  await section.renderMomentMomentCurveOnPMM(result);
  assert.deepEqual(plotly.calls.map(call => call.kind), ['add']);
  assert.equal(plot.data[0], surface);
  const slices = plot.data.filter(trace => trace.meta?.isMomentMomentSlice);
  assert.deepEqual(slices.map(trace => trace.meta.mode), ['nominal', 'phi']);
  assert.ok(slices.every(trace => trace.z.every(value => value === -300)));
});

test('hidden PMM resumes with only the newest MM slice and preserves its surface', async t => {
  const { section, plot, surface } = fixture(t, { hidden: true, existingSlice: true });
  const stale = resultAt(-400);
  section.currentMomentMomentResult = stale;
  const oldDraw = section.renderMomentMomentCurveOnPMM(stale);
  await nextTurn();
  const current = resultAt(-100);
  section.mmGeneration += 1;
  section.currentMomentMomentResult = current;
  const newDraw = section.renderMomentMomentCurveOnPMM(current);
  await nextTurn();
  assert.equal(plotly.calls.length, 0);
  plot.clientWidth = 800;
  const coordinator = getPlotUpdateCoordinator(plot);
  await coordinator.enqueue('shown', () => {});
  await Promise.all([oldDraw, newDraw]);
  assert.deepEqual(plotly.calls.map(call => call.kind), ['delete', 'add']);
  assert.equal(plot.data[0], surface);
  assert.equal(plot.data.length, 3);
  assert.ok(plotly.calls[1].traces.every(trace => trace.z.every(value => value === -100)));
});

test('invalidating MM during asynchronous trace deletion prevents stale slices from being added', { timeout: 1500 }, async t => {
  const { section, plot, surface } = fixture(t, { existingSlice: true });
  let releaseDelete;
  const gate = new Promise(resolve => { releaseDelete = resolve; });
  plotly.waitForDelete(gate);
  const result = resultAt(-300);
  section.currentMomentMomentResult = result;
  const pending = section.renderMomentMomentCurveOnPMM(result);
  while (!plotly.calls.some(call => call.kind === 'delete')) await nextTurn();
  section.invalidateMomentMomentCurve();
  assert.equal(section.currentMomentMomentResult, null);
  releaseDelete();
  await pending;
  await getPlotUpdateCoordinator(plot).whenIdle();
  assert.deepEqual(plotly.calls.map(call => call.kind), ['delete']);
  assert.deepEqual(plot.data, [surface]);
});
