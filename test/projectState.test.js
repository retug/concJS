import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnalysisConfiguration, setAnalysisConfiguration, updateAnalysisConfiguration } from '../src/projectState.js';

test('new analyses default to 3-inch edge and interior meshing', () => {
  const configuration = getAnalysisConfiguration();

  assert.equal(configuration.edgeSpacing, 3);
  assert.equal(configuration.interiorSpacing, 3);
  assert.deepEqual(configuration.demandCases, []);
  assert.equal(configuration.dcrMethod, 'constant-p');
});

test('demand state copies inputs and returned rows and survives unrelated analysis updates', () => {
  const demand = { id: 'd1', name: 'Compression', P: -400, M2: 0, M3: -35, dcr: 0.5 };
  const incoming = [demand];
  const saved = setAnalysisConfiguration({ edgeSpacing: 1.25, interiorSpacing: 2.5, demandCases: incoming });
  incoming.push({ id: 'd2', name: 'Unused', P: 1, M2: 2, M3: 3 });
  demand.P = 999;
  saved.demandCases[0].M3 = 999;
  const read = getAnalysisConfiguration();
  read.demandCases[0].name = 'Changed outside state';

  const updated = updateAnalysisConfiguration({ momentMomentAxialLoad: -250 });
  assert.deepEqual(updated.demandCases, [{ id: 'd1', name: 'Compression', P: -400, M2: 0, M3: -35 }]);
  assert.equal(updated.momentMomentAxialLoad, -250);
  assert.equal(updated.edgeSpacing, 1.25);
  assert.equal(updated.interiorSpacing, 2.5);
  const updatedDemands = updateAnalysisConfiguration({ demandCases: [{ id: 'd3', name: 'New demand', P: 0, M2: -10, M3: 8 }] });
  assert.equal(updatedDemands.momentMomentAxialLoad, -250);
  assert.equal(updatedDemands.edgeSpacing, 1.25);
  assert.equal(updatedDemands.interiorSpacing, 2.5);
  setAnalysisConfiguration();
  assert.deepEqual(getAnalysisConfiguration().demandCases, []);
});

test('invalid demand update is rejected without changing saved state', () => {
  const demandCases = [{ id: 'd1', name: 'Valid', P: -100, M2: 0, M3: 1 }];
  setAnalysisConfiguration({ demandCases });
  assert.throws(() => updateAnalysisConfiguration({
    demandCases: [{ ...demandCases[0], P: Infinity }]
  }), /P must be a finite number/);
  assert.deepEqual(getAnalysisConfiguration().demandCases, demandCases);
  setAnalysisConfiguration();
});

test('switching demand check methods preserves demands and unrelated analysis inputs', () => {
  const initial = setAnalysisConfiguration({
    edgeSpacing: 1.25,
    interiorSpacing: 2.5,
    momentMomentAxialLoad: -125,
    demandCases: [{ id: 'd1', name: 'Column base', P: -400, M2: 0, M3: -40 }]
  });
  assert.equal(initial.dcrMethod, 'constant-p');
  assert.deepEqual(updateAnalysisConfiguration({ dcrMethod: 'origin' }), { ...initial, dcrMethod: 'origin' });
  assert.equal(updateAnalysisConfiguration({ momentMomentAxialLoad: -250 }).dcrMethod, 'origin');
  assert.deepEqual(updateAnalysisConfiguration({ dcrMethod: 'constant-p' }), {
    ...initial, momentMomentAxialLoad: -250
  });
  setAnalysisConfiguration();
});

test('invalid demand check methods reject the whole state update atomically', () => {
  const initial = setAnalysisConfiguration({
    dcrMethod: 'origin',
    demandCases: [{ id: 'd1', name: 'Valid', P: -100, M2: 0, M3: 1 }]
  });
  for (const dcrMethod of ['', 'Origin', 'constant-P', null, false, 0, {}]) {
    assert.throws(() => updateAnalysisConfiguration({ dcrMethod, edgeSpacing: 99, demandCases: [] }), /dcrMethod must be/);
    assert.deepEqual(getAnalysisConfiguration(), initial);
  }
  assert.equal(setAnalysisConfiguration().dcrMethod, 'constant-p');
});
