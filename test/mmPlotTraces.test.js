import test from 'node:test';
import assert from 'node:assert/strict';
import { createMM2DTraces, createMM3DTraces, getMMLoadColor } from '../src/analysis/mmPlotTraces.js';

const result = { axialLoad: -250, points: [
  { angle: 0, nominal: { P: -250.01, Mx: 60, My: 0 }, phi: { P: -249.99, Mx: 42, My: 0 } },
  { angle: 90, nominal: { Mx: 0, My: 100 }, phi: null },
  { angle: 180, nominal: { Mx: -60, My: 0 }, phi: { Mx: -42, My: 0 } }
] };

test('3D MM contours preserve solved moments, constant axial load, gaps and selectable point indices', () => {
  const [nominal, design] = createMM3DTraces(result);
  assert.deepEqual(nominal.x, [60, 0, -60]);
  assert.deepEqual(nominal.z, [-250, -250, -250]);
  assert.deepEqual(design.x, [42, null, -42]);
  assert.deepEqual(design.z, [-250, null, -250]);
  assert.equal(design.connectgaps, false);
  assert.deepEqual(design.customdata, [[0, 0], [90, 1], [180, 2]]);
  assert.notEqual(nominal.line.color, design.line.color);
  assert.notEqual(nominal.line.dash, design.line.dash);
});

test('MM selection highlights the same solved point on the 3D contour', () => {
  const traces = createMM3DTraces(result, { pointIndex: 2, mode: 'phi' });
  const selected = traces.at(-1);
  assert.equal(selected.meta.isMomentMomentHighlight, true);
  assert.equal(selected.meta.mode, 'phi');
  assert.deepEqual([selected.x, selected.y, selected.z], [[-42], [0], [-250]]);
  assert.deepEqual(selected.customdata, [[180, 2]]);
  assert.equal(createMM3DTraces(result, { pointIndex: 1, mode: 'phi' }).length, 2);
  assert.deepEqual(createMM3DTraces(null), []);
  assert.deepEqual(createMM3DTraces({ axialLoad: 0, points: [{ angle: 0 }] }), []);
});

test('2D MM overlays label each axial-load band and keep nominal/design styling distinct', () => {
  const traces = createMM2DTraces(result, { loadIndex: 2 });
  assert.equal(traces.length, 2);
  assert.equal(traces[0].name, 'P = -250.00 kips · Nominal');
  assert.equal(traces[1].name, 'P = -250.00 kips · Design φ');
  assert.equal(traces[0].line.color, getMMLoadColor(2));
  assert.equal(traces[1].line.color, getMMLoadColor(2));
  assert.notEqual(traces[0].line.dash, traces[1].line.dash);
  assert.deepEqual(traces[0].customdata[1], [90, 1, -250]);
  assert.equal(traces[0].meta.axialLoad, -250);
  assert.equal(createMM2DTraces({ axialLoad: 100, points: [] }).length, 0);
});
