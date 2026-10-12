import test from 'node:test';
import assert from 'node:assert/strict';
import { demandPlotTraces } from '../src/analysis/demandPlotTraces.js';

const demand = { id: 'd1', name: 'Combo <1>', P: -500, M2: 20, M3: -10 };
const fixedResult = { id: 'd1', method: 'constant-p', status: 'within', dcr: 0.5,
  capacity: { P: -500, M2: 40, M3: -20 }, loadFactor: 2, rayOrigin: { P: -500, M2: 0, M3: 0 } };

test('fixed-P plot ray is horizontal before and after checking, including demand beyond capacity', () => {
  const unchecked = demandPlotTraces([demand], [], demand.id);
  assert.deepEqual(unchecked[2].z, [-500, -500]);
  assert.deepEqual(unchecked[2].x, [0, 20]);
  const checked = demandPlotTraces([demand], [fixedResult], demand.id);
  assert.deepEqual(checked[2].z, [-500, -500]);
  assert.deepEqual(checked[2].x, [0, 40]);
  assert.deepEqual(checked[2].y, [0, -20]);
  assert.match(checked[1].name, /fixed P/);
  assert.match(checked[0].text[0], /&lt;1&gt;/);
  const outside = { ...demand, M2: 80, M3: -40 };
  const failed = demandPlotTraces([outside], [{ ...fixedResult, status: 'exceeds', dcr: 2, loadFactor: 0.5 }], demand.id);
  assert.deepEqual(failed[2].x, [0, 80]);
  assert.deepEqual(failed[2].z, [-500, -500]);
  assert.equal(failed[0].marker.color[0], '#b91c1c');
});

test('origin method plots all three coordinates from zero and method changes discard old capacity graphics', () => {
  const radial = { ...fixedResult, method: 'origin', capacity: { P: -1000, M2: 40, M3: -20 }, rayOrigin: { P: 0, M2: 0, M3: 0 } };
  const traces = demandPlotTraces([demand], [radial], demand.id, 'origin');
  assert.deepEqual(traces[2].z, [0, -1000]);
  assert.deepEqual(traces[1].z, [-1000]);
  const changed = demandPlotTraces([demand], [radial], demand.id, 'constant-p');
  assert.deepEqual(changed[1].z, []);
  assert.deepEqual(changed[2].z, [-500, -500]);
  assert.match(changed[0].text[0], /Not checked/);
  assert.deepEqual(demandPlotTraces()[2].z, []);
});
